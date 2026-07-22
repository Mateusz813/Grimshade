import { rollCritMultiplier } from './combat';


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
    | 'aggro_steal'
    | 'enemy_atk_down'
    | 'enemy_slow'
    | 'enemy_no_heal'
    | 'summon'
    | 'dark_ritual'
    | 'death_apocalypse';

export interface IParsedEffect {
    key: EffectKey;
    a?: number;
    b?: number;
    c?: number;
    s?: string;
    raw: string;
}

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

export const hasEffect = (effects: IParsedEffect[], key: EffectKey): boolean =>
    effects.some((e) => e.key === key);

export const findEffect = (effects: IParsedEffect[], key: EffectKey): IParsedEffect | null =>
    effects.find((e) => e.key === key) ?? null;


export interface IStatusState {
    stunMs: number;
    immortalMs: number;
    cannotDieMs: number;
    cannotDieReviveAt: number | null;
    dots: Array<{ remainingMs: number; pctPerSec: number }>;
    dmgAmpNext: Array<{ mult: number; count: number }>;
    critNext: Array<{ mult: number; count: number }>;
    critBuffNext: number;
    critBuffPct: number;
    critBuffMs: number;
    dodgeNext: Array<{ count: number; scope: 'non_magic' | 'all' }>;
    dodgeBuffPct: number;
    dodgeBuffMs: number;
    atkBuffPct: number;
    atkBuffMs: number;
    defBuffPct: number;
    defBuffMs: number;
    asMult: number;
    asMultMs: number;
    partyCritPct: number;
    partyCritMs: number;
    defPenPct: number;
    defPenMs: number;
    markAmp: Array<{ mult: number; count: number; remainingMs: number }>;
    markAmpAll: { mult: number; remainingMs: number } | null;
    markNoHealMs: number;
    enemyAtkDownPct: number;
    enemyAtkDownMs: number;
    enemySlowPct: number;
    enemySlowMs: number;
    enemyNoHealMs: number;
    lifestealNext: Array<{ pct: number; count: number; ownerId?: string }>;
    nextAllyHeal: Array<{ pct: number; count: number }>;
    manaShieldMs: number;
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
    enemySlowPct: 0,
    enemySlowMs: 0,
    enemyNoHealMs: 0,
    lifestealNext: [],
    nextAllyHeal: [],
    manaShieldMs: 0,
    darkRitualPending: [],
});

export const isStunned = (s: IStatusState): boolean => s.stunMs > 0;

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
    s.enemySlowMs = drain(s.enemySlowMs);
    if (s.enemySlowMs <= 0) s.enemySlowPct = 0;
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


export interface IApplyResult {
    aoe: boolean;
    castDmgMult: number;
    defPenPct: number;
    instantKill: boolean;
    instantKillPct: number;
    executeBurstPct: number;
    healCasterPctOfDmg: number;
    healCasterPctOfMaxHp: number;
    healLowestAllyPct: number;
    healPartyDotMs: number;
    healPartyDotPctPerSec: number;
    healPartyPctInstant: number;
    multistrike: number;
    addBlockNextPartyHits: number;
    aggroSteal: boolean;
    summons: Array<{ type: 'skeleton' | 'ghost' | 'demon' | 'lich'; count: number }>;
    executeBelowPct: number;
    revivePartyProtectMs: number;
    revivePartyGraceMs: number;
    reviveDeadAllies: boolean;
    partyImmortalMs: number;
    stunApplied: boolean;
    aoeStunIdxs: number[];
    paralyzeApplied: boolean;
    aoeParalyzeIdxs: number[];
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
    executeBurstPct: 0,
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

export const applyEffects = (
    parsed: IParsedEffect[],
    casterStatus: IStatusState,
    targetStatus: IStatusState | null,
    targetHpPct: number,
    partyStatus: IStatusState[],
    enemyStatus: IStatusState[],
): IApplyResult => {
    const r = blank();
    const isAoeCast = parsed.some((p) => p.key === 'aoe');
    for (const e of parsed) {
        switch (e.key) {
            case 'aoe': r.aoe = true; break;
            case 'def_pen': r.defPenPct = Math.max(r.defPenPct, e.a ?? 0); break;
            case 'dmg_amp_next': {
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
                r.instantKillPct = Math.max(r.instantKillPct, e.a ?? 0);
                if (Math.random() * 100 < (e.a ?? 0)) r.executeBurstPct = 12;
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
                r.reviveDeadAllies = true;
                for (const p of partyStatus) p.cannotDieMs = Math.max(p.cannotDieMs, e.a ?? 0);
                break;
            case 'next_ally_heal': {
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
            case 'aggro_steal':
                r.aggroSteal = true;
                break;
            case 'enemy_atk_down':
                for (const en of enemyStatus) {
                    en.enemyAtkDownPct = Math.max(en.enemyAtkDownPct, e.a ?? 0);
                    en.enemyAtkDownMs = Math.max(en.enemyAtkDownMs, e.b ?? 0);
                }
                break;
            case 'enemy_slow': {
                const slowTargets = isAoeCast ? enemyStatus : (targetStatus ? [targetStatus] : []);
                for (const en of slowTargets) {
                    en.enemySlowPct = Math.max(en.enemySlowPct, e.a ?? 0);
                    en.enemySlowMs = Math.max(en.enemySlowMs, e.b ?? 0);
                }
                break;
            }
            case 'enemy_no_heal':
                for (const en of enemyStatus) {
                    en.enemyNoHealMs = Math.max(en.enemyNoHealMs, e.a ?? 0);
                }
                break;
            case 'summon': {
                const type = (e.s ?? '').toLowerCase();
                const count = e.b ?? e.a ?? 0;
                if ((type === 'skeleton' || type === 'ghost' || type === 'demon' || type === 'lich') && count > 0) {
                    r.summons.push({ type, count });
                }
                break;
            }
            case 'dark_ritual': {
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
                r.deathApocalypse = true;
                r.deathApocalypseSelfHpFloor = 0.20;
                r.deathApocalypseTargetMaxHpPct = 12;
                break;
            }
            default:
                break;
        }
    }
    return r;
};


export interface IBasicHitResolution {
    damage: number;
    dodged: boolean;
    wasCrit: boolean;
    critMult: number;
    casterHeal: number;
    instantKill: boolean;
    executeBurstPct: number;
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
        executeBurstPct: 0,
        healLowestAllyPct: 0,
    };
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
            out.critMult = rollCritMultiplier();
            out.damage *= out.critMult;
        }
        attackerStatus.critBuffNext = 0;
    }
    if (attackerStatus.dmgAmpNext.length > 0) {
        const top = attackerStatus.dmgAmpNext[0];
        out.damage *= top.mult;
        top.count -= 1;
        if (top.count <= 0) attackerStatus.dmgAmpNext.shift();
    }
    if (attackerStatus.atkBuffMs > 0) {
        out.damage *= 1 + attackerStatus.atkBuffPct / 100;
    }
    if (targetStatus.markAmp.length > 0) {
        const top = targetStatus.markAmp[0];
        out.damage *= top.mult;
        top.count -= 1;
        if (top.count <= 0) targetStatus.markAmp.shift();
    }
    if (targetStatus.markAmpAll && targetStatus.markAmpAll.remainingMs > 0) {
        out.damage *= targetStatus.markAmpAll.mult;
    }
    if (attackerStatus.lifestealNext.length > 0) {
        const top = attackerStatus.lifestealNext[0];
        out.casterHeal = Math.floor(out.damage * (top.pct / 100));
        top.count -= 1;
        if (top.count <= 0) attackerStatus.lifestealNext.shift();
    }
    if (attackerStatus.nextAllyHeal.length > 0) {
        const top = attackerStatus.nextAllyHeal[0];
        out.healLowestAllyPct = Math.max(out.healLowestAllyPct, top.pct);
        top.count -= 1;
        if (top.count <= 0) attackerStatus.nextAllyHeal.shift();
    }
    out.damage = Math.floor(out.damage);
    if (out.damage < 0) out.damage = 0;
    return out;
};

export const applyIncomingDamage = (
    target: IStatusState,
    targetCurrentHp: number,
    rawDamage: number,
): { hpDelta: number; absorbed: boolean } => {
    if (target.immortalMs > 0) return { hpDelta: 0, absorbed: true };
    let hpDelta = -rawDamage;
    if (target.cannotDieMs > 0) {
        const newHp = targetCurrentHp + hpDelta;
        if (newHp < 1) {
            hpDelta = -(targetCurrentHp - 1);
            return { hpDelta, absorbed: false };
        }
    }
    return { hpDelta, absorbed: false };
};

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

export const applyIncomingHeal = (
    target: IStatusState,
    rawHeal: number,
): { hpDelta: number } => {
    if (target.enemyNoHealMs > 0) return { hpDelta: 0 };
    if (target.markNoHealMs > 0) return { hpDelta: -rawHeal };
    return { hpDelta: rawHeal };
};

const ENEMY_AFFINITY_HEADS = new Set<string>([
    'aoe', 'def_pen', 'dot', 'stun', 'stun_chance', 'paralyze',
    'instant_kill_chance', 'execute_below', 'mark_amp', 'mark_amp_all',
    'mark_no_heal', 'mark_heal_to_dmg', 'enemy_atk_down', 'enemy_slow', 'enemy_no_heal',
    'multistrike', 'dark_ritual', 'death_apocalypse',
]);
export const skillTargetsEnemy = (effect: string | null | undefined): boolean => {
    if (!effect) return false;
    return effect.split(';').some((atom) => {
        const head = atom.trim().toLowerCase().split(':')[0];
        return ENEMY_AFFINITY_HEADS.has(head);
    });
};

export const consumeTargetMarkAmp = (target: IStatusState | undefined): {
    mult: number;
    consumed: boolean;
} => {
    if (!target) return { mult: 1, consumed: false };

    let mult = 1;
    let consumed = false;

    if (target.markAmp.length > 0) {
        const top = target.markAmp[0];
        if (top.count <= 0 || (top.remainingMs ?? 0) <= 0) {
            target.markAmp.shift();
            const recur = consumeTargetMarkAmp(target);
            return recur;
        }
        mult *= top.mult || 1;
        consumed = true;
        top.count -= 1;
        if (top.count <= 0) target.markAmp.shift();
    }

    if (target.markAmpAll && target.markAmpAll.remainingMs > 0) {
        mult *= target.markAmpAll.mult || 1;
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
    lifestealPct: number;
    nextAllyHealPct: number;
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

    if (s.critNext.length > 0) {
        const top = s.critNext[0];
        if (top.count > 0) {
            if (top.mult >= 1 || Math.random() < top.mult) {
                forceCrit = true;
            }
            top.count -= 1;
            if (top.count <= 0) s.critNext.shift();
            consumed.critNext = true;
        }
    }
    if (s.critBuffNext > 0) {
        extraCritChance += s.critBuffNext / 100;
        consumed.critBuffNext = true;
        s.critBuffNext = 0;
    }
    if (s.critBuffMs > 0 && s.critBuffPct > 0) {
        extraCritChance += s.critBuffPct / 100;
    }
    if (s.dmgAmpNext.length > 0) {
        const top = s.dmgAmpNext[0];
        if (top.count > 0) {
            dmgMult *= top.mult || 1;
            top.count -= 1;
            if (top.count <= 0) s.dmgAmpNext.shift();
            consumed.dmgAmpNext = true;
        }
    }
    if (s.atkBuffMs > 0 && s.atkBuffPct > 0) {
        dmgMult *= 1 + s.atkBuffPct / 100;
    }
    if (s.lifestealNext.length > 0) {
        const top = s.lifestealNext[0];
        if (top.count > 0) {
            lifestealPct = Math.max(lifestealPct, top.pct);
            top.count -= 1;
            if (top.count <= 0) s.lifestealNext.shift();
            consumed.lifestealNext = true;
        }
    }
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
