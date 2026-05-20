/**
 * View-side helper that hides the bookkeeping for `skillEffectsV2`.
 *
 * Each combat view (Boss / Dungeon / Transform / Raid / Hunt / ArenaMatch)
 * has its own tick loop with its own combatant model — but the rules for
 * stun / DOT / AOE / instant-kill / marks / dodges / multistrike are
 * identical. This module exposes a tiny per-session container the view
 * keeps in a ref, plus 4 verbs:
 *
 *   • `ensureStatus(id)`              — get-or-init a status state
 *   • `tickAll(combatants, deltaMs)`  — drain timers + apply DOT to every
 *                                       provided combatant; returns the DOT
 *                                       deltas so the view can render
 *                                       floating numbers
 *   • `castSkill({...})`              — apply a skill's parsed effects
 *                                       (AOE / instant-kill / multistrike /
 *                                       marks / heals / immortal / etc.)
 *                                       and return the side-effects the
 *                                       view still has to commit
 *                                       (multistrike count, summon spec,
 *                                       aggro-steal flag, AOE flag, …)
 *   • `resolveBasicAttack({...})`     — single-hit resolution honouring
 *                                       stun / dodge / amp queues / marks /
 *                                       crit-next / lifesteal queue
 */

import {
    parseEffects,
    applyEffects,
    tickStatus,
    isStunned,
    resolveBasicHit,
    applyIncomingDamage,
    applyIncomingHeal,
    newStatusState,
    type IStatusState,
    type IApplyResult,
} from './skillEffectsV2';

/** A combatant the view is tracking — we only need id + max-HP for DOT calc. */
export interface ICombatEffectsRef {
    id: string;
    maxHp: number;
}

export interface ICombatEffectsSession {
    /** id → live status. Created lazily on first `ensureStatus`. */
    statuses: Map<string, IStatusState>;
}

export const newCombatEffectsSession = (): ICombatEffectsSession => ({
    statuses: new Map(),
});

export const ensureStatus = (s: ICombatEffectsSession, id: string): IStatusState => {
    let st = s.statuses.get(id);
    if (!st) {
        st = newStatusState();
        s.statuses.set(id, st);
    }
    return st;
};

/** Returns true if the named combatant cannot act this tick. */
export const isCombatantStunned = (s: ICombatEffectsSession, id: string): boolean => {
    const st = s.statuses.get(id);
    return st ? isStunned(st) : false;
};

/** Drain timers + accumulate DOT damage per combatant. Also surfaces
 *  Necromancer Mroczny Rytuał damage when its countdown expires this
 *  tick — caller subtracts both from the same target HP and pushes
 *  whatever floats they want for each (☠️ DOT vs 💀 RITUAL). */
export const tickAll = (
    s: ICombatEffectsSession,
    combatants: ICombatEffectsRef[],
    deltaMs: number,
): Array<{ id: string; dotDamage: number; darkRitualDamage: number; darkRitualTriggered: boolean }> => {
    const out: Array<{ id: string; dotDamage: number; darkRitualDamage: number; darkRitualTriggered: boolean }> = [];
    for (const c of combatants) {
        const st = s.statuses.get(c.id);
        if (!st) continue;
        const r = tickStatus(st, deltaMs, c.maxHp);
        if (r.dotDamage > 0 || r.darkRitualTriggered) {
            out.push({
                id: c.id,
                dotDamage: r.dotDamage,
                darkRitualDamage: r.darkRitualDamage,
                darkRitualTriggered: r.darkRitualTriggered,
            });
        }
    }
    return out;
};

// ── Skill cast / basic-hit thin wrappers ────────────────────────────────────

export interface ICastSkillParams {
    session: ICombatEffectsSession;
    casterId: string;
    /** Single-target id when known; null for self-buff casts. */
    targetId: string | null;
    /** Target HP/% for `execute_below`. */
    targetHpPct: number;
    /** Effect string from skills.json (e.g. "aoe;dot:5000:5"). */
    effect: string | null | undefined;
    /** All ally ids (incl. caster). Used for party_* effects. */
    allyIds: string[];
    /** All alive enemy ids. Used for enemy_* effects. */
    enemyIds: string[];
}

export const castSkill = (p: ICastSkillParams): IApplyResult => {
    const parsed = parseEffects(p.effect);
    const casterStatus = ensureStatus(p.session, p.casterId);
    const targetStatus = p.targetId ? ensureStatus(p.session, p.targetId) : null;
    const partyStatus = p.allyIds.map((id) => ensureStatus(p.session, id));
    const enemyStatus = p.enemyIds.map((id) => ensureStatus(p.session, id));
    return applyEffects(parsed, casterStatus, targetStatus, p.targetHpPct, partyStatus, enemyStatus);
};

export interface IResolveBasicParams {
    session: ICombatEffectsSession;
    attackerId: string;
    /** Class name informs dodge scope (`non_magic` skips Mage/Cleric/Necromancer). */
    attackerClass: string | undefined;
    targetId: string;
    /** Pre-effect base damage (already factoring weapon / atk / etc.). */
    baseDmg: number;
}

export const resolveBasicAttack = (p: IResolveBasicParams) => {
    const a = ensureStatus(p.session, p.attackerId);
    const t = ensureStatus(p.session, p.targetId);
    return resolveBasicHit(a, p.attackerClass, p.baseDmg, t);
};

// ── Damage / heal routing ──────────────────────────────────────────────────

/**
 * Apply raw damage to a combatant honouring `immortal` and `cannotDie`. The
 * view should subtract the returned `appliedDmg` from HP; `appliedDmg` may
 * be 0 (immortal absorb) or clamped to keep HP at 1 (cannotDie window).
 */
export const routeDamage = (
    session: ICombatEffectsSession,
    targetId: string,
    targetCurrentHp: number,
    rawDamage: number,
): { appliedDmg: number; absorbed: boolean } => {
    const st = ensureStatus(session, targetId);
    const r = applyIncomingDamage(st, targetCurrentHp, rawDamage);
    return { appliedDmg: -r.hpDelta, absorbed: r.absorbed };
};

/** Apply heal honouring `mark_no_heal` / `enemy_no_heal`. Returns the actual
 *  delta — negative when heal was reversed to damage. */
export const routeHeal = (
    session: ICombatEffectsSession,
    targetId: string,
    rawHeal: number,
): { delta: number } => {
    const st = ensureStatus(session, targetId);
    const r = applyIncomingHeal(st, rawHeal);
    return { delta: r.hpDelta };
};
