
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

export interface ICombatEffectsRef {
    id: string;
    maxHp: number;
}

export interface ICombatEffectsSession {
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

export const isCombatantStunned = (s: ICombatEffectsSession, id: string): boolean => {
    const st = s.statuses.get(id);
    return st ? isStunned(st) : false;
};

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


export interface ICastSkillParams {
    session: ICombatEffectsSession;
    casterId: string;
    targetId: string | null;
    targetHpPct: number;
    effect: string | null | undefined;
    allyIds: string[];
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
    attackerClass: string | undefined;
    targetId: string;
    baseDmg: number;
}

export const resolveBasicAttack = (p: IResolveBasicParams) => {
    const a = ensureStatus(p.session, p.attackerId);
    const t = ensureStatus(p.session, p.targetId);
    return resolveBasicHit(a, p.attackerClass, p.baseDmg, t);
};


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

export const routeHeal = (
    session: ICombatEffectsSession,
    targetId: string,
    rawHeal: number,
): { delta: number } => {
    const st = ensureStatus(session, targetId);
    const r = applyIncomingHeal(st, rawHeal);
    return { delta: r.hpDelta };
};
