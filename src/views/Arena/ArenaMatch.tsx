import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { useArenaStore } from '../../stores/arenaStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import {
    CombatHudHost,
    CombatArena,
    CombatTopControls,
    CombatSubControls,
    CombatActionBar,
    type ICombatEnemy,
    type ICombatAlly,
    type ICombatSkillSlot,
} from '../../components/organisms/CombatUI';
import '../../components/organisms/CombatUI/CombatUI.scss';
import { useCombatFx } from '../../hooks/useCombatFx';
import { getSkillIcon } from '../../data/skillIcons';
import { getCharacterAvatar } from '../../data/classAvatars';
import skillsData from '../../data/skills.json';
import { getEffectiveChar } from '../../systems/combatEngine';
import { ARENA_DAMAGE_MULTIPLIER, getArenaCastableSkills } from '../../systems/arenaSystem';
import { mitigateDamage } from '../../systems/combat';
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
} from '../../systems/skillEffectsV2';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { isBackendCombatDelegated, isBackendMode } from '../../config/backendMode';
import { commitCombatEventNow } from '../../stores/characterScope';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import './Arena.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

interface IMatchContext {
    arenaId: string;
    myCompetitorId: string;
    opponentId: string;
    attackerIsHigher: boolean;
    opponentName: string;
    opponentClass: string;
    opponentLevel: number;
}

interface IClassSkill {
    id: string;
    unlockLevel: number;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect?: string;
}

const getClassActiveSkills = (cls: string): IClassSkill[] => {
    const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
    return (skillsData.activeSkills[key] ?? []) as IClassSkill[];
};

interface ICombatant {
    id: string;
    name: string;
    class: string;
    level: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    attack: number;
    defense: number;
    skillSlots: Array<string | null>;
    cooldowns: Record<string, number>;
    status: IStatusState;
}

const padTo4 = <T,>(arr: T[]): Array<T | null> => {
    const out: Array<T | null> = [...arr];
    while (out.length < 4) out.push(null);
    return out;
};

interface IArenaMatchResult {
    attackerWon: boolean;
    attackerAp: number;
    attackerLp: number;
}

const parseArenaMatchResult = (raw: unknown): IArenaMatchResult | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const won = obj.attackerWon;
    if (typeof won !== 'boolean') return null;
    const reward = obj.reward;
    if (typeof reward !== 'object' || reward === null) return null;
    const attacker = (reward as Record<string, unknown>).attacker;
    if (typeof attacker !== 'object' || attacker === null) return null;
    const a = attacker as Record<string, unknown>;
    return {
        attackerWon: won,
        attackerAp: typeof a.arenaPoints === 'number' ? a.arenaPoints : 0,
        attackerLp: typeof a.leaguePoints === 'number' ? a.leaguePoints : 0,
    };
};

const ArenaMatch = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);
    const { currentArena, finalizeMatch } = useArenaStore(useShallow((s) => ({ currentArena: s.currentArena, finalizeMatch: s.finalizeMatch })));
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
    const transformColor = useMemo(
        () => getHighestTransformColor(),
        [completedTransforms, getHighestTransformColor],
    );

    const ctx = useMemo<IMatchContext | null>(() => {
        try {
            const raw = sessionStorage.getItem('arena.match');
            if (!raw) return null;
            return JSON.parse(raw) as IMatchContext;
        } catch { return null; }
    }, []);

    const [phase, setPhase] = useState<'fighting' | 'win' | 'lose'>('fighting');
    const [speedMult, setSpeedMult] = useState(1);
    const [tickKey, setTickKey] = useState(0);

    const arenaEventSentRef = useRef(false);
    useEffect(() => {
        if (phase !== 'win' && phase !== 'lose') {
            arenaEventSentRef.current = false;
            return;
        }
        if (!isBackendMode() || arenaEventSentRef.current) return;
        arenaEventSentRef.current = true;
        commitCombatEventNow({ type: 'arena', outcome: phase === 'win' ? 'won' : 'lost' });
    }, [phase]);
    const [rewardSummary, setRewardSummary] = useState<{ ap: number; lp: number } | null>(null);
    const [entryFading, setEntryFading] = useState(true);
    useEffect(() => {
        const t = window.setTimeout(() => setEntryFading(false), 1500);
        return () => window.clearTimeout(t);
    }, []);

    const playerRef = useRef<ICombatant | null>(null);
    const opponentRef = useRef<ICombatant | null>(null);
    const tickIdRef = useRef(0);
    const finalizedRef = useRef(false);

    const [playerFloats, setPlayerFloats] = useState<Array<{ key: number; dmg: number; kind: 'monster' | 'spell' | 'basic' }>>([]);
    const [opponentFloats, setOpponentFloats] = useState<Array<{ key: number; dmg: number; kind: 'basic' | 'spell' | 'monster' }>>([]);
    const floatKeyRef = useRef(0);
    const [opponentHitPulse, setOpponentHitPulse] = useState(0);
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    const fx = useCombatFx();
    const [opponentAttackingClass, setOpponentAttackingClass] = useState<string | null>(null);
    const [playerAttackingClass, setPlayerAttackingClass] = useState<string | null>(null);
    const ATTACK_FLASH_MS = 350;

    useEffect(() => {
        if (!ctx || !character || !currentArena) return;
        const opponent = currentArena.competitors.find((c) => c.id === ctx.opponentId);
        if (!opponent) return;
        const eff = getEffectiveChar(character);
        playerRef.current = {
            id: ctx.myCompetitorId,
            name: character.name,
            class: character.class,
            level: character.level,
            hp: eff?.max_hp ?? character.max_hp,
            maxHp: eff?.max_hp ?? character.max_hp,
            mp: eff?.max_mp ?? character.max_mp,
            maxMp: eff?.max_mp ?? character.max_mp,
            attack: eff?.attack ?? character.attack,
            defense: eff?.defense ?? character.defense,
            skillSlots: [...activeSkillSlots] as Array<string | null>,
            cooldowns: {},
            status: newStatusState(),
        };
        opponentRef.current = {
            id: opponent.id,
            name: opponent.name,
            class: opponent.class,
            level: opponent.level,
            hp: opponent.defense.maxHp,
            maxHp: opponent.defense.maxHp,
            mp: opponent.defense.maxMp,
            maxMp: opponent.defense.maxMp,
            attack: opponent.defense.attack,
            defense: opponent.defense.defense,
            skillSlots: opponent.defense.skillSlots,
            cooldowns: {},
            status: newStatusState(),
        };
        setTickKey((k) => k + 1);
    }, []);

    const resolveArenaViaBackend = useCallback(async (clientAttackerWon: boolean): Promise<void> => {
        const finalizeOnClient = (): void => {
            if (!ctx) return;
            const r = finalizeMatch({
                myCompetitorId: ctx.myCompetitorId,
                opponentId: ctx.opponentId,
                attackerWon: clientAttackerWon,
                attackerIsHigher: ctx.attackerIsHigher,
                opponentName: ctx.opponentName,
                opponentClass: ctx.opponentClass as never,
                opponentLevel: ctx.opponentLevel,
            });
            setRewardSummary({ ap: r.attackerAp, lp: r.attackerLp });
            setPhase(clientAttackerWon ? 'win' : 'lose');
        };
        const char = useCharacterStore.getState().character;
        if (!char || !ctx) {
            finalizeOnClient();
            return;
        }
        try {
            const res = await backendApi.arenaMatch(char.id, ctx.opponentId);
            await syncFromBackend(char.id);
            const parsed = parseArenaMatchResult(res);
            if (parsed) {
                setRewardSummary({ ap: parsed.attackerAp, lp: parsed.attackerLp });
                setPhase(parsed.attackerWon ? 'win' : 'lose');
            } else {
                setPhase(clientAttackerWon ? 'win' : 'lose');
            }
        } catch (e) {
            console.warn('[arena] backend arenaMatch nie powiódł się — fallback do klienta', e);
            finalizeOnClient();
        }
    }, [ctx, finalizeMatch]);

    useEffect(() => {
        if (phase !== 'fighting') return;
        const TICK_MS = 500;
        const id = setInterval(() => {
            tickIdRef.current += 1;
            const tick = tickIdRef.current;
            const me = playerRef.current;
            const op = opponentRef.current;
            if (!me || !op) return;
            if (me.hp <= 0 || op.hp <= 0) return;

            const meDot = tickStatus(me.status, TICK_MS / speedMult, me.maxHp);
            const opDot = tickStatus(op.status, TICK_MS / speedMult, op.maxHp);
            if (meDot.dotDamage > 0) {
                const apply = applyIncomingDamage(me.status, me.hp, meDot.dotDamage);
                me.hp = Math.max(0, me.hp + apply.hpDelta);
                if (apply.hpDelta < 0) {
                    const k = ++floatKeyRef.current;
                    setPlayerFloats((arr) => [...arr.slice(-3), { key: k, dmg: -apply.hpDelta, kind: 'monster' }]);
                }
            }
            if (opDot.dotDamage > 0) {
                const apply = applyIncomingDamage(op.status, op.hp, opDot.dotDamage);
                op.hp = Math.max(0, op.hp + apply.hpDelta);
                if (apply.hpDelta < 0) {
                    const k = ++floatKeyRef.current;
                    setOpponentFloats((arr) => [...arr.slice(-3), { key: k, dmg: -apply.hpDelta, kind: 'spell' }]);
                }
            }
            if (me.hp <= 0 && me.status.cannotDieMs > 0) me.hp = 1;
            if (op.hp <= 0 && op.status.cannotDieMs > 0) op.hp = 1;

            const dealDamage = (target: ICombatant, raw: number): number => {
                if (raw <= 0) return 0;
                const apply = applyIncomingDamage(target.status, target.hp, raw);
                target.hp = Math.max(0, target.hp + apply.hpDelta);
                return apply.absorbed ? 0 : -apply.hpDelta;
            };

            const tryCast = (caster: ICombatant, target: ICombatant): { dealt: number; aoe: boolean; skillId: string | null } => {
                if (isStunned(caster.status)) return { dealt: 0, aoe: false, skillId: null };
                const skills = getArenaCastableSkills(caster.class, caster.skillSlots, caster.level);
                const cd = caster.cooldowns;
                const chosen = skills
                    .filter((s) => caster.mp >= s.mpCost && (cd[s.id] ?? 0) <= tick)
                    .sort((a, b) => (cd[a.id] ?? 0) - (cd[b.id] ?? 0))[0];
                if (!chosen) return { dealt: 0, aoe: false, skillId: null };
                caster.mp = Math.max(0, caster.mp - chosen.mpCost);
                caster.cooldowns = {
                    ...cd,
                    [chosen.id]: tick + Math.ceil(chosen.cooldown / 500),
                };
                const parsed = parseEffects(chosen.effect);
                const targetHpPct = (target.hp / Math.max(1, target.maxHp)) * 100;
                const apply = applyEffects(
                    parsed,
                    caster.status,
                    target.status,
                    targetHpPct,
                    [caster.status],
                    [target.status],
                );
                let dealt = 0;
                if (chosen.damage > 0) {
                    if (apply.instantKill) {
                        dealt = target.hp;
                    } else {
                        const effDef = target.defense * (1 - apply.defPenPct / 100);
                        const baseDmg = caster.attack * chosen.damage;
                        let finalDmg = mitigateDamage(
                            baseDmg * ARENA_DAMAGE_MULTIPLIER * apply.castDmgMult, effDef * 0.3, caster.level, true,
                        );
                        if ((apply.executeBurstPct ?? 0) > 0) {
                            finalDmg = Math.max(finalDmg, Math.floor(target.maxHp * (apply.executeBurstPct ?? 0) / 100));
                        }
                        dealt = dealDamage(target, finalDmg);
                    }
                }
                if (apply.healCasterPctOfDmg > 0 && dealt > 0) {
                    const heal = Math.floor(dealt * (apply.healCasterPctOfDmg / 100));
                    const hr = applyIncomingHeal(caster.status, heal);
                    caster.hp = Math.min(caster.maxHp, caster.hp + hr.hpDelta);
                }
                if (apply.healCasterPctOfMaxHp > 0) {
                    const heal = Math.floor(caster.maxHp * (apply.healCasterPctOfMaxHp / 100));
                    const hr = applyIncomingHeal(caster.status, heal);
                    caster.hp = Math.min(caster.maxHp, caster.hp + hr.hpDelta);
                }
                if (apply.healPartyPctInstant > 0) {
                    const heal = Math.floor(caster.maxHp * (apply.healPartyPctInstant / 100));
                    const hr = applyIncomingHeal(caster.status, heal);
                    caster.hp = Math.min(caster.maxHp, caster.hp + hr.hpDelta);
                }
                if (apply.healLowestAllyPct > 0) {
                    const heal = Math.floor(caster.maxHp * (apply.healLowestAllyPct / 100));
                    const hr = applyIncomingHeal(caster.status, heal);
                    caster.hp = Math.min(caster.maxHp, caster.hp + hr.hpDelta);
                }
                return { dealt, aoe: apply.aoe, skillId: chosen.id };
            };

            const ARENA_CLASS_DUAL_WIELD: Record<string, boolean> = {
                Knight: true, Rogue: true,
            };
            const oneStrike = (caster: ICombatant, target: ICombatant, pct: number): number => {
                const baseDmg = Math.floor(caster.attack * pct);
                const hit = resolveBasicHit(caster.status, caster.class, baseDmg, target.status);
                if (hit.dodged) return 0;
                const effDef = target.defense * (1 - caster.status.defPenPct / 100);
                let finalDmg = mitigateDamage(hit.damage * ARENA_DAMAGE_MULTIPLIER, effDef * 0.5, caster.level, true);
                if (hit.instantKill) {
                    target.hp = 0;
                    return target.maxHp;
                }
                if ((hit.executeBurstPct ?? 0) > 0) {
                    finalDmg = Math.max(finalDmg, Math.floor(target.maxHp * (hit.executeBurstPct ?? 0) / 100));
                }
                const dealt = dealDamage(target, finalDmg);
                if (hit.casterHeal > 0) {
                    const hr = applyIncomingHeal(caster.status, hit.casterHeal);
                    caster.hp = Math.min(caster.maxHp, caster.hp + hr.hpDelta);
                }
                return dealt;
            };
            const tryBasic = (caster: ICombatant, target: ICombatant): number[] => {
                if (tick % 2 !== 0) return [];
                if (isStunned(caster.status)) return [];
                const dual = !!ARENA_CLASS_DUAL_WIELD[caster.class];
                if (dual) {
                    return [oneStrike(caster, target, 0.6), oneStrike(caster, target, 0.6)];
                }
                const dmg = oneStrike(caster, target, 1.0);
                return dmg > 0 ? [dmg] : [];
            };

            const myBasicHits = tryBasic(me, op);
            const myBasic = myBasicHits.reduce((s, d) => s + d, 0);
            const mySkillRes = tryCast(me, op);
            const mySkill = mySkillRes.dealt;
            const opBasicHits = tryBasic(op, me);
            const opBasic = opBasicHits.reduce((s, d) => s + d, 0);
            const opSkillRes = tryCast(op, me);
            const opSkill = opSkillRes.dealt;

            for (const hitDmg of myBasicHits) {
                if (hitDmg <= 0) continue;
                const k = ++floatKeyRef.current;
                setOpponentFloats((arr) => [...arr.slice(-3), { key: k, dmg: hitDmg, kind: 'basic' }]);
            }
            if (mySkill > 0) {
                const k = ++floatKeyRef.current;
                setOpponentFloats((arr) => [...arr.slice(-3), { key: k, dmg: mySkill, kind: 'spell' }]);
            }
            for (const hitDmg of opBasicHits) {
                if (hitDmg <= 0) continue;
                const k = ++floatKeyRef.current;
                setPlayerFloats((arr) => [...arr.slice(-3), { key: k, dmg: hitDmg, kind: 'monster' }]);
            }
            if (opSkill > 0) {
                const k = ++floatKeyRef.current;
                setPlayerFloats((arr) => [...arr.slice(-3), { key: k, dmg: opSkill, kind: 'monster' }]);
            }

            if (myBasic > 0) {
                setOpponentHitPulse((p) => p + 1);
                setOpponentAttackingClass(`attack-${me.class}`);
                window.setTimeout(() => setOpponentAttackingClass(null), ATTACK_FLASH_MS);
            }
            if (mySkillRes.skillId) {
                fx.pushEnemyFloat(0, mySkill, 'spell', { icon: getSkillIcon(mySkillRes.skillId) });
            }
            if (opBasic > 0) {
                setPlayerHitPulse((p) => p + 1);
                setPlayerAttackingClass(`attack-${op.class}`);
                window.setTimeout(() => setPlayerAttackingClass(null), ATTACK_FLASH_MS);
            }
            if (opSkillRes.skillId) {
                fx.triggerAllySkillAnim(0, opSkillRes.skillId);
                fx.pushAllyFloat(0, opSkill, 'monster-spell', { icon: getSkillIcon(opSkillRes.skillId) });
            }

            setTickKey((kk) => kk + 1);

            if (op.hp <= 0) {
                if (!finalizedRef.current && ctx) {
                    finalizedRef.current = true;
                    if (isBackendCombatDelegated()) {
                        void resolveArenaViaBackend(true);
                        return;
                    }
                    const r = finalizeMatch({
                        myCompetitorId: ctx.myCompetitorId,
                        opponentId: ctx.opponentId,
                        attackerWon: true,
                        attackerIsHigher: ctx.attackerIsHigher,
                        opponentName: ctx.opponentName,
                        opponentClass: ctx.opponentClass as never,
                        opponentLevel: ctx.opponentLevel,
                    });
                    setRewardSummary({ ap: r.attackerAp, lp: r.attackerLp });
                }
                setPhase('win');
            } else if (me.hp <= 0) {
                if (!finalizedRef.current && ctx) {
                    finalizedRef.current = true;
                    if (isBackendCombatDelegated()) {
                        void resolveArenaViaBackend(false);
                        return;
                    }
                    const r = finalizeMatch({
                        myCompetitorId: ctx.myCompetitorId,
                        opponentId: ctx.opponentId,
                        attackerWon: false,
                        attackerIsHigher: ctx.attackerIsHigher,
                        opponentName: ctx.opponentName,
                        opponentClass: ctx.opponentClass as never,
                        opponentLevel: ctx.opponentLevel,
                    });
                    setRewardSummary({ ap: r.attackerAp, lp: r.attackerLp });
                }
                setPhase('lose');
            }
        }, Math.max(125, TICK_MS / speedMult));
        return () => clearInterval(id);
    }, [phase, speedMult, ctx, finalizeMatch, resolveArenaViaBackend]);

    if (!ctx || !character || !currentArena) {
        return (
            <div className="arena">
                <p>Brak kontekstu walki — wracam do areny.</p>
                <button onClick={() => navigate('/arena')}>Wróć</button>
            </div>
        );
    }

    const me = playerRef.current;
    const op = opponentRef.current;
    const opponentCompetitor = currentArena?.competitors.find((c) => c.id === ctx?.opponentId);
    const opponentTransforms = opponentCompetitor?.completedTransforms ?? [];

    const playerColor = transformColor?.solid
        ?? transformColor?.gradient?.[0]
        ?? CLASS_COLORS[character.class]
        ?? '#e94560';

    const FX_KEY_OFFSET = 1_000_000;
    const opponentMergedFloats = [
        ...opponentFloats.map((f) => ({ id: f.key, kind: f.kind, value: f.dmg })),
        ...(fx.enemyFloats[0] ?? []).map((f) => ({ ...f, id: f.id + FX_KEY_OFFSET })),
    ];
    const playerMergedFloats = [
        ...playerFloats.map((f) => ({ id: f.key, kind: f.kind, value: f.dmg })),
        ...(fx.allyFloats[0] ?? []).map((f) => ({ ...f, id: f.id + FX_KEY_OFFSET })),
    ];
    const uiEnemies: Array<ICombatEnemy | null> = padTo4(
        op ? [{
            id: op.id,
            name: op.name,
            level: op.level,
            sprite: 'bust-in-silhouette',
            kind: 'monster' as const,
            currentHp: Math.max(0, op.hp),
            maxHp: op.maxHp,
            rarity: 'normal',
            isDead: op.hp <= 0,
            isTargetedByPlayer: true,
            hitPulse: opponentHitPulse,
            attackingClassName: opponentAttackingClass,
            floats: opponentMergedFloats as never,
            imageUrl: getCharacterAvatar(op.class as never, opponentTransforms),
            imageObjectFit: 'cover' as const,
        }] : [],
    );

    const uiAllies: Array<ICombatAlly | null> = padTo4(
        me ? [{
            id: me.id,
            name: me.name,
            avatarUrl: getCharacterAvatar(character.class, useTransformStore.getState().completedTransforms),
            accentColor: playerColor,
            className: character.class,
            currentHp: Math.max(0, me.hp),
            maxHp: me.maxHp,
            currentMp: Math.max(0, me.mp),
            maxMp: me.maxMp,
            isDead: me.hp <= 0,
            isPlayer: true,
            level: me.level,
            aggroCount: 0,
            hitPulse: playerHitPulse,
            attackingClassName: playerAttackingClass,
            skillAnim: fx.allySkill[0] ?? null,
            floats: playerMergedFloats as never,
        }] : [],
    );

    const cycleSpeed = () => {
        const opts = [1, 2, 4];
        const idx = opts.indexOf(speedMult);
        setSpeedMult(opts[(idx + 1) % opts.length]);
    };

    const TICK_MS_FOR_BAR = 500;
    const playerSkills = me ? getClassActiveSkills(me.class) : [];
    const uiSkills: Array<ICombatSkillSlot | null> = activeSkillSlots.slice(0, 4).map((slotId) => {
        if (!slotId) return null;
        const def = playerSkills.find((s) => s.id === slotId);
        if (!def) return null;
        const cdExpiryTick = me?.cooldowns[slotId] ?? 0;
        const ticksLeft = Math.max(0, cdExpiryTick - tickIdRef.current);
        const cdMs = ticksLeft * TICK_MS_FOR_BAR;
        const totalMs = def.cooldown;
        return {
            id: slotId,
            icon: getSkillIcon(slotId),
            name: slotId,
            mpCost: def.mpCost,
            cooldownProgress: cdMs > 0 ? 1 - cdMs / totalMs : 1,
            cooldownRemainingMs: cdMs,
            disabled: true,
            onClick: () => {},
        } as ICombatSkillSlot;
    });
    while (uiSkills.length < 4) uiSkills.push(null);


    return (
        <div className="arena arena--match">
            <CombatHudHost active={phase === 'fighting'} accent={playerColor} compact>
                <div className="combat-ui">
                    <CombatTopControls
                        speed={{ label: `X${speedMult}`, onCycle: cycleSpeed }}
                        autoSkill={null}
                        autoPotion={null}
                    />

                    <CombatArena
                        enemies={uiEnemies}
                        allies={uiAllies}
                        bgVariant="default"
                        overlay={null}
                    />

                    <CombatSubControls xp={null} />


                    <CombatActionBar
                        skills={uiSkills}
                        exit={{
                            kind: 'flee',
                            onFlee: () => {
                                if (!finalizedRef.current) {
                                    finalizedRef.current = true;
                                    finalizeMatch({
                                        myCompetitorId: ctx.myCompetitorId,
                                        opponentId: ctx.opponentId,
                                        attackerWon: false,
                                        attackerIsHigher: ctx.attackerIsHigher,
                                        opponentName: ctx.opponentName,
                                        opponentClass: ctx.opponentClass as never,
                                        opponentLevel: ctx.opponentLevel,
                                    });
                                }
                                navigate('/arena');
                            },
                        }}
                    />
                </div>
            </CombatHudHost>

            <AnimatePresence>
                {(phase === 'win' || phase === 'lose') && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0,0,0,0.85)',
                            zIndex: 2000,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 16,
                        }}
                        key={`result-${tickKey}`}
                    >
                        <motion.div
                            initial={{ scale: 0.8, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            style={{
                                background: 'rgba(15, 17, 28, 0.55)',
                                backdropFilter: 'blur(8px)',
                                WebkitBackdropFilter: 'blur(8px)',
                                border: `2px solid ${playerColor}`,
                                borderRadius: 16,
                                padding: 40,
                                textAlign: 'center',
                                color: '#fff',
                                minWidth: 320,
                                boxShadow: `0 0 50px ${playerColor}99`,
                            }}
                        >
                            <h1 style={{ fontSize: 48, margin: 0 }}>
                                {phase === 'win' ? <><GameIcon name="trophy" /> ZWYCIĘSTWO</> : <><GameIcon name="skull" /> PORAŻKA</>}
                            </h1>
                            <p style={{ fontSize: 18, margin: '16px 0' }}>
                                vs {ctx.opponentName} (L{ctx.opponentLevel})
                            </p>
                            {rewardSummary && (
                                <div style={{ fontSize: 20, fontWeight: 700, color: '#ffd54f' }}>
                                    {phase === 'win'
                                        ? `+${rewardSummary.ap} AP · +${rewardSummary.lp} LP`
                                        : 'Brak nagród (przeciwnik dostaje punkty)'}
                                </div>
                            )}
                            <button
                                onClick={() => navigate('/arena')}
                                style={{
                                    marginTop: 24,
                                    padding: '12px 32px',
                                    background: 'rgba(255,255,255,0.2)',
                                    border: '2px solid rgba(255,255,255,0.4)',
                                    color: '#fff',
                                    borderRadius: 8,
                                    fontWeight: 700,
                                    fontSize: 16,
                                    cursor: 'pointer',
                                }}
                            >
                                Powrót do areny
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {entryFading && (
                <div
                    className="arena__entry-overlay arena__entry-overlay--in"
                    onClick={() => setEntryFading(false)}
                />
            )}
        </div>
    );
};

export default ArenaMatch;
