/**
 * Unified skill-effect runtime.
 *
 * Goal: every effect tag declared in `skills.json` resolves to a small set of
 * mutations that combat views can apply via the same lifecycle hooks. The
 * heavy lifting (timer countdowns, status flag toggles, queued-attack
 * counters) lives here so individual views don't re-implement DOT loops or
 * stun gates each time.
 *
 * Effect string vocabulary (combine with `;`):
 *
 *   AoE / damage shape
 *     aoe                                         hit every alive enemy
 *     def_pen:<percent>                           ignore N% of target defence (this cast)
 *     dmg_amp_next:<mult>:<count>                 next N basic attacks ×mult
 *     crit_buff_next:<percent>                    next basic gets +N% crit chance
 *     crit_buff:<percent>:<durationMs>            +crit chance for window
 *     crit_next:<mult>:<count>                    next N attacks crit at this multiplier
 *     multistrike:<count>                         fire N additional basic attacks now
 *
 *   Status (target / caster)
 *     stun:<durationMs>                           target cannot act
 *     stun_chance:<percent>:<durationMs>          % chance to stun target
 *     paralyze:<durationMs>                       target cannot act (alt visual)
 *     dot:<durationMs>:<percent_max_hp_per_sec>   damage-over-time on target
 *     instant_kill_chance:<percent>               % chance the cast oneshot kills
 *     execute_below:<percent_hp>                  oneshot if target HP% ≤ N
 *     mark_amp:<mult>:<count>:<durationMs>        next N ally hits on target ×mult
 *     mark_amp_all:<mult>:<durationMs>            all hits on target ×mult for N ms
 *     mark_no_heal:<durationMs>                   heals on target reversed -> damage
 *
 *   Self / caster
 *     heal_self_pct_dmg:<percent>                 heal caster N% of dmg dealt this cast
 *     heal_self_max_pct:<percent>                 heal caster N% of own max HP
 *     immortal:<durationMs>                       caster takes 0 damage during window
 *     dodge_next:<count>:<scope>                  next N basic attacks dodged (scope `non_magic` excludes Mage/Cleric/Necromancer)
 *     dodge_buff:<percent>:<durationMs>           % chance to dodge basics for window
 *     attack_up:<percent>:<durationMs>            +ATK self
 *     defense_up:<percent>:<durationMs>           +DEF self
 *
 *   Party-wide / ally
 *     party_attack_up:<percent>:<durationMs>      ally ATK %
 *     party_defense_up:<percent>:<durationMs>     ally DEF %
 *     party_as_up:<mult>:<durationMs>             ally attack speed ×mult
 *     party_crit_up:<percent>:<durationMs>        ally crit chance %
 *     party_def_pen:<percent>:<durationMs>        ally hits ignore N% def
 *     party_immortal:<durationMs>                 allies HP cannot drop below 1
 *     heal_lowest_ally_pct:<percent>              heal lowest-% HP ally for N% of their max
 *     heal_party_dot:<durationMs>:<percent>       heal all allies %max/sec
 *     heal_party_pct:<percent>                    heal all allies N% of max instantly
 *     block_next_party:<count>                    block next N ally hits
 *     revive_party:<protectMs>:<graceMs>          party can't drop below 1 HP for protectMs; revive after graceMs
 *     next_ally_heal:<percent>:<count>            next N ally attacks heal lowest-HP ally for percent of max
 *     party_lifesteal_next:<percent>:<count>      next N ally attacks heal caster for percent of dmg
 *     party_instant_kill_chance_next:<percent>:<count> next N ally attacks have % instant-kill chance
 *
 *   Aggro
 *     aggro_steal                                 caster pulls all aggro from enemies (raid only — no-op elsewhere)
 *
 *   Enemy debuffs
 *     enemy_atk_down:<percent>:<durationMs>       enemy team ATK -%
 *     enemy_no_heal:<durationMs>                  enemies cannot heal
 *
 *   Summons (Necromancer)
 *     summon:<type>:<count>                       summon `count` of type ∈ skeleton|ghost|demon|lich
 *     dark_ritual:<durationMs>:<percent_max_hp>   mark target — after window deal % max HP; if HP%≤N at trigger, kill
 *     death_apocalypse                            self-cost variant — see Necro 15 in spec
 */

export type EffectKey =
    | 'aoe'
    | 'def_pen'
    | 'dmg_amp_next'
    | 'crit_buff_next'
    | 'crit_buff'
    | 'crit_next'
    | 'multistrike'
    | 'stun'
    | 'stun_chance'
    | 'paralyze'
    | 'dot'
    | 'instant_kill_chance'
    | 'execute_below'
    | 'mark_amp'
    | 'mark_amp_all'
    | 'mark_no_heal'
    | 'mark_heal_to_dmg'
    | 'heal_self_pct_dmg'
    | 'heal_self_max_pct'
    | 'immortal'
    | 'mana_shield'
    | 'dodge_next'
    | 'dodge_buff'
    | 'attack_up'
    | 'defense_up'
    | 'party_attack_up'
    | 'party_defense_up'
    | 'party_as_up'
    | 'party_crit_up'
    | 'party_def_pen'
    | 'party_immortal'
    | 'heal_lowest_ally_pct'
    | 'heal_party_dot'
    | 'heal_party_pct'
    | 'block_next_party'
    | 'revive_party'
    | 'next_ally_heal'
    | 'party_lifesteal_next'
    | 'party_instant_kill_chance_next'
    | 'aggro_steal'
    | 'enemy_atk_down'
    | 'enemy_no_heal'
    | 'summon'
    | 'dark_ritual'
    | 'death_apocalypse';

export interface IParsedEffect {
    key: EffectKey;
    /** Numeric arg #1 */
    a?: number;
    /** Numeric arg #2 */
    b?: number;
    /** Numeric arg #3 */
    c?: number;
    /** String arg (e.g. summon type, dodge scope) */
    s?: string;
    /** Raw original string for unknown keys (debug) */
    raw: string;
}

/** Parse a `skills.json.effect` string (e.g. "aoe;dot:5000:5") into atoms. */
export const parseEffects = (effect: string | null | undefined): IParsedEffect[] => {
    if (!effect) return [];
    const out: IParsedEffect[] = [];
    for (const piece of effect.split(';').map((p) => p.trim()).filter(Boolean)) {
        const [keyRaw, ...args] = piece.split(':');
        const key = keyRaw as EffectKey;
        const parsed: IParsedEffect = { key, raw: piece };
        if (args.length >= 1) {
            const n = parseFloat(args[0]);
            if (!Number.isFinite(n)) parsed.s = args[0];
            else parsed.a = n;
        }
        if (args.length >= 2) {
            const n = parseFloat(args[1]);
            if (!Number.isFinite(n)) parsed.s = (parsed.s ? `${parsed.s}:` : '') + args[1];
            else parsed.b = n;
        }
        if (args.length >= 3) {
            const n = parseFloat(args[2]);
            if (Number.isFinite(n)) parsed.c = n;
        }
        out.push(parsed);
    }
    return out;
};

/** Quick-lookup: does this effect set contain `key`? */
export const hasEffect = (effects: IParsedEffect[], key: EffectKey): boolean =>
    effects.some((e) => e.key === key);

/** First atom matching `key`, or null. */
export const findEffect = (effects: IParsedEffect[], key: EffectKey): IParsedEffect | null =>
    effects.find((e) => e.key === key) ?? null;

// -- Status state ------------------------------------------------------------

/**
 * Live status state for one combatant. Stored in a plain ref/object that the
 * combat tick mutates each frame. `tickStatus()` reduces all timers by
 * `deltaMs` and prunes expired entries — always call once per combat tick.
 */
export interface IStatusState {
    /** ms remaining on stun/paralyze. > 0 -> cannot act. */
    stunMs: number;
    /** ms remaining where the combatant takes 0 damage. */
    immortalMs: number;
    /** When > 0, HP cannot drop below 1 (party-immortal). */
    cannotDieMs: number;
    /** Timestamp at which the cannotDie window started; used to compute revive
     *  trigger (HP=0 within window -> revive at protectMs+graceMs). */
    cannotDieReviveAt: number | null;
    /** Active DOTs (each ticks once per second of `tickStatus`). */
    dots: Array<{ remainingMs: number; pctPerSec: number }>;
    /** Pending damage-amp queue: `[mult, count]` consumed on next basic attack. */
    dmgAmpNext: Array<{ mult: number; count: number }>;
    /** Pending guaranteed-crit queue. */
    critNext: Array<{ mult: number; count: number }>;
    /** Pending crit-chance buff (single hit). +percent. */
    critBuffNext: number;
    /** Active crit-chance buff window. */
    critBuffPct: number;
    critBuffMs: number;
    /** Pending dodge counter. Each consumed basic attack from a non-magic
     *  attacker (when scope === 'non_magic') or any attacker (scope === 'all'). */
    dodgeNext: Array<{ count: number; scope: 'non_magic' | 'all' }>;
    /** Active dodge chance buff. */
    dodgeBuffPct: number;
    dodgeBuffMs: number;
    /** ATK / DEF buffs. */
    atkBuffPct: number;
    atkBuffMs: number;
    defBuffPct: number;
    defBuffMs: number;
    /** Attack speed multiplier from buffs. 1 = unchanged. */
    asMult: number;
    asMultMs: number;
    /** Crit chance flat boost. */
    partyCritPct: number;
    partyCritMs: number;
    /** Defence-pen percent active for outgoing hits. */
    defPenPct: number;
    defPenMs: number;
    /** Marks placed on this combatant (read by attackers). */
    markAmp: Array<{ mult: number; count: number; remainingMs: number }>;
    markAmpAll: { mult: number; remainingMs: number } | null;
    markNoHealMs: number;
    enemyAtkDownPct: number;
    enemyAtkDownMs: number;
    enemyNoHealMs: number;
    /** Caster lifesteal queue — heal caster N% of damage from next M ally attacks. */
    lifestealNext: Array<{ pct: number; count: number; ownerId?: string }>;
    /** Heal-ally trigger — next N ally attacks heal lowest ally for percent of max HP. */
    nextAllyHeal: Array<{ pct: number; count: number }>;
    /** Instant-kill chance buff applied to the next N ally attacks. */
    nextAllyInstantKillPct: Array<{ pct: number; count: number }>;
    /**
     * 2026-05 v6: Mage Tarcza Many — drains incoming damage from MP first
     * (100%), HP only takes the overflow if MP hits 0. Self-only buff,
     * never propagates to allies. ms remaining on the buff window.
     */
    manaShieldMs: number;
    /**
     * 2026-05 v7: Necromancer Mroczny Rytuał (`dark_ritual:dur:pct`).
     * Marks the target — after `triggerInMs` ms (game-time) the target
     * loses `pctOfMaxHp%` of THEIR max HP. View renders a countdown
     * badge on the enemy card while pending. Multiple casts queue
     * independently. Drained by `tickStatus`; fires + removes the
     * entry when the timer hits 0.
     */
    darkRitualPending: Array<{ triggerInMs: number; pctOfMaxHp: number }>;
}

export const newStatusState = (): IStatusState => ({
    stunMs: 0,
    immortalMs: 0,
    cannotDieMs: 0,
    cannotDieReviveAt: null,
    dots: [],
    dmgAmpNext: [],
    critNext: [],
    critBuffNext: 0,
    critBuffPct: 0,
    critBuffMs: 0,
    dodgeNext: [],
    dodgeBuffPct: 0,
    dodgeBuffMs: 0,
    atkBuffPct: 0,
    atkBuffMs: 0,
    defBuffPct: 0,
    defBuffMs: 0,
    asMult: 1,
    asMultMs: 0,
    partyCritPct: 0,
    partyCritMs: 0,
    defPenPct: 0,
    defPenMs: 0,
    markAmp: [],
    markAmpAll: null,
    markNoHealMs: 0,
    enemyAtkDownPct: 0,
    enemyAtkDownMs: 0,
    enemyNoHealMs: 0,
    lifestealNext: [],
    nextAllyHeal: [],
    nextAllyInstantKillPct: [],
    manaShieldMs: 0,
    darkRitualPending: [],
});

/**
 * Returns true when this combatant cannot act THIS TICK (stunned / paralyzed).
 * Combat views must early-return from basic-attack / skill-cast for this
 * combatant when this is true.
 */
export const isStunned = (s: IStatusState): boolean => s.stunMs > 0;

/**
 * Decrement timers / prune expired effects. Returns the cumulative DOT damage
 * dealt this tick (caller subtracts from HP) so the view can also push
 * floating numbers / log entries.
 *
 * Also returns `darkRitualDamage` — flat HP loss the caller MUST subtract
 * from the same target this tick whenever a `dark_ritual` mark expired.
 * Each expired entry contributes `floor(targetMaxHp × pctOfMaxHp / 100)`
 * damage; multiple stacked rituals on one target are summed. The view
 * renders a :skull: RITUAL float when this is > 0.
 */
export const tickStatus = (s: IStatusState, deltaMs: number, targetMaxHp: number): { dotDamage: number; darkRitualDamage: number; darkRitualTriggered: boolean } => {
    const drain = (n: number) => Math.max(0, n - deltaMs);
    s.stunMs = drain(s.stunMs);
    s.immortalMs = drain(s.immortalMs);
    s.cannotDieMs = drain(s.cannotDieMs);
    s.manaShieldMs = drain(s.manaShieldMs);
    s.critBuffMs = drain(s.critBuffMs);
    if (s.critBuffMs <= 0) s.critBuffPct = 0;
    s.dodgeBuffMs = drain(s.dodgeBuffMs);
    if (s.dodgeBuffMs <= 0) s.dodgeBuffPct = 0;
    s.atkBuffMs = drain(s.atkBuffMs);
    if (s.atkBuffMs <= 0) s.atkBuffPct = 0;
    s.defBuffMs = drain(s.defBuffMs);
    if (s.defBuffMs <= 0) s.defBuffPct = 0;
    s.asMultMs = drain(s.asMultMs);
    if (s.asMultMs <= 0) s.asMult = 1;
    s.partyCritMs = drain(s.partyCritMs);
    if (s.partyCritMs <= 0) s.partyCritPct = 0;
    s.defPenMs = drain(s.defPenMs);
    if (s.defPenMs <= 0) s.defPenPct = 0;
    s.markNoHealMs = drain(s.markNoHealMs);
    s.enemyAtkDownMs = drain(s.enemyAtkDownMs);
    if (s.enemyAtkDownMs <= 0) s.enemyAtkDownPct = 0;
    s.enemyNoHealMs = drain(s.enemyNoHealMs);

    s.markAmp = s.markAmp
        .map((m) => ({ ...m, remainingMs: Math.max(0, m.remainingMs - deltaMs) }))
        .filter((m) => m.remainingMs > 0 && m.count > 0);
    if (s.markAmpAll) {
        s.markAmpAll.remainingMs = Math.max(0, s.markAmpAll.remainingMs - deltaMs);
        if (s.markAmpAll.remainingMs <= 0) s.markAmpAll = null;
    }

    let dotDamage = 0;
    if (s.dots.length > 0) {
        const survivors: Array<{ remainingMs: number; pctPerSec: number }> = [];
        for (const dot of s.dots) {
            const elapsedSec = deltaMs / 1000;
            dotDamage += Math.floor(targetMaxHp * (dot.pctPerSec / 100) * elapsedSec);
            const next = dot.remainingMs - deltaMs;
            if (next > 0) survivors.push({ remainingMs: next, pctPerSec: dot.pctPerSec });
        }
        s.dots = survivors;
    }

    // Necromancer Mroczny Rytuał — drain each pending entry by deltaMs.
    // When an entry's countdown hits 0, fire its damage and remove it.
    // `deltaMs` already accounts for combat speed (caller passes the
    // game-time delta, e.g. 500ms × speedMult), so x2/x4 trigger faster
    // for free.
    let darkRitualDamage = 0;
    let darkRitualTriggered = false;
    if (s.darkRitualPending.length > 0) {
        const survivors: Array<{ triggerInMs: number; pctOfMaxHp: number }> = [];
        for (const r of s.darkRitualPending) {
            const next = r.triggerInMs - deltaMs;
            if (next <= 0) {
                darkRitualDamage += Math.max(1, Math.floor(targetMaxHp * (r.pctOfMaxHp / 100)));
                darkRitualTriggered = true;
            } else {
                survivors.push({ triggerInMs: next, pctOfMaxHp: r.pctOfMaxHp });
            }
        }
        s.darkRitualPending = survivors;
    }

    return { dotDamage, darkRitualDamage, darkRitualTriggered };
};

// -- Application helpers (mutate state) --------------------------------------

/**
 * Apply a parsed list of effects to (caster, target) state objects. Returns
 * a small set of "side effects" the caller still has to process (AOE flag,
 * damage multipliers, instant-kill bool, summons spec, etc.) because those
 * touch the wider combat state (boss list, party array, summon allies).
 */
export interface IApplyResult {
    aoe: boolean;
    /** Damage multiplier to apply to THIS cast's hit, after baseline. */
    castDmgMult: number;
    /** % of target defence to ignore on this cast. */
    defPenPct: number;
    /** True -> cast oneshot kills target regardless of HP. */
    instantKill: boolean;
    /**
     * Original `instant_kill_chance:N` percent — preserved so AOE callers
     * can re-roll the chance for each splash target (Strzała Wszechświata
     * `aoe;instant_kill_chance:15` should give every wave monster its own
     * 15% IK roll, not just the primary target). 0 when no IK atom.
     */
    instantKillPct: number;
    /** % of damage dealt that should heal caster (post-hit). */
    healCasterPctOfDmg: number;
    /** Direct heal amount (% of caster max HP). */
    healCasterPctOfMaxHp: number;
    /** Lowest-ally heal — % of their max HP. */
    healLowestAllyPct: number;
    /** Party DOT heal — duration + % per sec. */
    healPartyDotMs: number;
    healPartyDotPctPerSec: number;
    /** Instant party heal — % of max HP applied to every alive ally. */
    healPartyPctInstant: number;
    /** Multistrike: fire N basic attacks immediately after this cast. */
    multistrike: number;
    /** Block next-party-hits counter to add. */
    addBlockNextPartyHits: number;
    /** Aggro-steal flag (raid only). */
    aggroSteal: boolean;
    /** Summon spec — caller spawns these. */
    summons: Array<{ type: 'skeleton' | 'ghost' | 'demon' | 'lich'; count: number }>;
    /** Execute-below threshold (% of target max HP); hit oneshots when HP% ≤ this. */
    executeBelowPct: number;
    /** Revive-party: protectMs + graceMs. */
    revivePartyProtectMs: number;
    revivePartyGraceMs: number;
    /**
     * 2026-05 v6: Cleric Aura Wskrzeszenia (`revive_party:0:0`) — set
     * to true whenever the atom appears in the cast effect, regardless
     * of its numeric args. Views check this and immediately raise any
     * dead party members to 50% HP. Without this flag the spell did
     * literally nothing because both protectMs and graceMs were 0 in
     * the spec.
     */
    reviveDeadAllies: boolean;
    /**
     * Duration (in-game ms) of the party-immortal window opened by
     * `party_immortal:N` (Cleric Wieża Bogów / Święta Apokalipsa).
     * 0 when no such atom in this cast. Views read this to push the
     * cast's spell anim on EVERY alive ally (so each card flashes
     * the buff) — without it, only the caster saw the animation.
     */
    partyImmortalMs: number;
    /**
     * 2026-05 v6: did a stun-class atom (stun, stun_chance, paralyze)
     * actually land THIS cast?
     *
     * Single-target casts: `stunApplied=true` when the primary target
     * was stunned. `aoeStunIdxs` stays empty.
     *
     * AOE casts: `aoeStunIdxs` lists the enemy-status indices (matches
     * the order of `enemyIds` passed to `castSkill`) that PASSED their
     * roll and were actually stunned this cast. `stunApplied` is true
     * iff that list is non-empty.
     *
     * Important for `stun_chance:30:…` — without per-target tracking
     * the view pushed ":dizzy: STUN" on every AOE target as soon as one
     * succeeded, instead of only on the dummies that actually got hit.
     */
    stunApplied: boolean;
    /** Per-enemy indices stunned this cast (AOE only). */
    aoeStunIdxs: number[];
    /** Same idea for paralyze (rendered as :locked: PARAL float, distinct kind). */
    paralyzeApplied: boolean;
    aoeParalyzeIdxs: number[];
    /**
     * 2026-05 v7: Necromancer Apokalipsa Śmierci (`death_apocalypse`).
     * Self-cost cast that drops the necro's HP to 20% of max (or to
     * 2% when already below 20%) and deals 50% of the target's max HP
     * as raw damage. Combined with `summon:skeleton:1` from the same
     * effect string for the full Necro 15 spec.
     *
     * Views read three flags:
     *   - `deathApocalypse` — the atom fired at all
     *   - `deathApocalypseSelfHpFloor` — fraction of caster max HP the
     *     swing leaves the caster at (0.2 or 0.02)
     *   - `deathApocalypseTargetMaxHpPct` — % of target max HP dealt
     *     as raw post-cap damage (50)
     */
    deathApocalypse: boolean;
    deathApocalypseSelfHpFloor: number;
    deathApocalypseTargetMaxHpPct: number;
}

const blank = (): IApplyResult => ({
    aoe: false,
    castDmgMult: 1,
    defPenPct: 0,
    instantKill: false,
    instantKillPct: 0,
    healCasterPctOfDmg: 0,
    healCasterPctOfMaxHp: 0,
    healLowestAllyPct: 0,
    healPartyDotMs: 0,
    healPartyDotPctPerSec: 0,
    healPartyPctInstant: 0,
    multistrike: 0,
    addBlockNextPartyHits: 0,
    aggroSteal: false,
    summons: [],
    executeBelowPct: 0,
    revivePartyProtectMs: 0,
    revivePartyGraceMs: 0,
    reviveDeadAllies: false,
    partyImmortalMs: 0,
    stunApplied: false,
    aoeStunIdxs: [],
    paralyzeApplied: false,
    aoeParalyzeIdxs: [],
    deathApocalypse: false,
    deathApocalypseSelfHpFloor: 0,
    deathApocalypseTargetMaxHpPct: 0,
});

/**
 * Apply all effects from `parsed` to the relevant state objects.
 *
 * @param parsed       atoms from `parseEffects(effect)`
 * @param casterStatus mutable status state of the caster
 * @param targetStatus mutable status state of the primary target (null when no
 *                     target — e.g. pure self-buff casts)
 * @param targetHpPct  target HP% (0..100) — used for `execute_below`
 * @param partyStatus  mutable status states of all allies including caster —
 *                     used for party_* effects
 * @param enemyStatus  mutable status states of all alive enemies — used for
 *                     enemy_* effects + AOE marks
 */
export const applyEffects = (
    parsed: IParsedEffect[],
    casterStatus: IStatusState,
    targetStatus: IStatusState | null,
    targetHpPct: number,
    partyStatus: IStatusState[],
    enemyStatus: IStatusState[],
): IApplyResult => {
    const r = blank();
    // 2026-05 v6: pre-detect AOE so stun / stun_chance / paralyze /
    // dot atoms know to spread to ALL enemy statuses rather than just
    // the primary target. Without this, Meteor (`aoe;stun:3000`) only
    // stunned the primary target while the splash damage ate everyone.
    const isAoeCast = parsed.some((p) => p.key === 'aoe');
    for (const e of parsed) {
        switch (e.key) {
            case 'aoe': r.aoe = true; break;
            case 'def_pen': r.defPenPct = Math.max(r.defPenPct, e.a ?? 0); break;
            case 'dmg_amp_next': {
                // 2026-05 v6: cap status queue at chargesToAdd × 2 entries
                // PER MULT so spamming the spell can't bypass the BuffBar
                // cap (e.g. Arcane Bolt `dmg_amp_next:3:1` should give max
                // 2 amped attacks across all casts; Strzał Boga
                // `dmg_amp_next:2:8` should give max 16). Merges new charges
                // into existing same-mult entry instead of pushing.
                const m = e.a ?? 1;
                const add = e.b ?? 1;
                const cap = Math.max(1, add * 2);
                const existing = casterStatus.dmgAmpNext.find((d) => d.mult === m);
                if (existing) {
                    existing.count = Math.min(cap, existing.count + add);
                } else {
                    casterStatus.dmgAmpNext.push({ mult: m, count: Math.min(cap, add) });
                }
                break;
            }
            case 'crit_buff_next':
                casterStatus.critBuffNext = Math.max(casterStatus.critBuffNext, e.a ?? 0);
                break;
            case 'crit_buff':
                casterStatus.critBuffPct = Math.max(casterStatus.critBuffPct, e.a ?? 0);
                casterStatus.critBuffMs = Math.max(casterStatus.critBuffMs, e.b ?? 0);
                break;
            case 'crit_next': {
                // Cap to chargesToAdd × 2 per mult bucket (same rule as
                // BuffBar) so multi-cast spam can't outpace the visible
                // counter.
                const m = e.a ?? 1;
                const add = e.b ?? 1;
                const cap = Math.max(1, add * 2);
                const existing = casterStatus.critNext.find((d) => d.mult === m);
                if (existing) {
                    existing.count = Math.min(cap, existing.count + add);
                } else {
                    casterStatus.critNext.push({ mult: m, count: Math.min(cap, add) });
                }
                break;
            }
            case 'multistrike':
                r.multistrike = Math.max(r.multistrike, Math.floor(e.a ?? 0));
                break;
            case 'stun': {
                // AOE+stun (Meteor) -> stun every alive enemy. Single-target
                // (Pułapka, Strzała Wiatru, Cewka Śmierci) -> primary only.
                const dur = e.a ?? 0;
                if (dur > 0) {
                    if (isAoeCast) {
                        for (let i = 0; i < enemyStatus.length; i++) {
                            enemyStatus[i].stunMs = Math.max(enemyStatus[i].stunMs, dur);
                            if (!r.aoeStunIdxs.includes(i)) r.aoeStunIdxs.push(i);
                        }
                        if (enemyStatus.length > 0) r.stunApplied = true;
                    } else if (targetStatus) {
                        targetStatus.stunMs = Math.max(targetStatus.stunMs, dur);
                        r.stunApplied = true;
                    }
                }
                break;
            }
            case 'stun_chance': {
                // Each AOE target gets its own roll so the random chance
                // is distributed (not just primary). Single-target rolls
                // once on the primary. r.aoeStunIdxs lists ONLY the
                // indices that passed their roll — the view uses that
                // to push ":dizzy: STUN" on the right dummies (the previous
                // r.stunApplied bool flashed STUN on every AOE target
                // as soon as one succeeded).
                const pct = e.a ?? 0;
                const dur = e.b ?? 0;
                if (isAoeCast) {
                    for (let i = 0; i < enemyStatus.length; i++) {
                        if (Math.random() * 100 < pct) {
                            enemyStatus[i].stunMs = Math.max(enemyStatus[i].stunMs, dur);
                            if (!r.aoeStunIdxs.includes(i)) r.aoeStunIdxs.push(i);
                            r.stunApplied = true;
                        }
                    }
                } else if (targetStatus && Math.random() * 100 < pct) {
                    targetStatus.stunMs = Math.max(targetStatus.stunMs, dur);
                    r.stunApplied = true;
                }
                break;
            }
            case 'paralyze': {
                const dur = e.a ?? 0;
                if (dur > 0) {
                    if (isAoeCast) {
                        for (let i = 0; i < enemyStatus.length; i++) {
                            enemyStatus[i].stunMs = Math.max(enemyStatus[i].stunMs, dur);
                            if (!r.aoeParalyzeIdxs.includes(i)) r.aoeParalyzeIdxs.push(i);
                        }
                        if (enemyStatus.length > 0) r.paralyzeApplied = true;
                    } else if (targetStatus) {
                        targetStatus.stunMs = Math.max(targetStatus.stunMs, dur);
                        r.paralyzeApplied = true;
                    }
                }
                break;
            }
            case 'dot': {
                // AOE + DOT (Plaga) puts the DOT on every alive enemy.
                const remainingMs = e.a ?? 0;
                const pctPerSec = e.b ?? 0;
                if (isAoeCast) {
                    for (const en of enemyStatus) en.dots.push({ remainingMs, pctPerSec });
                } else if (targetStatus) {
                    targetStatus.dots.push({ remainingMs, pctPerSec });
                }
                break;
            }
            case 'instant_kill_chance':
                // Track the percent so AOE callers can re-roll per
                // splash target. Primary roll happens here.
                r.instantKillPct = Math.max(r.instantKillPct, e.a ?? 0);
                if (Math.random() * 100 < (e.a ?? 0)) r.instantKill = true;
                break;
            case 'execute_below':
                if (targetHpPct <= (e.a ?? 0)) r.instantKill = true;
                r.executeBelowPct = Math.max(r.executeBelowPct, e.a ?? 0);
                break;
            case 'mark_amp':
                if (targetStatus) targetStatus.markAmp.push({
                    mult: e.a ?? 1,
                    count: e.b ?? 1,
                    remainingMs: e.c ?? 0,
                });
                break;
            case 'mark_amp_all': {
                // Necromancer Kraina Śmierci `aoe;mark_amp_all:2:5000` —
                // every enemy hit by the AOE gets the duration-based
                // amp window so all subsequent attacks against ANY of
                // them deal ×mult damage. Single-target casts (theoretical
                // mark_amp_all without aoe) still land on the primary.
                const mult = e.a ?? 1;
                const dur = e.b ?? 0;
                if (isAoeCast) {
                    for (const en of enemyStatus) {
                        en.markAmpAll = { mult, remainingMs: dur };
                    }
                } else if (targetStatus) {
                    targetStatus.markAmpAll = { mult, remainingMs: dur };
                }
                break;
            }
            case 'mark_no_heal':
                if (targetStatus) targetStatus.markNoHealMs = Math.max(targetStatus.markNoHealMs, e.a ?? 0);
                break;
            case 'mark_heal_to_dmg':
                // Rogue Naznaczony na Śmierć — same mechanic as
                // mark_no_heal (applyIncomingHeal returns -rawHeal
                // when markNoHealMs > 0). The atom name is just a
                // semantic label; under the hood we re-use the
                // same status field so existing heal-routing code
                // (Arena Cleric heal, boss self-heals, etc.) auto-
                // matically reverses incoming heals into damage.
                if (targetStatus) targetStatus.markNoHealMs = Math.max(targetStatus.markNoHealMs, e.a ?? 0);
                break;
            case 'heal_self_pct_dmg':
                r.healCasterPctOfDmg = Math.max(r.healCasterPctOfDmg, e.a ?? 0);
                break;
            case 'heal_self_max_pct':
                r.healCasterPctOfMaxHp = Math.max(r.healCasterPctOfMaxHp, e.a ?? 0);
                break;
            case 'immortal':
                casterStatus.immortalMs = Math.max(casterStatus.immortalMs, e.a ?? 0);
                break;
            case 'mana_shield':
                // 2026-05 v6: Mage Tarcza Many — self-buff window during
                // which incoming damage drains MP first (100%), HP only
                // takes the overflow. Self-only — never propagates to
                // allies (engine call sites only check caster status).
                casterStatus.manaShieldMs = Math.max(casterStatus.manaShieldMs, e.a ?? 0);
                break;
            case 'dodge_next':
                casterStatus.dodgeNext.push({ count: e.a ?? 0, scope: ((e.s as 'non_magic' | 'all') ?? 'all') });
                break;
            case 'dodge_buff':
                casterStatus.dodgeBuffPct = Math.max(casterStatus.dodgeBuffPct, e.a ?? 0);
                casterStatus.dodgeBuffMs = Math.max(casterStatus.dodgeBuffMs, e.b ?? 0);
                break;
            case 'attack_up':
                casterStatus.atkBuffPct = Math.max(casterStatus.atkBuffPct, e.a ?? 0);
                casterStatus.atkBuffMs = Math.max(casterStatus.atkBuffMs, e.b ?? 0);
                break;
            case 'defense_up':
                casterStatus.defBuffPct = Math.max(casterStatus.defBuffPct, e.a ?? 0);
                casterStatus.defBuffMs = Math.max(casterStatus.defBuffMs, e.b ?? 0);
                break;
            case 'party_attack_up':
                for (const p of partyStatus) {
                    p.atkBuffPct = Math.max(p.atkBuffPct, e.a ?? 0);
                    p.atkBuffMs = Math.max(p.atkBuffMs, e.b ?? 0);
                }
                break;
            case 'party_defense_up':
                for (const p of partyStatus) {
                    p.defBuffPct = Math.max(p.defBuffPct, e.a ?? 0);
                    p.defBuffMs = Math.max(p.defBuffMs, e.b ?? 0);
                }
                break;
            case 'party_as_up':
                for (const p of partyStatus) {
                    p.asMult = Math.max(p.asMult, e.a ?? 1);
                    p.asMultMs = Math.max(p.asMultMs, e.b ?? 0);
                }
                break;
            case 'party_crit_up':
                for (const p of partyStatus) {
                    p.partyCritPct = Math.max(p.partyCritPct, e.a ?? 0);
                    p.partyCritMs = Math.max(p.partyCritMs, e.b ?? 0);
                }
                break;
            case 'party_def_pen':
                for (const p of partyStatus) {
                    p.defPenPct = Math.max(p.defPenPct, e.a ?? 0);
                    p.defPenMs = Math.max(p.defPenMs, e.b ?? 0);
                }
                break;
            case 'party_immortal':
                // Cleric Wieża Bogów / Święta Apokalipsa — every party
                // member becomes truly invincible for `e.a` ms (BLOCK
                // every incoming hit, no damage taken). Was previously
                // setting `cannotDieMs` which only clamps HP at 1 —
                // the player could still take 99% chunks. Use
                // `immortalMs` instead so `applyIncomingDamage` returns
                // 0 hpDelta. View-side checks on each ally's status
                // (Boss/Trainer/etc.) read immortalMs > 0 and flash a
                // BLOCK float instead of reducing HP.
                for (const p of partyStatus) {
                    p.immortalMs = Math.max(p.immortalMs, e.a ?? 0);
                }
                r.partyImmortalMs = Math.max(r.partyImmortalMs, e.a ?? 0);
                break;
            case 'heal_lowest_ally_pct':
                r.healLowestAllyPct = Math.max(r.healLowestAllyPct, e.a ?? 0);
                break;
            case 'heal_party_dot':
                r.healPartyDotMs = Math.max(r.healPartyDotMs, e.a ?? 0);
                r.healPartyDotPctPerSec = Math.max(r.healPartyDotPctPerSec, e.b ?? 0);
                break;
            case 'heal_party_pct':
                r.healPartyPctInstant = Math.max(r.healPartyPctInstant, e.a ?? 0);
                break;
            case 'block_next_party':
                r.addBlockNextPartyHits += e.a ?? 0;
                break;
            case 'revive_party':
                r.revivePartyProtectMs = e.a ?? 0;
                r.revivePartyGraceMs = e.b ?? 0;
                // Always flag the cast as a revive — view raises any dead
                // ally on the spot. The protectMs / graceMs args set up
                // the cannot-die window for survivors (Tower of Gods'
                // 5s) but the revive itself fires unconditionally.
                r.reviveDeadAllies = true;
                for (const p of partyStatus) p.cannotDieMs = Math.max(p.cannotDieMs, e.a ?? 0);
                break;
            case 'next_ally_heal': {
                // Sąd Boży `next_ally_heal:7.5:3` — buff lives on the
                // CASTER only (per spec: "tylko moja postać ma kolejne
                // ataki się leczyć, nie sojusznicy"). Caster's next 3
                // basic attacks heal the caster for 7.5% of their max
                // HP. Stack cap = chargesToAdd × 2 = 6 ("two casts
                // worth"). Allies never get the queue, so their basic
                // attacks don't trigger any heal from this buff.
                const pct = e.a ?? 0;
                const add = e.b ?? 0;
                const cap = Math.max(1, add * 2);
                const existing = casterStatus.nextAllyHeal.find((d) => d.pct === pct);
                if (existing) {
                    existing.count = Math.min(cap, existing.count + add);
                } else {
                    casterStatus.nextAllyHeal.push({ pct, count: Math.min(cap, add) });
                }
                break;
            }
            case 'party_lifesteal_next': {
                // Boski Filar `party_lifesteal_next:100:5` — flat cap
                // of `add` (no ×2 doubling, per spec "Max stack 5").
                // Re-casts refresh up to the cap, never above.
                const pct = e.a ?? 0;
                const add = e.b ?? 0;
                const cap = Math.max(1, add);
                for (const p of partyStatus) {
                    const existing = p.lifestealNext.find((d) => d.pct === pct);
                    if (existing) {
                        existing.count = Math.min(cap, existing.count + add);
                    } else {
                        p.lifestealNext.push({ pct, count: Math.min(cap, add) });
                    }
                }
                break;
            }
            case 'party_instant_kill_chance_next':
                for (const p of partyStatus) {
                    p.nextAllyInstantKillPct.push({ pct: e.a ?? 0, count: e.b ?? 0 });
                }
                break;
            case 'aggro_steal':
                r.aggroSteal = true;
                break;
            case 'enemy_atk_down':
                for (const en of enemyStatus) {
                    en.enemyAtkDownPct = Math.max(en.enemyAtkDownPct, e.a ?? 0);
                    en.enemyAtkDownMs = Math.max(en.enemyAtkDownMs, e.b ?? 0);
                }
                break;
            case 'enemy_no_heal':
                for (const en of enemyStatus) {
                    en.enemyNoHealMs = Math.max(en.enemyNoHealMs, e.a ?? 0);
                }
                break;
            case 'summon': {
                // Atom shape: `summon:<type>:<count>` (e.g.
                // `summon:skeleton:1`). parseEffects puts the type
                // string into `e.s` (not finite as a number) and the
                // count into `e.b` (the SECOND positional arg; the
                // FIRST arg `e.a` was never set because it was the
                // type). Old code read `e.a` for count which always
                // evaluated to undefined -> 0 -> no spawn. That's why
                // the trainer never spawned anything regardless of
                // how many times the user clicked the spell.
                const type = (e.s ?? '').toLowerCase();
                const count = e.b ?? e.a ?? 0;
                if ((type === 'skeleton' || type === 'ghost' || type === 'demon' || type === 'lich') && count > 0) {
                    r.summons.push({ type, count });
                }
                break;
            }
            case 'dark_ritual': {
                // Necromancer Mroczny Rytuał `dark_ritual:dur:pct` —
                // mark the primary target with a delayed-damage entry
                // that fires `pct%` of THEIR max HP after `dur` ms of
                // game-time. tickStatus drains the timer × speedMult
                // so x2/x4 fire faster (5s / 2.5s wall instead of 10s).
                if (targetStatus) {
                    const dur = e.a ?? 0;
                    const pct = e.b ?? 0;
                    if (dur > 0 && pct > 0) {
                        targetStatus.darkRitualPending.push({
                            triggerInMs: dur,
                            pctOfMaxHp: pct,
                        });
                    }
                }
                break;
            }
            case 'death_apocalypse': {
                // Necromancer Apokalipsa Śmierci — flag the cast so the
                // view applies:
                //   - self-cost: drop caster HP to 20% of max, or to 2%
                //     when already below 20% (high-risk burst)
                //   - target damage: 50% of target's CURRENT max HP
                //     (raw, defense-pen ignored — pure HP strip)
                //   - the paired `summon:skeleton:1` atom fires through
                //     the normal summon path so the skeleton spawns
                //     for free with the same cast.
                r.deathApocalypse = true;
                r.deathApocalypseSelfHpFloor = 0.20; // drop to 20% normally; 3% when below 20% (handled by view)
                r.deathApocalypseTargetMaxHpPct = 50;
                break;
            }
            default:
                break;
        }
    }
    return r;
};

// -- Hit-time helpers --------------------------------------------------------

/**
 * Resolve a single basic-attack hit accounting for the attacker's amp queues
 * + the target's marks / dodges / immortal flag. Returns the post-mods
 * damage and a couple of side effects (was-dodged, was-instant-killed via
 * mark, etc.) the caller still has to apply.
 *
 * `attackerClass` informs the dodge scope: `non_magic` skips when attacker
 * is Mage / Cleric / Necromancer.
 */
export interface IBasicHitResolution {
    damage: number;
    dodged: boolean;
    /** True if the attacker had a `crit_next` queue entry consumed; caller
     *  may want to render a crit-flash. */
    wasCrit: boolean;
    critMult: number;
    /** Damage that goes back to the attacker as heal (lifesteal queue). */
    casterHeal: number;
    /** This hit also instant-kills (party-wide instant-kill buff fired). */
    instantKill: boolean;
    /** Heal target produced by `next_ally_heal`. % of caster's max HP. */
    healLowestAllyPct: number;
}

const MAGIC_CLASSES = new Set(['Mage', 'Cleric', 'Necromancer']);

export const resolveBasicHit = (
    attackerStatus: IStatusState,
    attackerClass: string | undefined,
    attackerBaseDmg: number,
    targetStatus: IStatusState,
): IBasicHitResolution => {
    const out: IBasicHitResolution = {
        damage: attackerBaseDmg,
        dodged: false,
        wasCrit: false,
        critMult: 1,
        casterHeal: 0,
        instantKill: false,
        healLowestAllyPct: 0,
    };
    // Dodge — `dodgeNext` queue first (ordered consumes), then dodge buff %.
    if (attackerStatus && targetStatus.dodgeNext.length > 0) {
        const top = targetStatus.dodgeNext[0];
        const isMagic = MAGIC_CLASSES.has(attackerClass ?? '');
        const dodgesThis = top.scope === 'all' || !isMagic;
        if (dodgesThis && top.count > 0) {
            top.count -= 1;
            if (top.count <= 0) targetStatus.dodgeNext.shift();
            out.dodged = true;
            out.damage = 0;
            return out;
        }
    }
    if (targetStatus.dodgeBuffMs > 0 && targetStatus.dodgeBuffPct > 0) {
        if (Math.random() * 100 < targetStatus.dodgeBuffPct) {
            out.dodged = true;
            out.damage = 0;
            return out;
        }
    }
    // Crit — guaranteed `crit_next` queue first; otherwise fall back to a
    // simple buff roll (caller can still re-roll natural crit on top).
    if (attackerStatus.critNext.length > 0) {
        const top = attackerStatus.critNext[0];
        if (top.count > 0) {
            top.count -= 1;
            if (top.count <= 0) attackerStatus.critNext.shift();
            out.wasCrit = true;
            out.critMult = Math.max(1, top.mult);
            out.damage *= out.critMult;
        }
    } else if (attackerStatus.critBuffNext > 0) {
        if (Math.random() * 100 < attackerStatus.critBuffNext) {
            out.wasCrit = true;
            out.critMult = 2;
            out.damage *= 2;
        }
        attackerStatus.critBuffNext = 0;
    }
    // dmg_amp_next queue.
    if (attackerStatus.dmgAmpNext.length > 0) {
        const top = attackerStatus.dmgAmpNext[0];
        out.damage *= top.mult;
        top.count -= 1;
        if (top.count <= 0) attackerStatus.dmgAmpNext.shift();
    }
    // ATK buff %.
    if (attackerStatus.atkBuffMs > 0) {
        out.damage *= 1 + attackerStatus.atkBuffPct / 100;
    }
    // Mark amp (count-based).
    if (targetStatus.markAmp.length > 0) {
        const top = targetStatus.markAmp[0];
        out.damage *= top.mult;
        top.count -= 1;
        if (top.count <= 0) targetStatus.markAmp.shift();
    }
    // Mark amp-all (duration-based).
    if (targetStatus.markAmpAll && targetStatus.markAmpAll.remainingMs > 0) {
        out.damage *= targetStatus.markAmpAll.mult;
    }
    // Lifesteal queue (e.g. divine_pillar).
    if (attackerStatus.lifestealNext.length > 0) {
        const top = attackerStatus.lifestealNext[0];
        out.casterHeal = Math.floor(out.damage * (top.pct / 100));
        top.count -= 1;
        if (top.count <= 0) attackerStatus.lifestealNext.shift();
    }
    // Next-ally-heal queue (sad bozy / heal-on-attack).
    if (attackerStatus.nextAllyHeal.length > 0) {
        const top = attackerStatus.nextAllyHeal[0];
        out.healLowestAllyPct = Math.max(out.healLowestAllyPct, top.pct);
        top.count -= 1;
        if (top.count <= 0) attackerStatus.nextAllyHeal.shift();
    }
    // Instant-kill chance from party buff (bard universe song).
    if (attackerStatus.nextAllyInstantKillPct.length > 0) {
        const top = attackerStatus.nextAllyInstantKillPct[0];
        if (Math.random() * 100 < top.pct) out.instantKill = true;
        top.count -= 1;
        if (top.count <= 0) attackerStatus.nextAllyInstantKillPct.shift();
    }
    out.damage = Math.floor(out.damage);
    if (out.damage < 0) out.damage = 0;
    return out;
};

/**
 * Apply incoming damage to a combatant taking immortal / cannotDie /
 * mark_no_heal into account. Returns the actual delta to subtract from HP.
 */
export const applyIncomingDamage = (
    target: IStatusState,
    targetCurrentHp: number,
    rawDamage: number,
): { hpDelta: number; absorbed: boolean } => {
    if (target.immortalMs > 0) return { hpDelta: 0, absorbed: true };
    let hpDelta = -rawDamage;
    // cannotDie clamps HP to 1.
    if (target.cannotDieMs > 0) {
        const newHp = targetCurrentHp + hpDelta;
        if (newHp < 1) {
            hpDelta = -(targetCurrentHp - 1);
            return { hpDelta, absorbed: false };
        }
    }
    return { hpDelta, absorbed: false };
};

/**
 * Mage Tarcza Many — when active, drains incoming damage from MP first
 * (100%), HP only takes the overflow if MP runs out. Returns the split
 * the caller should subtract from each pool.
 *
 * Examples:
 *   100% HP, 100% MP, hit 20 dmg -> mp=20, hp=0
 *   100% HP,   1% MP, hit 20 dmg -> mp=1,  hp=19
 *   100% HP,   0% MP, hit 20 dmg -> mp=0,  hp=20 (shield uselesss without MP)
 */
export const applyManaShieldRedirect = (
    s: IStatusState | undefined,
    currentMp: number,
    rawDmg: number,
): { mpDmg: number; hpDmg: number; shieldActive: boolean } => {
    if (!s || s.manaShieldMs <= 0 || rawDmg <= 0) {
        return { mpDmg: 0, hpDmg: rawDmg, shieldActive: false };
    }
    const mpDmg = Math.min(rawDmg, Math.max(0, currentMp));
    const hpDmg = rawDmg - mpDmg;
    return { mpDmg, hpDmg, shieldActive: true };
};

/**
 * Heal a combatant. If they are mark_no_heal'd, the heal becomes damage instead.
 */
export const applyIncomingHeal = (
    target: IStatusState,
    rawHeal: number,
): { hpDelta: number } => {
    if (target.enemyNoHealMs > 0) return { hpDelta: 0 };
    if (target.markNoHealMs > 0) return { hpDelta: -rawHeal };
    return { hpDelta: rawHeal };
};

/**
 * Classify a skill's effect string into "where does the cast visually land?".
 *
 * - 'enemy': any atom that targets the opponent (stun, paralyze, dot, def_pen,
 *   mark_*, enemy_*, instant_kill_chance, execute_below). Animation should
 *   land on the targeted monster card.
 * - 'self': self-buff atoms only (crit_buff, attack_up, dodge_buff, immortal,
 *   party_*, dodge_next, crit_buff_next, dmg_amp_next, summon, aggro_steal,
 *   crit_next). Animation should land on the player avatar.
 * - 'none': no effect string / unrecognised -> defaults to enemy (we'd rather
 *   animate on the obvious target than silently swallow the cast).
 *
 * Combined with `skill.damage`: a `damage > 0` skill ALWAYS animates on the
 * enemy regardless of self-buff atoms (the spell still hits). A `damage === 0`
 * skill with enemy-targeting atoms (Pułapka — `stun:3000`, damage 0) still
 * animates on the enemy because the stun is meant to land THERE — the user
 * complaint was that pure-buff classification routed Pułapka's anim to the
 * player avatar instead of the trapped monster.
 */
const ENEMY_AFFINITY_HEADS = new Set<string>([
    'aoe', 'def_pen', 'dot', 'stun', 'stun_chance', 'paralyze',
    'instant_kill_chance', 'execute_below', 'mark_amp', 'mark_amp_all',
    'mark_no_heal', 'mark_heal_to_dmg', 'enemy_atk_down', 'enemy_no_heal',
    'multistrike', 'dark_ritual', 'death_apocalypse',
]);
export const skillTargetsEnemy = (effect: string | null | undefined): boolean => {
    if (!effect) return false;
    return effect.split(';').some((atom) => {
        const head = atom.trim().toLowerCase().split(':')[0];
        return ENEMY_AFFINITY_HEADS.has(head);
    });
};

/**
 * Consume the caster's "next basic attack" queues for a single hit and
 * return the modifiers the basic-attack damage path should apply.
 *
 * What it covers:
 *   - `crit_next:N:1` (Knight Ostateczny / Rogue Cios w Plecy etc.)  ------
 *      Forces the next N basic attacks to crit. Decrements the counter.
 *   - `crit_buff_next:N` (Archer Precyzyjny Strzał, +30% crit chance for
 *      one swing). Returns extra crit chance + zeroes the queue on use.
 *   - `crit_buff:N:durMs` (Orle Oko, timed +N% crit chance window).
 *      Adds the chance for as long as `critBuffMs > 0` — NOT consumed
 *      here, only ticked down by `tickStatus`.
 *   - `dmg_amp_next:M:N` (Klon Cienia / Bełt Arkański / Cięcie Boga,
 *      next N basic attacks deal × M damage). Returns the multiplier
 *      and decrements the counter.
 *
 * Hunt / Boss / Dungeon / Transform / Trainer all wrap their basic-attack
 * roll with this helper so a player who pressed Precyzyjny Strzał ACTUALLY
 * sees their next swing land with the +30% crit chance — previously this
 * was set on the caster status but never read by anything outside Arena.
 */
/**
 * 2026-05 v6: consume one charge of `mark_amp` (Necromancer Klątwa
 * Śmierci) from the target's status and return the damage multiplier
 * to apply to THIS hit. The mark is single-use per cast — first hit
 * on the marked target (basic OR spell, by ANY attacker) consumes
 * the charge and gets the boosted damage. Returns 1.0 when no mark
 * is active so call sites can multiply damage unconditionally.
 *
 * Wired into every combat view's damage path (Hunt / Boss / Dungeon
 * / Trainer / Transform / Raid). Without this helper the mark only
 * fired in Arena's resolveBasicHit; everywhere else the cast applied
 * the status field but no damage path ever read it.
 */
export const consumeTargetMarkAmp = (target: IStatusState | undefined): {
    mult: number;
    consumed: boolean;
} => {
    if (!target) return { mult: 1, consumed: false };

    // 2026-05 v7: stack count-based markAmp (Klątwa Śmierci) AND the
    // duration-based markAmpAll (Kraina Śmierci). The count one consumes
    // a charge per hit; the duration one passively multiplies every
    // hit while remainingMs > 0. Combined multiplier so casting both
    // marks on the same target multiplies their effects (rare but
    // legit — Klątwa ×6 on top of Kraina ×2 = ×12 for the first hit
    // in the window).
    let mult = 1;
    let consumed = false;

    // Count-based mark first (Klątwa Śmierci).
    if (target.markAmp.length > 0) {
        const top = target.markAmp[0];
        if (top.count <= 0 || (top.remainingMs ?? 0) <= 0) {
            // Stale entry — drop and try the next.
            target.markAmp.shift();
            const recur = consumeTargetMarkAmp(target);
            // Combine recursion result with markAmpAll below — but the
            // recursive call already factored markAmpAll once, so just
            // return its result. (Avoids double-counting the duration mark.)
            return recur;
        }
        mult *= top.mult || 1;
        consumed = true;
        top.count -= 1;
        if (top.count <= 0) target.markAmp.shift();
    }

    // Duration-based mark (Kraina Śmierci) — passive, never consumed,
    // expires via tickStatus when remainingMs hits 0.
    if (target.markAmpAll && target.markAmpAll.remainingMs > 0) {
        mult *= target.markAmpAll.mult || 1;
        // Don't flip `consumed` to true here — the count-based charge
        // is the one views log as "Klątwa Śmierci consumed". This atom
        // just contributes a passive multiplier.
    }

    if (mult === 1 && !consumed) return { mult: 1, consumed: false };
    return { mult, consumed };
};

export const consumeCasterBasicHitMods = (
    s: IStatusState | undefined,
): {
    extraCritChance: number;
    forceCrit: boolean;
    dmgMult: number;
    /** Lifesteal pct (0..100) of damage dealt this swing, from
     *  `party_lifesteal_next` (Boski Filar). 0 when no charge active. */
    lifestealPct: number;
    /** Heal-lowest-ally pct of caster max HP (0..100) from
     *  `next_ally_heal` (Sąd Boży). Fires AFTER the swing — caller
     *  picks the lowest-HP ally and bumps their HP. */
    nextAllyHealPct: number;
    /** Per-charge-buff consumption flags so the engine can mirror to
     *  BuffStore (drains the visible "×N" counter in the BuffBar). */
    consumed: {
        dmgAmpNext: boolean;
        critNext: boolean;
        critBuffNext: boolean;
        lifestealNext: boolean;
        nextAllyHeal: boolean;
    };
} => {
    if (!s) return {
        extraCritChance: 0, forceCrit: false, dmgMult: 1,
        lifestealPct: 0, nextAllyHealPct: 0,
        consumed: { dmgAmpNext: false, critNext: false, critBuffNext: false, lifestealNext: false, nextAllyHeal: false },
    };

    let forceCrit = false;
    let extraCritChance = 0;
    let dmgMult = 1;
    let lifestealPct = 0;
    let nextAllyHealPct = 0;
    const consumed = {
        dmgAmpNext: false,
        critNext: false,
        critBuffNext: false,
        lifestealNext: false,
        nextAllyHeal: false,
    };

    // crit_next:count:chance — `chance >= 1` means guaranteed crit.
    if (s.critNext.length > 0) {
        const top = s.critNext[0];
        if (top.count > 0) {
            // mult >= 1 -> 100% crit; otherwise interpret as fractional chance.
            if (top.mult >= 1 || Math.random() < top.mult) {
                forceCrit = true;
            }
            top.count -= 1;
            if (top.count <= 0) s.critNext.shift();
            consumed.critNext = true;
        }
    }
    // crit_buff_next:N — consumed in full on use.
    if (s.critBuffNext > 0) {
        extraCritChance += s.critBuffNext / 100;
        consumed.critBuffNext = true;
        s.critBuffNext = 0;
    }
    // crit_buff:N:durMs — timed window, not consumed (tickStatus drains it).
    if (s.critBuffMs > 0 && s.critBuffPct > 0) {
        extraCritChance += s.critBuffPct / 100;
    }
    // dmg_amp_next:M:N — next N attacks deal × M damage.
    if (s.dmgAmpNext.length > 0) {
        const top = s.dmgAmpNext[0];
        if (top.count > 0) {
            dmgMult *= top.mult || 1;
            top.count -= 1;
            if (top.count <= 0) s.dmgAmpNext.shift();
            consumed.dmgAmpNext = true;
        }
    }
    // attack_up_pct — flat ATK% buff window, scales the hit.
    if (s.atkBuffMs > 0 && s.atkBuffPct > 0) {
        dmgMult *= 1 + s.atkBuffPct / 100;
    }
    // party_lifesteal_next — Boski Filar. Each charge heals the
    // attacker for `pct%` of damage dealt this swing. Take the head
    // of the queue (the spec uses 1 mult bucket so this is a simple
    // FIFO) and decrement count.
    if (s.lifestealNext.length > 0) {
        const top = s.lifestealNext[0];
        if (top.count > 0) {
            lifestealPct = Math.max(lifestealPct, top.pct);
            top.count -= 1;
            if (top.count <= 0) s.lifestealNext.shift();
            consumed.lifestealNext = true;
        }
    }
    // next_ally_heal — Sąd Boży. Each charge triggers a "heal lowest
    // ally for pct% of caster max HP" effect on the attacker's swing.
    if (s.nextAllyHeal.length > 0) {
        const top = s.nextAllyHeal[0];
        if (top.count > 0) {
            nextAllyHealPct = Math.max(nextAllyHealPct, top.pct);
            top.count -= 1;
            if (top.count <= 0) s.nextAllyHeal.shift();
            consumed.nextAllyHeal = true;
        }
    }

    return { extraCritChance, forceCrit, dmgMult, lifestealPct, nextAllyHealPct, consumed };
};
