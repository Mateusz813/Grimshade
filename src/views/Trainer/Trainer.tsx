import { useCallback, useEffect, useRef, useState } from 'react';
import { rollWeaponDamage } from '../../systems/combatViewHelpers';
import { useNavigate } from 'react-router-dom';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
import { useCharacterStore } from '../../stores/characterStore';
import { useTransformStore } from '../../stores/transformStore';
import { useCombatStore } from '../../stores/combatStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import type { IPartyMember } from '../../systems/partySystem';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { useBuffStore } from '../../stores/buffStore';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { getSummonImage } from '../../systems/spriteAssets';
import Spinner from '../../components/ui/Spinner/Spinner';
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { getSkillIcon } from '../../data/skillIcons';
import { useCombatFx } from '../../hooks/useCombatFx';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import { newCombatEffectsSession, ensureStatus, isCombatantStunned, castSkill as effectsCastSkill, type ICombatEffectsSession } from '../../systems/combatEffectsHelpers';
import { consumeCasterBasicHitMods, consumeTargetMarkAmp, skillTargetsEnemy, tickStatus } from '../../systems/skillEffectsV2';
import { syncCasterChargeConsume, getEffectiveChar } from '../../systems/combatEngine';
import skillsData from '../../data/skills.json';

const TRAINER_PLAYER_FX_ID = 'player';
const TRAINER_DUMMY_FX_ID = (slot: number) => `trainer_dummy_${slot}`;
const TRAINER_DUMMY_CLASS = 'Archer' as const;
import trainerImg from '../../assets/images/trainer/trainer.png';
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
import classesData from '../../data/classes.json';
import './Trainer.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const SPEED_OPTIONS = [1, 2, 4];
const EMPTY_PARTY_MEMBERS: ReadonlyArray<IPartyMember> = [];
const BEST_WINDOW_BASE_MS = 5000;
const ATTACK_FLASH_MS = 350;

interface IActiveSkill {
    id: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
}

const getClassActiveSkills = (cls: string): IActiveSkill[] => {
    const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
    const list = (skillsData.activeSkills[key] ?? []) as IActiveSkill[];
    return list;
};

const Trainer = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const [speedMult, setSpeedMult] = useState(1);
    const autoPotion = true;
    const [autoSkill, setAutoSkill] = useState(true);
    const [autoBasic, setAutoBasic] = useState(true);
    const [trainerAttacks, setTrainerAttacks] = useState(false);
    const [noCooldowns, setNoCooldowns] = useState(false);
    const [trainerCount, setTrainerCount] = useState(1);
    const [totalDmg, setTotalDmg] = useState(0);
    const [bestWindow, setBestWindow] = useState(0);
    const [curWindow, setCurWindow] = useState(0);
    const [, setStatusBeat] = useState(0);
    const [deadAllies, setDeadAllies] = useState<Set<string>>(new Set());
    const [killAllyPickerOpen, setKillAllyPickerOpen] = useState(false);
    const [aggroTargetId, setAggroTargetId] = useState<string>('player');
    const [aggroPickerOpen, setAggroPickerOpen] = useState(false);
    const sandboxHpRef = useRef<number>(0);
    const sandboxMpRef = useRef<number>(0);
    const [sandboxHp, setSandboxHp] = useState(0);
    const [sandboxMp, setSandboxMp] = useState(0);
    const apokalipsaSuppressUntilRef = useRef<number>(0);
    const partyHealAccumRef = useRef(0);
    const [botHpMap, setBotHpMap] = useState<Record<string, number>>({});
    const [dummyHpPct, setDummyHpPct] = useState(100);
    const tickRef = useRef(0);
    const cooldownsRef = useRef<Record<string, number>>({});
    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    const allyCooldownsRef = useRef<Record<string, Record<string, number>>>({});
    const [skillCooldownsMs, setSkillCooldownsMs] = useState<Record<string, number>>({});
    const windowEventsRef = useRef<Array<{ at: number; dmg: number }>>([]);
    const [dummyHitPulse, setDummyHitPulse] = useState(0);
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    const [dummyAttackingClass, setDummyAttackingClass] = useState<string | null>(null);
    const [playerAttackingClass, setPlayerAttackingClass] = useState<string | null>(null);
    const [allyAttackingClassMap, setAllyAttackingClassMap] = useState<Record<string, string>>({});
    const fx = useCombatFx();

    const myAttack = character?.attack ?? 10;
    const myColor = character ? CLASS_COLORS[character.class] ?? '#888' : '#888';

    useEffect(() => {
        if (!character) return;
        const eff = getEffectiveChar(character);
        const effMaxHp = eff?.max_hp ?? character.max_hp;
        const effMaxMp = eff?.max_mp ?? character.max_mp;
        sandboxHpRef.current = effMaxHp;
        sandboxMpRef.current = effMaxMp;
        setSandboxHp(effMaxHp);
        setSandboxMp(effMaxMp);
    }, [character?.max_hp, character?.max_mp]);

    useEffect(() => {
        const live = useCharacterStore.getState().character;
        if (!live) return;
        if (sandboxHp === 0 && sandboxMp === 0) return;
        const liveEff = getEffectiveChar(live);
        const effMaxHp = liveEff?.max_hp ?? live.max_hp;
        const effMaxMp = liveEff?.max_mp ?? live.max_mp;
        const clampedHp = Math.max(0, Math.min(effMaxHp, sandboxHp));
        const clampedMp = Math.max(0, Math.min(effMaxMp, sandboxMp));
        useCharacterStore.getState().updateCharacter({ hp: clampedHp, mp: clampedMp });
    }, [sandboxHp, sandboxMp]);

    useEffect(() => {
        const ch0 = useCharacterStore.getState().character;
        if (!ch0) return;
        const snapshotHp = ch0.hp;
        const snapshotMp = ch0.mp;
        const ch0Eff = getEffectiveChar(ch0);
        const ch0EffMaxHp = ch0Eff?.max_hp ?? ch0.max_hp;
        const ch0EffMaxMp = ch0Eff?.max_mp ?? ch0.max_mp;
        useCharacterStore.getState().updateCharacter({
            hp: ch0EffMaxHp,
            mp: ch0EffMaxMp,
        });
        useNecroSummonStore.getState().clear(TRAINER_PLAYER_FX_ID);
        if (ch0.id) useNecroSummonStore.getState().clear(ch0.id);
        apokalipsaSuppressUntilRef.current = 0;
        return () => {
            const live = useCharacterStore.getState().character;
            if (!live) return;
            const currentHp = live.hp;
            const currentMp = live.mp;
            const liveEffOut = getEffectiveChar(live);
            const effMaxHpOut = liveEffOut?.max_hp ?? live.max_hp;
            const effMaxMpOut = liveEffOut?.max_mp ?? live.max_mp;
            let finalHp: number;
            let finalMp: number;
            if (currentHp === 0) {
                finalHp = snapshotHp > 0 ? Math.min(effMaxHpOut, snapshotHp) : effMaxHpOut;
            } else {
                finalHp = Math.max(1, Math.min(effMaxHpOut, currentHp));
            }
            if (currentMp === 0 && snapshotMp > 0) {
                finalMp = Math.min(effMaxMpOut, snapshotMp);
            } else {
                finalMp = Math.max(0, Math.min(effMaxMpOut, currentMp));
            }
            useCharacterStore.getState().updateCharacter({
                hp: finalHp,
                mp: finalMp,
            });
            useNecroSummonStore.getState().clear(TRAINER_PLAYER_FX_ID);
            if (live.id) useNecroSummonStore.getState().clear(live.id);
        };
    }, []);
    const partyMembers = usePartyStore((s) => s.party?.members ?? EMPTY_PARTY_MEMBERS);

    const partyForRole = usePartyStore((s) => s.party);
    const partyLeaderId = partyForRole?.leaderId ?? null;
    const isMultiHumanParty = !!partyForRole && partyForRole.members.some(
        (m) => m.id !== character?.id && !m.isBot,
    );
    const iAmLeader = isMultiHumanParty && partyLeaderId === character?.id;
    const isNonLeaderMember = isMultiHumanParty && partyLeaderId !== character?.id;

    const lastPushedDpsRef = useRef(0);
    useEffect(() => {
        if (!character) return;
        if (noCooldowns) return;
        if (bestWindow <= 0) return;
        if (bestWindow <= lastPushedDpsRef.current) return;
        const localBest = bestWindow;
        const inParty = !!partyForRole;
        const composition = inParty && partyForRole
            ? JSON.stringify(partyForRole.members.map((m) => ({
                name: m.name,
                class: m.class,
            })))
            : null;
        const t = window.setTimeout(() => {
            lastPushedDpsRef.current = localBest;
            if (isBackendMode()) {
                void backendApi.dpsRecord(character.id, {
                    dps: localBest,
                    inParty,
                    composition,
                }).then(() => syncFromBackend(character.id)).catch(() => { });
                return;
            }
            void import('../../api/v1/characterApi').then(({ characterApi }) => {
                void characterApi.bumpStat({
                    characterId: character.id,
                    column: inParty ? 'best_dps5_party' : 'best_dps5_solo',
                    value: localBest,
                    mode: 'max',
                });
                if (inParty && composition) {
                    void characterApi.updateCharacter(character.id, {
                        best_dps5_party_composition: composition,
                    }).catch(() => { });
                }
            }).catch(() => { });
        }, 800);
        return () => window.clearTimeout(t);
    }, [bestWindow, noCooldowns, character, partyForRole]);


    const rollOffHandDamage = useCallback((): number => {
        const equipment = useInventoryStore.getState().equipment;
        const weapon = equipment.offHand;
        if (!weapon) return 0;
        const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
        const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
        if (dmgMax <= 0) return 0;
        return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
    }, []);

    const rollBasicHit = useCallback((dmgPercent: number = 1.0, useOffHand: boolean = false): number => {
        const wRoll = useOffHand ? rollOffHandDamage() : rollWeaponDamage();
        const scaled = Math.floor(wRoll * dmgPercent);
        const total = Math.floor(myAttack * dmgPercent) + scaled;
        const base = Math.max(1, total);
        const variance = Math.floor(base * 0.2);
        return Math.max(1, base - variance + Math.floor(Math.random() * (variance * 2 + 1)));
    }, [rollWeaponDamage, rollOffHandDamage, myAttack]);
    const isDualWieldRef = useRef(false);
    isDualWieldRef.current = (() => {
        const cfg = (classesData as ReadonlyArray<{ id: string; dualWield?: boolean }>)
            .find((c) => c.id === character?.class);
        if (!cfg?.dualWield) return false;
        const off = useInventoryStore.getState().equipment.offHand;
        if (!off) return false;
        const dmgMax = off.bonuses.dmg_max ?? off.bonuses.attack ?? 0;
        return dmgMax > 0;
    })();
    const transformColor = useTransformStore((s) => s.getHighestTransformColor);
    const playerAccent = (() => {
        const tc = transformColor();
        return tc?.solid ?? tc?.gradient?.[0] ?? myColor;
    })();

    const addLog = useCallback((t: string) => {
        useCombatStore.getState().addSessionLog(t, 'system');
    }, []);

    useEffect(() => {
        useCombatStore.getState().clearCombatSession();
    }, []);

    useEffect(() => {
        if (!noCooldowns) return;
        cooldownsRef.current = {};
        allyCooldownsRef.current = {};
        setSkillCooldownsMs({});
    }, [noCooldowns]);

    useEffect(() => {
        if (!iAmLeader || !character) return;
        const broadcastTarget = aggroTargetId === 'player' ? character.id : aggroTargetId;
        const leaderHpPct = character.max_hp > 0 ? Math.max(0, Math.min(100, Math.round((sandboxHp / character.max_hp) * 100))) : 100;
        const broadcastBotMap = { ...botHpMap, [character.id]: leaderHpPct };
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishTrainerState({
                speedMult: speedMult as 1 | 2 | 4,
                trainerAttacks,
                noCooldowns,
                trainerCount,
                dummyHpPct,
                aggroTargetId: broadcastTarget,
                deadAllyIds: Array.from(deadAllies),
                totalDmg,
                curWindowDmg: curWindow,
                bestWindowDmg: bestWindow,
                leaderSandboxHp: sandboxHp,
                leaderSandboxMp: sandboxMp,
                memberSandboxHpMp: {},
                botHpMap: broadcastBotMap,
            });
        }).catch(() => { });
    }, [iAmLeader, character, speedMult, trainerAttacks, noCooldowns, trainerCount, dummyHpPct, aggroTargetId, deadAllies, totalDmg, curWindow, bestWindow, sandboxHp, sandboxMp, botHpMap]);

    const lastTrainerAttackSeenRef = useRef<Record<string, unknown>>({});
    useEffect(() => {
        if (!isMultiHumanParty || !character) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            const initial = usePartyCombatSyncStore.getState().lastTrainerAttackByAttacker;
            for (const [k, v] of Object.entries(initial)) {
                lastTrainerAttackSeenRef.current[k] = v;
            }
            return usePartyCombatSyncStore.subscribe((state) => {
                const map = state.lastTrainerAttackByAttacker;
                if (!map) return;
                for (const [key, ev] of Object.entries(map)) {
                    if (ev === lastTrainerAttackSeenRef.current[key]) continue;
                    lastTrainerAttackSeenRef.current[key] = ev;
                    if (ev.attackerId === character.id) continue;
                    if (ev.attackerId === 'monster' && iAmLeader) continue;
                    if (ev.kind === 'monster' && ev.targetAllyId) {
                        const targetSlot = slotOfMemberLive(ev.targetAllyId);
                        if (targetSlot < 0) continue;
                        fx.pushAllyFloat(targetSlot, ev.damage, 'monster', {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        if (ev.targetAllyId === character.id) {
                            setPlayerHitPulse((p) => p + 1);
                            setPlayerAttackingClass(`attack-${ev.attackerClass}`);
                            window.setTimeout(() => setPlayerAttackingClass(null), ATTACK_FLASH_MS);
                        } else {
                            const targetIdCap = ev.targetAllyId;
                            setAllyAttackingClassMap((prev) => ({ ...prev, [targetIdCap]: `attack-${ev.attackerClass}` }));
                            window.setTimeout(() => {
                                setAllyAttackingClassMap((prev) => {
                                    if (!prev[targetIdCap]) return prev;
                                    const next = { ...prev };
                                    delete next[targetIdCap];
                                    return next;
                                });
                            }, ATTACK_FLASH_MS);
                        }
                        continue;
                    }
                    const isBuffCast = ev.damage === 0 && ev.label === 'BUFF';
                    if (!isBuffCast) {
                        pushDamage(ev.damage);
                        setDummyHitPulse((p) => p + 1);
                        const remappedKind: typeof ev.kind = ev.kind === 'basic'
                            ? 'ally-basic'
                            : ev.kind === 'spell'
                                ? 'ally-spell'
                                : ev.kind;
                        fx.pushEnemyFloat(ev.dummyIdx ?? 0, ev.damage, remappedKind, {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        setDummyAttackingClass(`attack-${ev.attackerClass}`);
                        window.setTimeout(() => setDummyAttackingClass(null), ATTACK_FLASH_MS);
                    }
                    if (ev.skillId) {
                        if (!isBuffCast) {
                            fx.triggerEnemySkillAnim(ev.dummyIdx ?? 0, ev.skillId);
                        }
                        const slot = slotOfMemberLive(ev.attackerId);
                        if (slot >= 0) fx.triggerAllySkillAnim(slot, ev.skillId);
                        if (isBuffCast && slot >= 0) {
                            fx.pushAllyFloat(slot, 0, 'heal', { icon: 'sparkles', label: 'BUFF' });
                        }
                        const sd = getSkillDef(ev.skillId);
                        if (sd?.effect) {
                            const PARTY_PREFIX = ['party_', 'block_next_party', 'next_ally_heal', 'enemy_'];
                            const atoms = sd.effect.split(';');
                            const partyEffect = atoms
                                .filter((atom) => {
                                    const head = atom.trim().toLowerCase().split(':')[0];
                                    return PARTY_PREFIX.some((p) => head === p || head.startsWith(p));
                                })
                                .join(';');
                            if (partyEffect) {
                                applySkillBuff(ev.skillId, { ...sd, effect: partyEffect }, speedMult);
                            }
                            const hasPartyImmortal = atoms.some((a) => a.trim().toLowerCase().startsWith('party_immortal'));
                            const hasGenericPartyBuff = atoms.some((a) => {
                                const head = a.trim().toLowerCase().split(':')[0];
                                return head === 'party_attack_up' || head === 'party_defense_up' || head === 'party_as_up' || head === 'party_crit_up' || head === 'party_def_pen' || head === 'party_lifesteal_next';
                            });
                            if (hasPartyImmortal) {
                                for (const m of orderedMembersRef.current) {
                                    const idx = slotOfMemberLive(m.id);
                                    if (idx < 0) continue;
                                    fx.triggerAllySkillAnim(idx, ev.skillId);
                                    fx.pushAllyFloat(idx, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                                }
                            } else if (hasGenericPartyBuff) {
                                for (const m of orderedMembersRef.current) {
                                    const idx = slotOfMemberLive(m.id);
                                    if (idx < 0) continue;
                                    fx.triggerAllySkillAnim(idx, ev.skillId);
                                    fx.pushAllyFloat(idx, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
                                }
                            }
                        }
                    }
                }
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isMultiHumanParty, character?.id, iAmLeader]);

    const lastTrainerStateSeenRef = useRef<number>(0);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            const apply = (s: { speedMult: number; trainerAttacks: boolean; noCooldowns: boolean; trainerCount: number; dummyHpPct: number; aggroTargetId: string; deadAllyIds: string[]; totalDmg: number; curWindowDmg: number; bestWindowDmg: number; leaderSandboxHp: number; leaderSandboxMp: number; memberSandboxHpMp: Record<string, { hp: number; mp: number }>; botHpMap: Record<string, number>; sentAt: number } | null) => {
                if (!s) return;
                if (s.sentAt <= lastTrainerStateSeenRef.current) return;
                lastTrainerStateSeenRef.current = s.sentAt;
                setSpeedMult(s.speedMult as 1 | 2 | 4);
                setTrainerAttacks(s.trainerAttacks);
                setNoCooldowns(s.noCooldowns);
                setTrainerCount(s.trainerCount);
                setDummyHpPct(s.dummyHpPct);
                setAggroTargetId(s.aggroTargetId);
                setDeadAllies(new Set(s.deadAllyIds ?? []));
                if (typeof s.totalDmg === 'number') setTotalDmg(s.totalDmg);
                if (typeof s.curWindowDmg === 'number') setCurWindow(s.curWindowDmg);
                if (typeof s.bestWindowDmg === 'number') setBestWindow(s.bestWindowDmg);
                if (s.botHpMap) setBotHpMap(s.botHpMap);
            };
            apply(usePartyCombatSyncStore.getState().lastTrainerState);
            return usePartyCombatSyncStore.subscribe((state) => apply(state.lastTrainerState));
        })();
        return () => { void unsub.then((fn) => fn?.()); };
    }, [isNonLeaderMember]);

    const presenceByMember = usePartyPresenceStore((s) => s.byMember);
    const orderedMembers = (() => {
        if (partyMembers.length === 0) {
            return character
                ? ([{ id: character.id, name: character.name, class: character.class, level: character.level, color: myColor, hp: 0, maxHp: 0, mp: 0, maxMp: 0, attack: 0, defense: 0, isLeader: true, isBot: false, isDead: false, joinedAt: 0 }] as unknown as typeof partyMembers)
                : [];
        }
        return partyMembers
            .filter((m) => {
                if (m.id === character?.id) return true;
                if (m.isBot) return true;
                const route = presenceByMember[m.id]?.currentRoute;
                if (route === undefined) return true;
                return route === '/trainer';
            })
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, 4);
    })();
    const mySlot = (() => {
        const idx = orderedMembers.findIndex((m) => m.id === character?.id);
        return idx >= 0 ? idx : 0;
    })();
    const slotOfMember = (memberId: string): number => {
        return orderedMembers.findIndex((m) => m.id === memberId);
    };
    const orderedMembersRef = useRef(orderedMembers);
    orderedMembersRef.current = orderedMembers;
    const slotOfMemberLive = (memberId: string): number => {
        return orderedMembersRef.current.findIndex((m) => m.id === memberId);
    };

    const pushDamage = useCallback((dmg: number) => {
        if (isMultiHumanParty && !iAmLeader) return;
        setTotalDmg((v) => v + dmg);
        const now = Date.now();
        windowEventsRef.current.push({ at: now, dmg });
        const windowMs = BEST_WINDOW_BASE_MS;
        windowEventsRef.current = windowEventsRef.current.filter((e) => now - e.at <= windowMs);
        const cur = windowEventsRef.current.reduce((s, e) => s + e.dmg, 0);
        setCurWindow(cur);
        setBestWindow((prev) => Math.max(prev, cur));
    }, [isMultiHumanParty, iAmLeader]);

    useEffect(() => {
        if (!character) return;
        const interval = setInterval(() => {
            tickRef.current += 1;
            const tick = tickRef.current;

            const partyHealPct = useBuffStore.getState().getPartyHealDotPctPerSec();
            if (partyHealPct > 0 && character) {
                const intervalMs = Math.max(100, 500 / speedMult);
                partyHealAccumRef.current += intervalMs * Math.max(1, speedMult);
                const pulseSkillId = useBuffStore.getState().getPartyHealDotSkillId();
                while (partyHealAccumRef.current >= 1000) {
                    partyHealAccumRef.current -= 1000;
                    const playerHeal = Math.max(1, Math.floor(character.max_hp * (partyHealPct / 100)));
                    const before = sandboxHpRef.current;
                    sandboxHpRef.current = Math.min(character.max_hp, before + playerHeal);
                    setSandboxHp(sandboxHpRef.current);
                    const playerActual = sandboxHpRef.current - before;
                    const playerCapped = playerActual < playerHeal ? ' (MAX)' : '';
                    fx.pushAllyFloat(mySlot,playerHeal, 'heal', {
                        icon: 'green-heart',
                        label: playerCapped ? `+${playerHeal}${playerCapped}` : undefined,
                    });
                    if (pulseSkillId) fx.triggerAllySkillAnim(mySlot,pulseSkillId);
                    for (let i = 0; i < otherPartyMembers.length; i++) {
                        const m = otherPartyMembers[i];
                        const cur = botHpMap[m.id] ?? 100;
                        if (deadAllies.has(m.id) || cur <= 0) continue;
                        const realMaxHp = m.maxHp || 100;
                        const realHeal = Math.max(1, Math.floor(realMaxHp * (partyHealPct / 100)));
                        const barHeal = Math.max(1, Math.floor(100 * (partyHealPct / 100)));
                        const newHp = Math.min(100, cur + barHeal);
                        if (newHp !== cur) {
                            setBotHpMap((prev) => ({ ...prev, [m.id]: newHp }));
                        }
                        const botCapped = cur >= 100 ? ' (MAX)' : '';
                        const allySlot = slotOfMember(m.id);
                        fx.pushAllyFloat(allySlot, realHeal, 'heal', {
                            icon: 'green-heart',
                            label: botCapped ? `+${realHeal}${botCapped}` : undefined,
                        });
                        if (pulseSkillId) fx.triggerAllySkillAnim(allySlot, pulseSkillId);
                    }
                }
            } else if (partyHealAccumRef.current !== 0) {
                partyHealAccumRef.current = 0;
            }

            const drainPerTick = 500;
            setSkillCooldownsMs((prev) => {
                const keys = Object.keys(prev);
                if (keys.length === 0) return prev;
                const next: Record<string, number> = {};
                let changed = false;
                for (const id of keys) {
                    const v = Math.max(0, prev[id] - drainPerTick);
                    if (v > 0) next[id] = v;
                    if (v !== prev[id]) changed = true;
                }
                return changed ? next : prev;
            });

            if (autoBasic && tick % 2 === 0 && !deadAllies.has(character.id)) {
                const charCrit = (character.crit_chance ?? 0.05);
                const dual = isDualWieldRef.current;
                const fireStrike = (hand: 'left' | 'right' | undefined, useOffHand: boolean, dmgPercent: number) => {
                    const playerStatus = ensureStatus(effectsRef.current, TRAINER_PLAYER_FX_ID);
                    const mods = consumeCasterBasicHitMods(playerStatus);
                    syncCasterChargeConsume(mods.consumed);
                    let dmg = rollBasicHit(dmgPercent, useOffHand);
                    const isCrit = mods.forceCrit ? true : Math.random() < (charCrit + mods.extraCritChance);
                    if (isCrit) dmg = Math.floor(dmg * 2);
                    if (mods.dmgMult !== 1) dmg = Math.max(1, Math.floor(dmg * mods.dmgMult));
                    if (playerStatus.defPenMs > 0 && playerStatus.defPenPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + playerStatus.defPenPct / 100)));
                    }
                    let universeIK = false;
                    if (playerStatus.nextAllyInstantKillPct.length > 0) {
                        const top = playerStatus.nextAllyInstantKillPct[0];
                        if (top.count > 0) {
                            if (Math.random() * 100 < top.pct) universeIK = true;
                            top.count -= 1;
                            if (top.count <= 0) playerStatus.nextAllyInstantKillPct.shift();
                            useBuffStore.getState().consumeBuffCharge('skill_charge_party_instant_kill_chance_next');
                        }
                    }
                    if (universeIK) {
                        fx.pushEnemyFloat(0, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                        addLog(`:skull: Pieśń Wszechświata: DEATH ATTACK!`);
                    }
                    const dummySt = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                    const ampBasic = consumeTargetMarkAmp(dummySt);
                    if (ampBasic.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampBasic.mult));
                        addLog(`:skull-and-crossbones: Klątwa Śmierci! ×${ampBasic.mult} dmg`);
                    }
                    pushDamage(dmg);
                    setDummyHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, dmg, 'basic', { isCrit, icon: hand ? 'dagger' : undefined });
                    setDummyAttackingClass(`attack-${character.class}`);
                    window.setTimeout(() => setDummyAttackingClass(null), ATTACK_FLASH_MS);
                    const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
                    addLog(isCrit ? `:high-voltage: KRYTYK! ${handPrefix}${dmg} dmg` : `:crossed-swords: ${handPrefix}${dmg} dmg`);
                    if (isMultiHumanParty) {
                        const dmgCap = dmg;
                        const isCritCap = isCrit;
                        const classCap = character.class;
                        const charIdCap = character.id;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                attackerId: charIdCap,
                                attackerClass: classCap,
                                dummyIdx: 0,
                                damage: dmgCap,
                                isCrit: isCritCap,
                                kind: 'basic',
                                icon: hand ? 'dagger' : undefined,
                            });
                        }).catch(() => { });
                    }
                    if (mods.lifestealPct > 0 && dmg > 0) {
                        const heal = Math.max(1, Math.floor(dmg * (mods.lifestealPct / 100)));
                        const before = sandboxHpRef.current;
                        sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                        setSandboxHp(sandboxHpRef.current);
                        const actual = sandboxHpRef.current - before;
                        const tag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(mySlot,heal, 'heal', {
                            icon: 'drop-of-blood',
                            label: tag ? `+${heal}${tag}` : undefined,
                        });
                        addLog(`:drop-of-blood: Lifesteal: ${handPrefix}+${heal} HP${tag}`);
                    }
                    if (mods.nextAllyHealPct > 0) {
                        const heal = Math.max(1, Math.floor(character.max_hp * (mods.nextAllyHealPct / 100)));
                        const before = sandboxHpRef.current;
                        sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                        setSandboxHp(sandboxHpRef.current);
                        const actual = sandboxHpRef.current - before;
                        const tag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(mySlot,heal, 'heal', {
                            icon: 'sparkles',
                            label: tag ? `+${heal}${tag}` : undefined,
                        });
                        addLog(`:sparkles: Sąd Boży heal: ${handPrefix}+${heal} HP${tag}`);
                    }
                    return dmg;
                };
                if (dual) {
                    fireStrike('left', false, 0.6);
                    window.setTimeout(() => fireStrike('right', true, 0.6), 150);
                } else {
                    fireStrike(undefined, false, 1.0);
                }
                if (character.class === 'Necromancer' && necroSummonsForPlayer.length > 0) {
                    const SUMMON_TYPE_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
                    const SUMMON_ICON: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                        skeleton: 'skull-and-crossbones', ghost: 'ghost', demon: 'smiling-face-with-horns', lich: 'crown',
                    };
                    const sortedSummons = [...necroSummonsForPlayer].sort(
                        (a, b) => SUMMON_TYPE_RANK[a.type] - SUMMON_TYPE_RANK[b.type],
                    );
                    sortedSummons.forEach((sm, idx) => {
                        const delay = 80 + idx * 100;
                        window.setTimeout(() => {
                            let summonDmg = Math.max(1, Math.floor(myAttack * sm.dmgMult));
                            const dummyStSum = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                            const ampSum = consumeTargetMarkAmp(dummyStSum);
                            if (ampSum.mult !== 1) {
                                summonDmg = Math.max(1, Math.floor(summonDmg * ampSum.mult));
                            }
                            pushDamage(summonDmg);
                            setDummyHitPulse((p) => p + 1);
                            fx.pushEnemyFloat(0, summonDmg, 'ally-basic', {
                                icon: SUMMON_ICON[sm.type],
                            });
                            setDummyAttackingClass('attack-Necromancer');
                            window.setTimeout(() => setDummyAttackingClass(null), ATTACK_FLASH_MS);
                        }, delay);
                    });
                }
            }

            if (autoSkill && !deadAllies.has(character.id)) {
                const slots = activeSkillSlots ?? [];
                const equippedSkills = getClassActiveSkills(character.class)
                    .filter((s) => slots.includes(s.id) && s.unlockLevel <= character.level);
                for (const ready of equippedSkills) {
                    if (!noCooldowns && (cooldownsRef.current[ready.id] ?? 0) > tick) continue;
                    if ((ready.effect ?? '').includes('death_apocalypse')) {
                        const effA = getEffectiveChar(character);
                        const effMaxA = effA?.max_hp ?? character.max_hp;
                        const hpPct = sandboxHpRef.current / Math.max(1, effMaxA);
                        if (hpPct < 0.05) continue;
                        let newHpAfter: number;
                        if (hpPct > 0.20) {
                            newHpAfter = Math.max(1, sandboxHpRef.current - Math.floor(effMaxA * 0.20));
                        } else {
                            newHpAfter = Math.max(1, Math.floor(effMaxA * 0.03));
                        }
                        const lost = sandboxHpRef.current - newHpAfter;
                        if (lost > 0) {
                            apokalipsaSuppressUntilRef.current = Number.MAX_SAFE_INTEGER;
                            sandboxHpRef.current = newHpAfter;
                            setSandboxHp(newHpAfter);
                            useCharacterStore.getState().updateCharacter({ hp: newHpAfter });
                            fx.pushAllyFloat(mySlot,lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                            addLog(`:broken-heart: Apokalipsa: -${lost} HP`);
                        }
                    }
                    if (!noCooldowns) {
                        cooldownsRef.current[ready.id] = tick + Math.ceil(ready.cooldown / 500);
                        setSkillCooldownsMs((prev) => ({ ...prev, [ready.id]: ready.cooldown }));
                    }
                    const isDamageHitAuto = ready.damage > 0;
                    const targetsEnemyAuto = isDamageHitAuto || skillTargetsEnemy(ready.effect ?? null);
                    const isAoeAuto = (ready.effect ?? '').split(';').some((a) => a.trim().toLowerCase().startsWith('aoe'));
                    const partyAllyIdsAuto = partyMembers
                        .filter((m) => m.id !== character.id)
                        .slice(0, 3)
                        .map((m) => `trainer_ally_${m.id}`);
                    const allyIdsAuto = [TRAINER_PLAYER_FX_ID, ...partyAllyIdsAuto];
                    const applyAuto = effectsCastSkill({
                        session: effectsRef.current,
                        casterId: TRAINER_PLAYER_FX_ID,
                        targetId: TRAINER_DUMMY_FX_ID(0),
                        targetHpPct: dummyHpPct,
                        effect: ready.effect ?? null,
                        allyIds: allyIdsAuto,
                        enemyIds: Array.from({ length: trainerCount }, (_, i) => TRAINER_DUMMY_FX_ID(i)),
                    });
                    const defPenAuto = applyAuto.defPenPct ?? 0;
                    let dmgAuto = isDamageHitAuto ? Math.floor(myAttack * ready.damage * (1 + defPenAuto / 100)) : 0;
                    if (isDamageHitAuto && dmgAuto > 0) {
                        const dummyStAuto = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                        const ampAutoSpell = consumeTargetMarkAmp(dummyStAuto);
                        if (ampAutoSpell.mult !== 1) {
                            dmgAuto = Math.max(1, Math.floor(dmgAuto * ampAutoSpell.mult));
                            addLog(`:skull-and-crossbones: Klątwa Śmierci! ${ready.id} ×${ampAutoSpell.mult} dmg`);
                        }
                    }
                    let totalDmgAuto = 0;
                    if (!targetsEnemyAuto) {
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'BUFF' });
                        addLog(`:sparkles: ${ready.id}: BUFF`);
                        if (isMultiHumanParty && character) {
                            const idCap = ready.id;
                            const classCap = character.class;
                            const charIdCap = character.id;
                            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                usePartyCombatSyncStore.getState().publishTrainerAttack({
                                    attackerId: charIdCap,
                                    attackerClass: classCap,
                                    dummyIdx: 0,
                                    damage: 0,
                                    kind: 'ally-spell',
                                    icon: getSkillIcon(idCap),
                                    skillId: idCap,
                                    label: 'BUFF',
                                });
                            }).catch(() => { });
                        }
                    } else {
                        fx.triggerEnemySkillAnim(0, ready.id);
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        setDummyHitPulse((p) => p + 1);
                        if (isAoeAuto && !isDamageHitAuto) {
                            for (let i = 1; i < trainerCount; i++) {
                                fx.triggerEnemySkillAnim(i, ready.id);
                            }
                        }
                        if (isDamageHitAuto) {
                            pushDamage(dmgAuto);
                            totalDmgAuto += dmgAuto;
                            fx.pushEnemyFloat(0, dmgAuto, 'spell', { icon: getSkillIcon(ready.id) });
                            if (isMultiHumanParty && character) {
                                const dmgCap = dmgAuto;
                                const idCap = ready.id;
                                const classCap = character.class;
                                const charIdCap = character.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishTrainerAttack({
                                        attackerId: charIdCap,
                                        attackerClass: classCap,
                                        dummyIdx: 0,
                                        damage: dmgCap,
                                        kind: 'spell',
                                        icon: getSkillIcon(idCap),
                                        skillId: idCap,
                                    });
                                }).catch(() => { });
                            }
                            if (isAoeAuto) {
                                const splashDmgAutoT = Math.max(1, Math.floor(dmgAuto * 0.75));
                                for (let i = 1; i < trainerCount; i++) {
                                    let splashFinalAuto = splashDmgAutoT;
                                    const splashStAutoT = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(i));
                                    const ampSplashAutoT = consumeTargetMarkAmp(splashStAutoT);
                                    if (ampSplashAutoT.mult !== 1) {
                                        splashFinalAuto = Math.max(1, Math.floor(splashFinalAuto * ampSplashAutoT.mult));
                                    }
                                    fx.triggerEnemySkillAnim(i, ready.id);
                                    fx.pushEnemyFloat(i, splashFinalAuto, 'spell', { icon: getSkillIcon(ready.id) });
                                    pushDamage(splashFinalAuto);
                                    totalDmgAuto += splashFinalAuto;
                                    if (isMultiHumanParty && character) {
                                        const dmgSplashCap = splashFinalAuto;
                                        const idxCap = i;
                                        const idCap = ready.id;
                                        const classCap = character.class;
                                        const charIdCap = character.id;
                                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                                attackerId: charIdCap,
                                                attackerClass: classCap,
                                                dummyIdx: idxCap,
                                                damage: dmgSplashCap,
                                                kind: 'spell',
                                                icon: getSkillIcon(idCap),
                                                skillId: idCap,
                                            });
                                        }).catch(() => { });
                                    }
                                }
                            }
                            const tags = [
                                isAoeAuto ? 'AOE' : '',
                                defPenAuto > 0 ? `ignoruje ${defPenAuto}% DEF` : '',
                            ].filter(Boolean).join(', ');
                            addLog(`:sparkles: ${ready.id}: ${dmgAuto} dmg${tags ? ` (${tags})` : ''}`);
                        } else {
                            addLog(`:sparkles: ${ready.id}: DEBUFF`);
                        }
                        if (applyAuto.healCasterPctOfDmg > 0 && totalDmgAuto > 0 && character) {
                            const heal = Math.floor(totalDmgAuto * (applyAuto.healCasterPctOfDmg / 100));
                            if (heal > 0) {
                                const before = sandboxHpRef.current;
                                sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                                setSandboxHp(sandboxHpRef.current);
                                fx.pushAllyFloat(mySlot,heal, 'heal', { icon: 'sparkles', label: `+${heal}` });
                                addLog(`:sparkles: ${ready.id}: +${heal} HP`);
                            }
                        }
                        if (isAoeAuto) {
                            for (const idx of applyAuto.aoeStunIdxs) {
                                if (idx < trainerCount) {
                                    fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                                }
                            }
                            for (const idx of applyAuto.aoeParalyzeIdxs) {
                                if (idx < trainerCount) {
                                    fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                                }
                            }
                        } else if (applyAuto.stunApplied) {
                            fx.pushEnemyFloat(0, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                        } else if (applyAuto.paralyzeApplied) {
                            fx.pushEnemyFloat(0, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                        }
                    }
                    if ((applyAuto.multistrike ?? 0) > 0) {
                        const extra = Math.max(0, Math.floor(applyAuto.multistrike));
                        for (let n = 0; n < extra; n++) {
                            window.setTimeout(() => {
                                const followup = rollBasicHit();
                                pushDamage(followup);
                                setDummyHitPulse((p) => p + 1);
                                fx.pushEnemyFloat(0, followup, 'basic');
                                addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`);
                            }, 120 * (n + 1));
                        }
                    }
                    const autoAllies = partyMembers
                        .filter((m) => m.id !== character.id)
                        .slice(0, 3);
                    if (applyAuto.partyImmortalMs > 0) {
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                        for (let i = 0; i < autoAllies.length; i++) {
                            const m = autoAllies[i];
                            const cur = botHpMap[m.id] ?? 100;
                            if (deadAllies.has(m.id) || cur <= 0) continue;
                            const allySlot = slotOfMember(m.id);
                            fx.triggerAllySkillAnim(allySlot, ready.id);
                            fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                        }
                    }
                    {
                        const autoBuffAtoms = (ready.effect ?? '').split(';').map((a) => a.trim().toLowerCase());
                        const hasPartyBuffAuto = autoBuffAtoms.some((a) =>
                            a.startsWith('party_attack_up') ||
                            a.startsWith('party_defense_up') ||
                            a.startsWith('party_as_up') ||
                            a.startsWith('party_crit_up') ||
                            a.startsWith('party_def_pen') ||
                            a.startsWith('party_lifesteal_next'),
                        );
                        if (hasPartyBuffAuto) {
                            fx.triggerAllySkillAnim(mySlot, ready.id);
                            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
                            for (let i = 0; i < autoAllies.length; i++) {
                                const m = autoAllies[i];
                                const cur = botHpMap[m.id] ?? 100;
                                if (deadAllies.has(m.id) || cur <= 0) continue;
                                const allySlot = slotOfMember(m.id);
                                fx.triggerAllySkillAnim(allySlot, ready.id);
                                fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
                            }
                        }
                        const hasEnemyDebuffAuto = autoBuffAtoms.some((a) => a.startsWith('enemy_atk_down') || a.startsWith('enemy_no_heal'));
                        if (hasEnemyDebuffAuto) {
                            for (let dIdx = 0; dIdx < trainerCount; dIdx++) {
                                fx.pushEnemyFloat(dIdx, 0, 'spell', { icon: 'sleeping-face', label: 'DEBUFF' });
                            }
                        }
                    }
                    if (applyAuto.reviveDeadAllies) {
                        const reviveIds = new Set<string>();
                        const reviveNames: string[] = [];
                        for (const m of autoAllies) {
                            const inSet = deadAllies.has(m.id);
                            const hpZero = (botHpMap[m.id] ?? 100) <= 0;
                            if (inSet || hpZero) {
                                reviveIds.add(m.id);
                                reviveNames.push(m.name);
                            }
                        }
                        if (reviveNames.length > 0) {
                            setDeadAllies((prev) => {
                                const nx = new Set(prev);
                                for (const id of reviveIds) nx.delete(id);
                                return nx;
                            });
                            setBotHpMap((prev) => {
                                const next = { ...prev };
                                for (const id of reviveIds) next[id] = 100;
                                return next;
                            });
                            for (let i = 0; i < autoAllies.length; i++) {
                                const m = autoAllies[i];
                                if (reviveIds.has(m.id)) {
                                    const allySlot = slotOfMember(m.id);
                                    fx.pushAllyFloat(allySlot, 100, 'heal', { icon: 'sparkles', label: '+REZ' });
                                    fx.triggerAllySkillAnim(allySlot, ready.id);
                                }
                            }
                            addLog(`:sparkles: ${ready.id} -> wskrzeszono: ${reviveNames.join(', ')}`);
                        }
                    }
                    if (applyAuto.healPartyPctInstant > 0 && character) {
                        const playerHeal = Math.max(1, Math.floor(character.max_hp * (applyAuto.healPartyPctInstant / 100)));
                        const beforePlayer = sandboxHpRef.current;
                        sandboxHpRef.current = Math.min(character.max_hp, beforePlayer + playerHeal);
                        setSandboxHp(sandboxHpRef.current);
                        const playerActual = sandboxHpRef.current - beforePlayer;
                        const playerTag = playerActual < playerHeal ? ' (MAX)' : '';
                        fx.pushAllyFloat(mySlot, playerHeal, 'heal', {
                            icon: 'sparkles',
                            label: playerTag ? `+${playerHeal}${playerTag}` : undefined,
                        });
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        for (let i = 0; i < autoAllies.length; i++) {
                            const m = autoAllies[i];
                            const cur = botHpMap[m.id] ?? 100;
                            if (deadAllies.has(m.id) || cur <= 0) continue;
                            const realMaxHp = m.maxHp || 100;
                            const realHeal = Math.max(1, Math.floor(realMaxHp * (applyAuto.healPartyPctInstant / 100)));
                            const barHeal = Math.max(1, Math.floor(100 * (applyAuto.healPartyPctInstant / 100)));
                            const newHp = Math.min(100, cur + barHeal);
                            if (newHp !== cur) setBotHpMap((prev) => ({ ...prev, [m.id]: newHp }));
                            const tag = cur >= 100 ? ' (MAX)' : '';
                            const allySlot = slotOfMember(m.id);
                            fx.pushAllyFloat(allySlot, realHeal, 'heal', {
                                icon: 'sparkles',
                                label: tag ? `+${realHeal}${tag}` : undefined,
                            });
                            fx.triggerAllySkillAnim(allySlot, ready.id);
                        }
                        if (character.class === 'Necromancer') {
                            useNecroSummonStore.getState().healAllPct(character.id, applyAuto.healPartyPctInstant);
                        }
                    }
                    const sd = getSkillDef(ready.id);
                    if (sd) applySkillBuff(ready.id, sd, speedMult);
                    if (applyAuto.summons.length > 0 && character?.class === 'Necromancer') {
                        const store = useNecroSummonStore.getState();
                        for (const sm of applyAuto.summons) {
                            const spawned = store.spawn(character.id, sm.type, sm.count, myAttack, character.max_hp, character.max_mp);
                            if (spawned > 0) {
                                addLog(`:skull: Przywołano ${spawned}× ${sm.type}`);
                                fx.triggerAllySkillAnim(mySlot,ready.id);
                                fx.triggerAllySummonSpawn(mySlot,sm.type);
                                fx.pushAllyFloat(mySlot,spawned, 'heal', {
                                    icon: 'skull',
                                    label: `+${spawned}× ${sm.type.toUpperCase()}`,
                                });
                            }
                        }
                    }
                    if (applyAuto.deathApocalypse) {
                        const dummyPseudoMaxHp = Math.max(100, myAttack * 4);
                        const apocDmg = Math.max(1, Math.floor(dummyPseudoMaxHp * (applyAuto.deathApocalypseTargetMaxHpPct / 100)));
                        fx.pushEnemyFloat(0, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
                        pushDamage(apocDmg);
                        addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`);
                    }
                    break;
                }
            }

            const allies = isMultiHumanParty
                ? partyMembers.filter((m) => m.id !== character.id && m.isBot).slice(0, 3)
                : partyMembers.filter((m) => m.id !== character.id).slice(0, 3);
            const CLASS_TICK_PERIOD: Record<string, number> = {
                Knight: 4, Mage: 3, Cleric: 3, Archer: 2,
                Rogue: 2, Necromancer: 4, Bard: 3,
            };
            for (let allyIdx = 0; allyIdx < allies.length; allyIdx++) {
                const ally = allies[allyIdx];
                if (deadAllies.has(ally.id)) continue;
                if ((botHpMap[ally.id] ?? 100) <= 0) continue;
                const allyAttack = Math.max(5, Math.floor(ally.level * 4));
                const basePeriod = CLASS_TICK_PERIOD[ally.class] ?? 3;
                const allyFxIdSwingCadence = `trainer_ally_${ally.id}`;
                const allyStCadence = effectsRef.current.statuses.get(allyFxIdSwingCadence);
                const asMult = (allyStCadence && allyStCadence.asMultMs > 0 && allyStCadence.asMult > 1)
                    ? allyStCadence.asMult : 1;
                const period = Math.max(1, Math.floor(basePeriod / asMult));
                const offset = allyIdx;
                if (autoBasic && (tick + offset) % period === 0) {
                    const variance = Math.floor(allyAttack * 0.2);
                    let dmg = Math.max(1, allyAttack - variance + Math.floor(Math.random() * (variance * 2 + 1)));
                    const allyFxIdBuff = `trainer_ally_${ally.id}`;
                    const allyStBuff = effectsRef.current.statuses.get(allyFxIdBuff);
                    if (allyStBuff && allyStBuff.atkBuffMs > 0 && allyStBuff.atkBuffPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + allyStBuff.atkBuffPct / 100)));
                    }
                    if (allyStBuff && allyStBuff.defPenMs > 0 && allyStBuff.defPenPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + allyStBuff.defPenPct / 100)));
                    }
                    let isCrit = false;
                    if (allyStBuff && allyStBuff.partyCritMs > 0 && allyStBuff.partyCritPct > 0) {
                        if (Math.random() * 100 < allyStBuff.partyCritPct) {
                            isCrit = true;
                            dmg = Math.floor(dmg * 2);
                        }
                    }
                    let universeIKAlly = false;
                    if (allyStBuff && allyStBuff.nextAllyInstantKillPct.length > 0) {
                        const topIK = allyStBuff.nextAllyInstantKillPct[0];
                        if (topIK.count > 0) {
                            if (Math.random() * 100 < topIK.pct) universeIKAlly = true;
                            topIK.count -= 1;
                            if (topIK.count <= 0) allyStBuff.nextAllyInstantKillPct.shift();
                        }
                    }
                    if (universeIKAlly) {
                        fx.pushEnemyFloat(0, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                        addLog(`:skull: ${ally.name ?? 'Sojusznik'}: DEATH ATTACK!`);
                    }
                    const dummyStAlly = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                    const ampAlly = consumeTargetMarkAmp(dummyStAlly);
                    if (ampAlly.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampAlly.mult));
                    }
                    pushDamage(dmg);
                    setDummyHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, dmg, 'ally-basic', { isCrit });
                    const allyFxId = `trainer_ally_${ally.id}`;
                    const allySt = effectsRef.current.statuses.get(allyFxId);
                    if (allySt) {
                        const allyMods = consumeCasterBasicHitMods(allySt);
                        const allySlot = slotOfMember(ally.id);
                        if (allyMods.lifestealPct > 0 && dmg > 0) {
                            const heal = Math.max(1, Math.floor(dmg * (allyMods.lifestealPct / 100)));
                            const realMaxHp = ally.maxHp || 100;
                            const cur = botHpMap[ally.id] ?? 100;
                            const barHeal = Math.max(1, Math.floor(heal / realMaxHp * 100));
                            const newHp = Math.min(100, cur + barHeal);
                            if (newHp !== cur) {
                                setBotHpMap((prev) => ({ ...prev, [ally.id]: newHp }));
                            }
                            const tag = cur >= 100 ? ' (MAX)' : '';
                            fx.pushAllyFloat(allySlot, heal, 'heal', {
                                icon: 'drop-of-blood',
                                label: tag ? `+${heal}${tag}` : undefined,
                            });
                        }
                        if (allyMods.nextAllyHealPct > 0) {
                            void allyMods.nextAllyHealPct;
                        }
                    }
                }
                if (!autoSkill) continue;
                const allyCdMap = (allyCooldownsRef.current[ally.id] ??= {});
                const allySkills = getClassActiveSkills(ally.class)
                    .filter((s) => s.unlockLevel <= ally.level && s.damage > 0);
                for (const sk of allySkills) {
                    if ((allyCdMap[sk.id] ?? 0) > tick) continue;
                    allyCdMap[sk.id] = tick + Math.ceil(sk.cooldown / 500);
                    let dmg = Math.floor(allyAttack * sk.damage);
                    const allyStSp = effectsRef.current.statuses.get(`trainer_ally_${ally.id}`);
                    if (allyStSp && allyStSp.atkBuffMs > 0 && allyStSp.atkBuffPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + allyStSp.atkBuffPct / 100)));
                    }
                    let isCritSp = false;
                    if (allyStSp && allyStSp.partyCritMs > 0 && allyStSp.partyCritPct > 0) {
                        if (Math.random() * 100 < allyStSp.partyCritPct) {
                            isCritSp = true;
                            dmg = Math.floor(dmg * 2);
                        }
                    }
                    const dummyStAllySp = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                    const ampAllySp = consumeTargetMarkAmp(dummyStAllySp);
                    if (ampAllySp.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampAllySp.mult));
                    }
                    pushDamage(dmg);
                    setDummyHitPulse((p) => p + 1);
                    fx.triggerEnemySkillAnim(0, sk.id);
                    fx.pushEnemyFloat(0, dmg, 'ally-spell', { icon: getSkillIcon(sk.id), isCrit: isCritSp });
                    break;
                }
            }

            const dotPerTickMs = 500 * speedMult;
            const pseudoMaxHp = Math.max(100, myAttack * 4);
            for (let dummyIdx = 0; dummyIdx < trainerCount; dummyIdx++) {
                const dummyId = TRAINER_DUMMY_FX_ID(dummyIdx);
                const dummyStatus = effectsRef.current.statuses.get(dummyId);
                if (!dummyStatus) continue;
                const r = tickStatus(dummyStatus, dotPerTickMs, pseudoMaxHp);
                if (r.dotDamage > 0) {
                    fx.pushEnemyFloat(dummyIdx, r.dotDamage, 'spell', { icon: 'skull-and-crossbones' });
                    pushDamage(r.dotDamage);
                    if (isMultiHumanParty && character) {
                        const dmgCap = r.dotDamage;
                        const idxCap = dummyIdx;
                        const charIdCap = character.id;
                        const classCap = character.class;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                attackerId: charIdCap,
                                attackerClass: classCap,
                                dummyIdx: idxCap,
                                damage: dmgCap,
                                kind: 'spell',
                                icon: 'skull-and-crossbones',
                            });
                        }).catch(() => { });
                    }
                }
                if (r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    fx.pushEnemyFloat(dummyIdx, r.darkRitualDamage, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
                    pushDamage(r.darkRitualDamage);
                    addLog(`:skull: Mroczny Rytuał: ${r.darkRitualDamage} dmg`);
                    if (isMultiHumanParty && character) {
                        const dmgCap = r.darkRitualDamage;
                        const idxCap = dummyIdx;
                        const charIdCap = character.id;
                        const classCap = character.class;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                attackerId: charIdCap,
                                attackerClass: classCap,
                                dummyIdx: idxCap,
                                damage: dmgCap,
                                kind: 'spell',
                                icon: 'skull',
                                label: 'RITUAL',
                                isCrit: true,
                            });
                        }).catch(() => { });
                    }
                }
            }
            const playerStatusTick = effectsRef.current.statuses.get(TRAINER_PLAYER_FX_ID);
            if (playerStatusTick) tickStatus(playerStatusTick, dotPerTickMs, character?.max_hp ?? 1);
            for (const m of partyMembers) {
                if (m.id === character?.id) continue;
                const allyStatus = effectsRef.current.statuses.get(`trainer_ally_${m.id}`);
                if (allyStatus) tickStatus(allyStatus, dotPerTickMs, m.maxHp || 100);
            }
            setStatusBeat((b) => (b + 1) & 0xffff);

            if (trainerAttacks && tick % 4 === 0 && (iAmLeader || !isMultiHumanParty)) {
                const dummyStunned = isCombatantStunned(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                if (!dummyStunned) {
                    if (aggroTargetId === 'player' || aggroTargetId === character?.id) {
                        const playerSt = effectsRef.current.statuses.get(TRAINER_PLAYER_FX_ID);
                        if (playerSt && playerSt.immortalMs > 0) {
                            fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
                            addLog(`:sparkles: BLOCK! Niewrażliwość`);
                            return;
                        }
                        if (playerSt && playerSt.dodgeBuffMs > 0 && playerSt.dodgeBuffPct > 0) {
                            if (Math.random() * 100 < playerSt.dodgeBuffPct) {
                                fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                                addLog(`:dashing-away: Bomba Dymna! Unik (${playerSt.dodgeBuffPct}%)`);
                                return;
                            }
                        }
                        if (playerSt && playerSt.manaShieldMs > 0) {
                            if (sandboxMpRef.current > 0) {
                                sandboxMpRef.current = Math.max(0, sandboxMpRef.current - 1);
                                setSandboxMp(sandboxMpRef.current);
                                fx.pushAllyFloat(mySlot,1, 'spell', { icon: 'shield' });
                                addLog(`:shield: Tarcza Many pochłania 1 MP`);
                                return;
                            }
                        }
                        const dodgedByCharge = useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0;
                        if (dodgedByCharge) {
                            useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
                            addLog(`:dashing-away: Krok Cienia! Unik!`);
                            fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                        } else {
                            const blockCharges = useBuffStore.getState().getBuffCharges('skill_charge_block_next_party');
                            if (blockCharges > 0) {
                                useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
                                addLog(`:shield: Boska Tarcza! Blok!`);
                                fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'shield', label: 'BLOCK' });
                            } else {
                                if (character.class === 'Necromancer') {
                                    const necroStore = useNecroSummonStore.getState();
                                    if (necroStore.count(character.id) > 0) {
                                        const r2 = necroStore.damageFirst(character.id, 1);
                                        if (r2.dmgConsumed > 0) {
                                            fx.pushAllyFloat(mySlot,1, 'monster', { icon: 'skull' });
                                            addLog(`:skull: Summon przyjął 1 dmg (${r2.queueEmpty ? 'ostatni padł!' : 'wciąż żyje'})`);
                                            setPlayerHitPulse((p) => p + 1);
                                            return;
                                        }
                                    }
                                }
                                let dummyDmg = Math.max(1, Math.floor(character.max_hp * 0.05));
                                const dummyStAtk = effectsRef.current.statuses.get(TRAINER_DUMMY_FX_ID(0));
                                if (dummyStAtk && dummyStAtk.enemyAtkDownMs > 0 && dummyStAtk.enemyAtkDownPct > 0) {
                                    dummyDmg = Math.max(1, Math.floor(dummyDmg * (1 - dummyStAtk.enemyAtkDownPct / 100)));
                                }
                                sandboxHpRef.current = Math.max(0, sandboxHpRef.current - dummyDmg);
                                setSandboxHp(sandboxHpRef.current);
                                setPlayerHitPulse((p) => p + 1);
                                setPlayerAttackingClass(`attack-${TRAINER_DUMMY_CLASS}`);
                                window.setTimeout(() => setPlayerAttackingClass(null), ATTACK_FLASH_MS);
                                fx.pushAllyFloat(mySlot, dummyDmg, 'monster');
                                if (isMultiHumanParty && character) {
                                    const dmgCap = dummyDmg;
                                    const charIdCap = character.id;
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishTrainerAttack({
                                            attackerId: 'monster',
                                            attackerClass: TRAINER_DUMMY_CLASS,
                                            dummyIdx: 0,
                                            damage: dmgCap,
                                            kind: 'monster',
                                            targetAllyId: charIdCap,
                                        });
                                    }).catch(() => { });
                                }
                            }
                        }
                    } else {
                        if (deadAllies.has(aggroTargetId) || (botHpMap[aggroTargetId] ?? 100) <= 0) {
                            setAggroTargetId('player');
                            return;
                        }
                        const targetSlot = slotOfMember(aggroTargetId);
                        if (targetSlot >= 0) {
                            const allyFxId = `trainer_ally_${aggroTargetId}`;
                            const allySt = effectsRef.current.statuses.get(allyFxId);
                            if (allySt && allySt.immortalMs > 0) {
                                fx.pushAllyFloat(targetSlot, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
                                addLog(`:sparkles: BLOCK (party_immortal) -> slot ${targetSlot}`);
                            } else {
                                const dmg = 5;
                                const curHpBefore = botHpMap[aggroTargetId] ?? 100;
                                const killed = curHpBefore > 0 && (curHpBefore - dmg) <= 0;
                                setBotHpMap((prev) => {
                                    const cur = prev[aggroTargetId] ?? 100;
                                    const next = Math.max(0, cur - dmg);
                                    if (next === cur) return prev;
                                    return { ...prev, [aggroTargetId]: next };
                                });
                                fx.pushAllyFloat(targetSlot, dmg, 'monster');
                                const targetIdLocal = aggroTargetId;
                                setAllyAttackingClassMap((prev) => ({ ...prev, [targetIdLocal]: `attack-${TRAINER_DUMMY_CLASS}` }));
                                window.setTimeout(() => {
                                    setAllyAttackingClassMap((prev) => {
                                        if (!prev[targetIdLocal]) return prev;
                                        const next = { ...prev };
                                        delete next[targetIdLocal];
                                        return next;
                                    });
                                }, ATTACK_FLASH_MS);
                                if (isMultiHumanParty && character) {
                                    const dmgCap = dmg;
                                    const targetIdCap = aggroTargetId;
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishTrainerAttack({
                                            attackerId: 'monster',
                                            attackerClass: TRAINER_DUMMY_CLASS,
                                            dummyIdx: 0,
                                            damage: dmgCap,
                                            kind: 'monster',
                                            targetAllyId: targetIdCap,
                                        });
                                    }).catch(() => { });
                                }
                                if (killed) {
                                    setDeadAllies((prev) => {
                                        const nx = new Set(prev);
                                        nx.add(aggroTargetId);
                                        return nx;
                                    });
                                    setAggroTargetId('player');
                                    addLog(`:skull: ${aggroTargetId} padł — aggro wraca do gracza`);
                                }
                            }
                        }
                    }
                }
            }

            const now = Date.now();
            const windowMs = BEST_WINDOW_BASE_MS / speedMult;
            windowEventsRef.current = windowEventsRef.current.filter((e) => now - e.at <= windowMs);
            const cur = windowEventsRef.current.reduce((s, e) => s + e.dmg, 0);
            setCurWindow(cur);
        }, Math.max(100, 500 / speedMult));
        return () => clearInterval(interval);
    }, [character, speedMult, autoBasic, autoSkill, trainerAttacks, noCooldowns, myAttack, trainerCount, activeSkillSlots, pushDamage, addLog, fx, rollBasicHit, partyMembers, deadAllies, aggroTargetId, dummyHpPct, isMultiHumanParty, iAmLeader]);

    useEffect(() => {
        if (!autoPotion || !character) return;
        if (apokalipsaSuppressUntilRef.current > 0) return;
        const lowHp = sandboxHp < character.max_hp * 0.5;
        const lowMp = sandboxMp < character.max_mp * 0.5;
        if (lowHp || lowMp) {
            sandboxHpRef.current = character.max_hp;
            sandboxMpRef.current = character.max_mp;
            setSandboxHp(character.max_hp);
            setSandboxMp(character.max_mp);
        }
    }, [autoPotion, character, sandboxHp, sandboxMp]);

    const resetSession = () => {
        setTotalDmg(0); setBestWindow(0); setCurWindow(0);
        windowEventsRef.current = [];
        cooldownsRef.current = {};
        allyCooldownsRef.current = {};
        setSkillCooldownsMs({});
        addLog(':counterclockwise-arrows-button: Sesja zresetowana');
    };

    const doManualSkill = useCallback((slotIdx: number) => {
        if (!character) return;
        if (deadAllies.has(character.id)) return;
        const slotId = activeSkillSlots[slotIdx];
        if (!slotId) return;
        const def = getClassActiveSkills(character.class).find((s) => s.id === slotId);
        if (!def) return;
        if (def.unlockLevel > character.level) return;
        const isApocalypse = (def.effect ?? '').includes('death_apocalypse');
        if (isApocalypse) {
            const eff = getEffectiveChar(character);
            const effMax = eff?.max_hp ?? character.max_hp;
            const hpPct = sandboxHpRef.current / Math.max(1, effMax);
            if (hpPct < 0.05) {
                addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP');
                return;
            }
            let newHpAfter: number;
            if (hpPct > 0.20) {
                newHpAfter = Math.max(1, sandboxHpRef.current - Math.floor(effMax * 0.20));
            } else {
                newHpAfter = Math.max(1, Math.floor(effMax * 0.03));
            }
            const lost = sandboxHpRef.current - newHpAfter;
            if (lost > 0) {
                apokalipsaSuppressUntilRef.current = Number.MAX_SAFE_INTEGER;
                sandboxHpRef.current = newHpAfter;
                setSandboxHp(newHpAfter);
                useCharacterStore.getState().updateCharacter({ hp: newHpAfter });
                fx.pushAllyFloat(mySlot,lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                addLog(`:broken-heart: Apokalipsa: -${lost} HP`);
            }
        }
        const tick = tickRef.current;
        if (!noCooldowns && (cooldownsRef.current[def.id] ?? 0) > tick) return;
        if (!noCooldowns) {
            cooldownsRef.current[def.id] = tick + Math.ceil(def.cooldown / 500);
            setSkillCooldownsMs((prev) => ({ ...prev, [def.id]: def.cooldown }));
        }

        const isDamageHit = def.damage > 0;
        const targetsEnemy = isDamageHit || skillTargetsEnemy(def.effect ?? null);
        const isAoe = (def.effect ?? '').split(';').some((a) => a.trim().toLowerCase().startsWith('aoe'));

        const manualPartyAllyIds = partyMembers
            .filter((m) => m.id !== character.id)
            .slice(0, 3)
            .map((m) => `trainer_ally_${m.id}`);
        const apply = effectsCastSkill({
            session: effectsRef.current,
            casterId: TRAINER_PLAYER_FX_ID,
            targetId: TRAINER_DUMMY_FX_ID(0),
            targetHpPct: dummyHpPct,
            effect: def.effect ?? null,
            allyIds: [TRAINER_PLAYER_FX_ID, ...manualPartyAllyIds],
            enemyIds: Array.from({ length: trainerCount }, (_, i) => TRAINER_DUMMY_FX_ID(i)),
        });

        const defPenPct = apply.defPenPct ?? 0;
        let dmg = isDamageHit ? Math.floor(myAttack * def.damage * (1 + defPenPct / 100)) : 0;
        if (isDamageHit && (apply.executeBurstPct ?? 0) > 0) {
            const trainerPseudoMaxHp = Math.max(100, myAttack * 4);
            dmg = Math.max(dmg, Math.floor(trainerPseudoMaxHp * (apply.executeBurstPct ?? 0) / 100));
        }
        if (isDamageHit && dmg > 0) {
            const dummyStManual = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
            const ampSpell = consumeTargetMarkAmp(dummyStManual);
            if (ampSpell.mult !== 1) {
                dmg = Math.max(1, Math.floor(dmg * ampSpell.mult));
                addLog(`:skull-and-crossbones: Klątwa Śmierci! ${def.id} ×${ampSpell.mult} dmg`);
            }
        }

        if (!targetsEnemy) {
            fx.triggerAllySkillAnim(mySlot, def.id);
            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'BUFF' });
            addLog(`:sparkles: ${def.id}: BUFF`);
            if (isMultiHumanParty && character) {
                const idCap = def.id;
                const classCap = character.class;
                const charIdCap = character.id;
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishTrainerAttack({
                        attackerId: charIdCap,
                        attackerClass: classCap,
                        dummyIdx: 0,
                        damage: 0,
                        kind: 'ally-spell',
                        icon: getSkillIcon(idCap),
                        skillId: idCap,
                        label: 'BUFF',
                    });
                }).catch(() => { });
            }
        } else {
            fx.triggerEnemySkillAnim(0, def.id);
            fx.triggerAllySkillAnim(mySlot, def.id);
            setDummyHitPulse((p) => p + 1);
            if (isAoe && !isDamageHit) {
                for (let i = 1; i < trainerCount; i++) {
                    fx.triggerEnemySkillAnim(i, def.id);
                }
            }
            let totalDmgDealtThisCast = 0;
            if (isDamageHit) {
                pushDamage(dmg);
                totalDmgDealtThisCast += dmg;
                fx.pushEnemyFloat(0, dmg, 'spell', { icon: getSkillIcon(def.id) });
                if (isMultiHumanParty && character) {
                    const dmgCap = dmg;
                    const skillIdCap = def.id;
                    const classCap = character.class;
                    const charIdCap = character.id;
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishTrainerAttack({
                            attackerId: charIdCap,
                            attackerClass: classCap,
                            dummyIdx: 0,
                            damage: dmgCap,
                            kind: 'spell',
                            icon: getSkillIcon(skillIdCap),
                            skillId: skillIdCap,
                        });
                    }).catch(() => { });
                }
                if (isAoe) {
                    const splashDmgT = Math.max(1, Math.floor(dmg * 0.75));
                    const splashIkPctT = apply.instantKillPct ?? 0;
                    const trainerPseudoMaxHpSplash = Math.max(100, myAttack * 4);
                    for (let i = 1; i < trainerCount; i++) {
                        const splashIk = splashIkPctT > 0 && Math.random() * 100 < splashIkPctT;
                        fx.triggerEnemySkillAnim(i, def.id);
                        if (splashIk) {
                            const splashBurst = Math.max(splashDmgT, Math.floor(trainerPseudoMaxHpSplash * 12 / 100));
                            fx.pushEnemyFloat(i, splashBurst, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                            pushDamage(splashBurst);
                            totalDmgDealtThisCast += splashBurst;
                        } else {
                            let splashFinal = splashDmgT;
                            const dummyStSplash = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(i));
                            const ampSplash = consumeTargetMarkAmp(dummyStSplash);
                            if (ampSplash.mult !== 1) {
                                splashFinal = Math.max(1, Math.floor(splashFinal * ampSplash.mult));
                            }
                            fx.pushEnemyFloat(i, splashFinal, 'spell', { icon: getSkillIcon(def.id) });
                            pushDamage(splashFinal);
                            totalDmgDealtThisCast += splashFinal;
                            if (isMultiHumanParty && character) {
                                const dmgSplashCap = splashFinal;
                                const idxCap = i;
                                const skillIdCap = def.id;
                                const classCap = character.class;
                                const charIdCap = character.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishTrainerAttack({
                                        attackerId: charIdCap,
                                        attackerClass: classCap,
                                        dummyIdx: idxCap,
                                        damage: dmgSplashCap,
                                        kind: 'spell',
                                        icon: getSkillIcon(skillIdCap),
                                        skillId: skillIdCap,
                                    });
                                }).catch(() => { });
                            }
                        }
                    }
                }
                const tags = [
                    isAoe ? 'AOE' : '',
                    defPenPct > 0 ? `ignoruje ${defPenPct}% DEF` : '',
                ].filter(Boolean).join(', ');
                addLog(`:sparkles: ${def.id}: ${dmg} dmg${tags ? ` (${tags})` : ''}`);
            } else {
                addLog(`:sparkles: ${def.id}: DEBUFF`);
            }
            if (isAoe) {
                if (apply.aoeStunIdxs.length > 0) {
                    for (const idx of apply.aoeStunIdxs) {
                        if (idx < trainerCount) {
                            fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                        }
                    }
                }
                if (apply.aoeParalyzeIdxs.length > 0) {
                    for (const idx of apply.aoeParalyzeIdxs) {
                        if (idx < trainerCount) {
                            fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                        }
                    }
                }
            } else if (apply.stunApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
            } else if (apply.paralyzeApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'locked', label: 'PARAL' });
            }
            if (apply.instantKill) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                addLog(`:skull: ${def.id}: DEATH ATTACK!`);
            }
            if (apply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                const heal = Math.floor(totalDmgDealtThisCast * (apply.healCasterPctOfDmg / 100));
                if (heal > 0) {
                    const before = sandboxHpRef.current;
                    sandboxHpRef.current = Math.min(character?.max_hp ?? before, before + heal);
                    setSandboxHp(sandboxHpRef.current);
                    const actual = sandboxHpRef.current - before;
                    const cappedTag = actual < heal ? ' (MAX)' : '';
                    const necroTag = (character?.class === 'Necromancer' && necroSummonsForPlayer.length > 0)
                        ? ' (necro)'
                        : '';
                    fx.pushAllyFloat(mySlot,heal, 'heal', {
                        icon: 'sparkles',
                        label: `+${heal}${cappedTag}${necroTag}`,
                    });
                    addLog(`:sparkles: ${def.id}: +${heal} HP${cappedTag}${necroTag}`);
                }
            }
        }
        if (apply.healCasterPctOfMaxHp > 0 && character) {
            const heal = Math.floor(character.max_hp * (apply.healCasterPctOfMaxHp / 100));
            if (heal > 0) {
                const before = sandboxHpRef.current;
                sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                setSandboxHp(sandboxHpRef.current);
                const actual = sandboxHpRef.current - before;
                const cappedTag = actual < heal ? ' (MAX)' : '';
                const necroTag = (character.class === 'Necromancer' && necroSummonsForPlayer.length > 0)
                    ? ' (necro)'
                    : '';
                fx.pushAllyFloat(mySlot,heal, 'heal', {
                    icon: 'sparkles',
                    label: `+${heal}${cappedTag}${necroTag}`,
                });
                fx.triggerAllySkillAnim(mySlot,def.id);
                addLog(`:sparkles: ${def.id}: +${heal} HP${cappedTag}${necroTag}`);
            }
        }
        if (apply.healPartyPctInstant > 0 && character) {
            const playerHeal = Math.max(1, Math.floor(character.max_hp * (apply.healPartyPctInstant / 100)));
            const beforePlayer = sandboxHpRef.current;
            sandboxHpRef.current = Math.min(character.max_hp, beforePlayer + playerHeal);
            setSandboxHp(sandboxHpRef.current);
            const playerActual = sandboxHpRef.current - beforePlayer;
            const playerTag = playerActual < playerHeal ? ' (MAX)' : '';
            fx.pushAllyFloat(mySlot,playerHeal, 'heal', {
                icon: 'sparkles',
                label: playerTag ? `+${playerHeal}${playerTag}` : undefined,
            });
            fx.triggerAllySkillAnim(mySlot,def.id);
            const heal_partyMembers = partyMembers
                .filter((p) => p.id !== character.id)
                .slice(0, 3);
            for (let i = 0; i < heal_partyMembers.length; i++) {
                const m = heal_partyMembers[i];
                if (!m) continue;
                const cur = botHpMap[m.id] ?? 100;
                if (deadAllies.has(m.id) || cur <= 0) continue;
                const realMaxHp = m.maxHp || 100;
                const realHeal = Math.max(1, Math.floor(realMaxHp * (apply.healPartyPctInstant / 100)));
                const barHeal = Math.max(1, Math.floor(100 * (apply.healPartyPctInstant / 100)));
                const newHp = Math.min(100, cur + barHeal);
                if (newHp !== cur) setBotHpMap((prev) => ({ ...prev, [m.id]: newHp }));
                const tag = cur >= 100 ? ' (MAX)' : '';
                const allySlot = slotOfMember(m.id);
                fx.pushAllyFloat(allySlot, realHeal, 'heal', {
                    icon: 'sparkles',
                    label: tag ? `+${realHeal}${tag}` : undefined,
                });
                fx.triggerAllySkillAnim(allySlot, def.id);
            }
            if (character.class === 'Necromancer') {
                useNecroSummonStore.getState().healAllPct(character.id, apply.healPartyPctInstant);
            }
            addLog(`:sparkles: ${def.id}: heal_party_pct ${apply.healPartyPctInstant}%`);
        }
        if (apply.healLowestAllyPct > 0 && character) {
            const allies: Array<{ slot: number; curHp: number; maxHp: number; realMaxHp?: number; setHp: (after: number) => void; name: string }> = [
                {
                    slot: mySlot,
                    curHp: sandboxHpRef.current,
                    maxHp: character.max_hp,
                    realMaxHp: character.max_hp,
                    setHp: (after) => {
                        sandboxHpRef.current = after;
                        setSandboxHp(after);
                    },
                    name: character.name,
                },
                ...otherPartyMembers
                    .map((m) => deadAllies.has(m.id) ? null : ({
                        slot: slotOfMember(m.id),
                        curHp: botHpMap[m.id] ?? 100,
                        maxHp: 100,
                        realMaxHp: m.maxHp || 100,
                        setHp: (after: number) => {
                            setBotHpMap((prev) => ({ ...prev, [m.id]: after }));
                        },
                        name: m.name,
                    }))
                    .filter((a): a is NonNullable<typeof a> => a !== null),
            ];
            let lowest = allies[0];
            let lowestRatio = lowest.curHp / Math.max(1, lowest.maxHp);
            for (let i = 1; i < allies.length; i++) {
                const ratio = allies[i].curHp / Math.max(1, allies[i].maxHp);
                if (ratio < lowestRatio) {
                    lowest = allies[i];
                    lowestRatio = ratio;
                }
            }
            const realMaxHp = (lowest as { realMaxHp?: number }).realMaxHp ?? lowest.maxHp;
            const heal = Math.floor(realMaxHp * (apply.healLowestAllyPct / 100));
            const barHeal = Math.floor(lowest.maxHp * (apply.healLowestAllyPct / 100));
            if (heal > 0) {
                const before = lowest.curHp;
                const after = Math.min(lowest.maxHp, before + barHeal);
                lowest.setHp(after);
                const actual = after - before;
                const cappedTag = actual < barHeal ? ' (MAX)' : '';
                fx.pushAllyFloat(lowest.slot, heal, 'heal', {
                    icon: 'sparkles',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                fx.triggerAllySkillAnim(lowest.slot, def.id);
                addLog(`:sparkles: ${def.id} -> ${lowest.name}: +${heal} HP${cappedTag}`);
            }
        }

        if (apply.reviveDeadAllies) {
            const revivedIds = new Set<string>();
            const revivedNames: string[] = [];
            for (const m of otherPartyMembers) {
                const inSet = deadAllies.has(m.id);
                const hpZero = (botHpMap[m.id] ?? 100) <= 0;
                if (inSet || hpZero) {
                    revivedIds.add(m.id);
                    revivedNames.push(m.name);
                }
            }
            if (revivedNames.length > 0) {
                setDeadAllies((prev) => {
                    const next = new Set(prev);
                    for (const id of revivedIds) next.delete(id);
                    return next;
                });
                setBotHpMap((prev) => {
                    const next = { ...prev };
                    for (const id of revivedIds) next[id] = 100;
                    return next;
                });
                for (let i = 0; i < otherPartyMembers.length; i++) {
                    const m = otherPartyMembers[i];
                    if (revivedIds.has(m.id)) {
                        const allySlot = slotOfMember(m.id);
                        fx.pushAllyFloat(allySlot, 100, 'heal', { icon: 'sparkles', label: '+REZ' });
                        fx.triggerAllySkillAnim(allySlot, def.id);
                    }
                }
                addLog(`:sparkles: ${def.id} -> wskrzeszono: ${revivedNames.join(', ')}`);
            } else {
                addLog(`:sparkles: ${def.id}: brak martwych sojuszników`);
            }
        }

        if (apply.partyImmortalMs > 0) {
            fx.triggerAllySkillAnim(mySlot, def.id);
            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
            for (let i = 0; i < otherPartyMembers.length; i++) {
                const m = otherPartyMembers[i];
                const cur = botHpMap[m.id] ?? 100;
                if (deadAllies.has(m.id) || cur <= 0) continue;
                const allySlot = slotOfMember(m.id);
                fx.triggerAllySkillAnim(allySlot, def.id);
                fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
            }
            addLog(`:sparkles: ${def.id}: party_immortal ${(apply.partyImmortalMs / 1000).toFixed(1)}s`);
        }
        const partyBuffAtoms = (def.effect ?? '').split(';').map((a) => a.trim().toLowerCase());
        const hasPartyBuff = partyBuffAtoms.some((a) =>
            a.startsWith('party_attack_up') ||
            a.startsWith('party_defense_up') ||
            a.startsWith('party_as_up') ||
            a.startsWith('party_crit_up') ||
            a.startsWith('party_def_pen') ||
            a.startsWith('party_lifesteal_next'),
        );
        if (hasPartyBuff) {
            fx.triggerAllySkillAnim(mySlot, def.id);
            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
            for (let i = 0; i < otherPartyMembers.length; i++) {
                const m = otherPartyMembers[i];
                const cur = botHpMap[m.id] ?? 100;
                if (deadAllies.has(m.id) || cur <= 0) continue;
                const allySlot = slotOfMember(m.id);
                fx.triggerAllySkillAnim(allySlot, def.id);
                fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
            }
        }
        const hasEnemyDebuff = partyBuffAtoms.some((a) => a.startsWith('enemy_atk_down') || a.startsWith('enemy_no_heal'));
        if (hasEnemyDebuff) {
            for (let dIdx = 0; dIdx < trainerCount; dIdx++) {
                fx.pushEnemyFloat(dIdx, 0, 'spell', { icon: 'sleeping-face', label: 'DEBUFF' });
            }
        }

        if (apply.summons.length > 0 && character?.class === 'Necromancer') {
            const store = useNecroSummonStore.getState();
            for (const sm of apply.summons) {
                const spawned = store.spawn(character.id, sm.type, sm.count, myAttack, character.max_hp, character.max_mp);
                if (spawned > 0) {
                    addLog(`:skull: Przywołano ${spawned}× ${sm.type}`);
                    fx.triggerAllySkillAnim(mySlot,def.id);
                    fx.triggerAllySummonSpawn(mySlot,sm.type);
                    fx.pushAllyFloat(mySlot,spawned, 'heal', {
                        icon: 'skull',
                        label: `+${spawned}× ${sm.type.toUpperCase()}`,
                    });
                }
            }
        }

        if (apply.deathApocalypse && character) {
            const dummyPseudoMaxHp = Math.max(100, myAttack * 4);
            const apocDmg = Math.max(1, Math.floor(dummyPseudoMaxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
            fx.pushEnemyFloat(0, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
            pushDamage(apocDmg);
            addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`);
        }

        if (apply.aggroSteal && aggroTargetId !== 'player') {
            setAggroTargetId('player');
            addLog(`:anger-symbol: Aggro przejęte na Ciebie!`);
        }

        if ((apply.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(apply.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    const followup = rollBasicHit();
                    pushDamage(followup);
                    setDummyHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, followup, 'basic');
                    addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`);
                }, 120 * (n + 1));
            }
        }

        const sd = getSkillDef(def.id);
        if (sd) applySkillBuff(def.id, sd, speedMult);
    }, [character, activeSkillSlots, myAttack, trainerCount, speedMult, noCooldowns, aggroTargetId, dummyHpPct, fx, pushDamage, addLog, rollBasicHit, deadAllies, isMultiHumanParty]);

    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(speedMult);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [speedMult]);

    const necroSummonsForPlayer = useNecroSummonStore((s) => s.summons[character?.id ?? '']) ?? [];

    if (!character) {
        return (
            <div className="trainer trainer--loading">
                <Spinner size="lg" label="Wczytywanie postaci…" />
            </div>
        );
    }

    const cycleSpeed = () => {
        const idx = SPEED_OPTIONS.indexOf(speedMult);
        const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
        setSpeedMult(next);
    };

    const winLabel = `${BEST_WINDOW_BASE_MS / 1000}s`;

    const uiEnemies: Array<ICombatEnemy | null> = (() => {
        const slots: Array<ICombatEnemy | null> = [];
        for (let i = 0; i < 4; i++) {
            if (i < trainerCount) {
                const dummyStatus = effectsRef.current.statuses.get(TRAINER_DUMMY_FX_ID(i));
                slots.push({
                    id: `training-dummy-${i}`,
                    name: i === 0 ? 'Trening Dummy (∞)' : `Trening Dummy #${i + 1} (∞)`,
                    level: character.level,
                    sprite: 'bullseye',
                    kind: 'monster' as const,
                    currentHp: 100,
                    maxHp: 100,
                    rarity: 'normal',
                    isDead: false,
                    isTargetedByPlayer: i === 0,
                    hitPulse: i === 0 ? dummyHitPulse : 0,
                    attackingClassName: i === 0 ? dummyAttackingClass : null,
                    skillAnim: fx.enemySkill[i] ?? null,
                    floats: fx.enemyFloats[i] ?? [],
                    imageUrl: trainerImg,
                    imageObjectFit: 'cover' as const,
                    statusOverlay: dummyStatus ? (() => {
                        const topAmp = dummyStatus.markAmp.find((m) => m.count > 0 && m.remainingMs > 0);
                        const topRitual = dummyStatus.darkRitualPending.length > 0
                            ? dummyStatus.darkRitualPending.reduce((a, b) => (a.triggerInMs <= b.triggerInMs ? a : b))
                            : null;
                        return {
                            stunMs: dummyStatus.stunMs,
                            immortalMs: dummyStatus.immortalMs,
                            markHealToDmgMs: dummyStatus.markNoHealMs,
                            markAmpMs: topAmp?.remainingMs,
                            markAmpMult: topAmp?.mult,
                            darkRitualMs: topRitual?.triggerInMs,
                            darkRitualPct: topRitual?.pctOfMaxHp,
                            markAmpAllMs: dummyStatus.markAmpAll?.remainingMs,
                            markAmpAllMult: dummyStatus.markAmpAll?.mult,
                            enemyAtkDownMs: dummyStatus.enemyAtkDownMs,
                            enemyAtkDownPct: dummyStatus.enemyAtkDownPct,
                            enemyNoHealMs: dummyStatus.enemyNoHealMs,
                        };
                    })() : undefined,
                });
            } else {
                slots.push(null);
            }
        }
        return slots;
    })();

    const otherPartyMembers = orderedMembers.filter((m) => m.id !== character.id).slice(0, 3);
    const SUMMON_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
    const frontSummon = necroSummonsForPlayer.length > 0
        ? [...necroSummonsForPlayer].sort((a, b) => SUMMON_RANK[a.type] - SUMMON_RANK[b.type])[0]
        : null;
    const playerAvatar = (character.class === 'Necromancer' && frontSummon)
        ? (getSummonImage(frontSummon.type) ?? getCharacterAvatar(character.class, completedTransforms))
        : getCharacterAvatar(character.class, completedTransforms);
    const SUMMON_LABELS: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
        skeleton: 'Szkielet',
        ghost: 'Duch',
        demon: 'Demon',
        lich: 'Lisz',
    };
    const playerName = (character.class === 'Necromancer' && frontSummon)
        ? SUMMON_LABELS[frontSummon.type]
        : character.name;
    const memberMirroredHp = (isMultiHumanParty && !iAmLeader && botHpMap[character.id] !== undefined)
        ? Math.floor(character.max_hp * (botHpMap[character.id] / 100))
        : null;
    const playerCardCurHp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.hp
        : Math.max(0, memberMirroredHp ?? sandboxHp);
    const playerCardMaxHp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.maxHp
        : character.max_hp;
    const playerCardCurMp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.mp
        : Math.max(0, sandboxMp);
    const playerCardMaxMp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.maxMp
        : character.max_mp;
    const summonsByTypeMap: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
    for (const s of necroSummonsForPlayer) {
        summonsByTypeMap[s.type] = (summonsByTypeMap[s.type] ?? 0) + 1;
    }
    const uiAllies: Array<ICombatAlly | null> = orderedMembers.map<ICombatAlly>((m) => {
        const isSelf = m.id === character.id;
        const slotIdx = slotOfMember(m.id);
        const selfSandboxDead = isSelf && deadAllies.has(m.id);
        if (isSelf) {
            return {
                id: character.id,
                name: playerName,
                avatarUrl: playerAvatar,
                accentColor: myColor,
                className: character.class,
                currentHp: playerCardCurHp,
                maxHp: playerCardMaxHp,
                currentMp: playerCardCurMp,
                maxMp: playerCardMaxMp,
                isDead: selfSandboxDead,
                isPlayer: true,
                level: character.level,
                aggroCount: trainerAttacks && aggroTargetId === 'player' ? 1 : 0,
                summonCount: necroSummonsForPlayer.length || undefined,
                summonsByType: necroSummonsForPlayer.length > 0 ? summonsByTypeMap : undefined,
                onSummonClick: (type) => {
                    useNecroSummonStore.getState().despawnOne(character.id, type);
                    addLog(`:dashing-away: Odesłano: ${type}`);
                },
                hitPulse: playerHitPulse,
                attackingClassName: playerAttackingClass,
                skillAnim: fx.allySkill[slotIdx] ?? null,
                floats: fx.allyFloats[slotIdx] ?? [],
                summonSpawn: fx.allySummonSpawn[slotIdx] ?? null,
            };
        }
        const sandboxDead = deadAllies.has(m.id);
        const sandboxHpRemote = sandboxDead ? 0 : (botHpMap[m.id] ?? 100);
        const allyPresence = usePartyPresenceStore.getState().byMember[m.id];
        const allyTransformTier = allyPresence?.transformTier ?? 0;
        const remoteSummons = m.class === 'Necromancer' ? (allyPresence?.summons ?? []) : [];
        const remoteSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
        for (const s of remoteSummons) {
            remoteSummonsByType[s.type] = (remoteSummonsByType[s.type] ?? 0) + 1;
        }
        const remoteFrontSummon = remoteSummons.length > 0
            ? [...remoteSummons].sort((a, b) => SUMMON_RANK[a.type] - SUMMON_RANK[b.type])[0]
            : null;
        const REMOTE_SUMMON_LABELS: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
            skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
        };
        const remoteName = remoteFrontSummon ? REMOTE_SUMMON_LABELS[remoteFrontSummon.type] : m.name;
        const remoteAvatar = remoteFrontSummon
            ? (getSummonImage(remoteFrontSummon.type) ?? getCharacterAvatar(m.class, allyTransformTier ? [allyTransformTier] : []))
            : getCharacterAvatar(m.class, allyTransformTier ? [allyTransformTier] : []);
        return {
            id: m.id,
            name: remoteName,
            avatarUrl: remoteAvatar,
            accentColor: CLASS_COLORS[m.class] ?? '#888',
            className: m.class,
            currentHp: sandboxHpRemote,
            maxHp: 100,
            currentMp: sandboxDead ? 0 : 100,
            maxMp: 100,
            isDead: sandboxDead || sandboxHpRemote <= 0,
            isPlayer: false,
            isBot: !!m.isBot,
            level: m.level,
            aggroCount: aggroTargetId === m.id && trainerAttacks ? 1 : 0,
            attackingClassName: allyAttackingClassMap[m.id] ?? null,
            skillAnim: fx.allySkill[slotIdx] ?? null,
            floats: fx.allyFloats[slotIdx] ?? [],
            summonCount: remoteSummons.length || undefined,
            summonsByType: remoteSummons.length > 0 ? remoteSummonsByType : undefined,
        };
    });
    while (uiAllies.length < 4) uiAllies.push(null);

    const uiSkills: Array<ICombatSkillSlot | null> = activeSkillSlots.slice(0, 4).map((slotId, idx) => {
        if (!slotId) return null;
        const playerSkills = getClassActiveSkills(character.class);
        const def = playerSkills.find((s) => s.id === slotId);
        if (!def) return null;
        const cdMs = skillCooldownsMs[slotId] ?? 0;
        const totalMs = def.cooldown;
        const onCd = cdMs > 0;
        const locked = def.unlockLevel > character.level;
        return {
            id: slotId,
            icon: getSkillIcon(slotId),
            name: slotId,
            mpCost: def.mpCost,
            cooldownProgress: onCd ? 1 - cdMs / totalMs : 1,
            cooldownRemainingMs: cdMs,
            disabled: onCd || locked,
            onClick: () => doManualSkill(idx),
        } as ICombatSkillSlot;
    });
    while (uiSkills.length < 4) uiSkills.push(null);

    return (
        <div className="trainer">
            <CombatHudHost active={true} accent={playerAccent} compact>
                <div className="combat-ui">
                    <CombatTopControls
                        speed={{ label: `X${speedMult}`, onCycle: cycleSpeed, disabled: isNonLeaderMember }}
                        autoSkill={{ on: autoSkill, onToggle: () => setAutoSkill((v) => !v) }}
                        autoFight={{ on: autoBasic, onToggle: () => setAutoBasic((v) => !v) }}
                        extras={(() => {
                            const memberDisabled = isNonLeaderMember;
                            const disabledStyle: React.CSSProperties = memberDisabled
                                ? { opacity: 0.45, cursor: 'not-allowed' }
                                : {};
                            const memberTitle = 'Tylko lider party może zmieniać ten parametr';
                            return (
                                <>
                                    <button
                                        type="button"
                                        className={`combat-ui__chip${trainerAttacks ? ' combat-ui__chip--on' : ''}`}
                                        onClick={memberDisabled ? undefined : () => setTrainerAttacks((v) => !v)}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Trainer oddaje (1 HP / cios)'}
                                    >
                                        <GameIcon name="bullseye" /> {trainerAttacks ? 'ON' : 'OFF'}
                                    </button>
                                    <button
                                        type="button"
                                        className={`combat-ui__chip${noCooldowns ? ' combat-ui__chip--on' : ''}`}
                                        onClick={memberDisabled ? undefined : () => setNoCooldowns((v) => !v)}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Wyłącz cooldowny skilli (sandbox)'}
                                    >
                                        <GameIcon name="stopwatch" /> Brak CD: {noCooldowns ? 'ON' : 'OFF'}
                                    </button>
                                    <label
                                        className="trainer__hp-slider"
                                        title={memberDisabled ? memberTitle : 'Symulowany % HP trainera dla execute_below (Egzekucja / Skrytobójstwo)'}
                                        style={disabledStyle}
                                    >
                                        <span className="trainer__hp-slider-label"><GameIcon name="drop-of-blood" /> Dummy HP:</span>
                                        <input
                                            type="range"
                                            min={0}
                                            max={100}
                                            step={5}
                                            value={dummyHpPct}
                                            disabled={memberDisabled}
                                            onChange={memberDisabled ? undefined : (e) => setDummyHpPct(parseInt(e.target.value, 10) || 0)}
                                        />
                                        <span className="trainer__hp-slider-val">{dummyHpPct}%</span>
                                    </label>
                                    {otherPartyMembers.length > 0 && (
                                        <button
                                            type="button"
                                            className="combat-ui__chip"
                                            onClick={memberDisabled ? undefined : () => setKillAllyPickerOpen(true)}
                                            aria-disabled={memberDisabled || undefined}
                                            style={disabledStyle}
                                            title={memberDisabled ? memberTitle : 'Uśmierć sojusznika (sandbox)'}
                                        >
                                            <GameIcon name="skull" /> Uśmierć
                                        </button>
                                    )}
                                    {trainerAttacks && otherPartyMembers.length > 0 && (
                                        <button
                                            type="button"
                                            className="combat-ui__chip"
                                            onClick={memberDisabled ? undefined : () => setAggroPickerOpen(true)}
                                            aria-disabled={memberDisabled || undefined}
                                            style={disabledStyle}
                                            title={memberDisabled ? memberTitle : 'Zmień cel ataków trainera'}
                                        >
                                            <GameIcon name="bullseye" /> Cel: {(() => {
                                                if (aggroTargetId === 'player') return character.name;
                                                const m = otherPartyMembers.find((x) => x.id === aggroTargetId);
                                                return m ? m.name : 'Player';
                                            })()}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="combat-ui__chip"
                                        onClick={memberDisabled ? undefined : () => setTrainerCount((n) => (n >= 4 ? 1 : n + 1))}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Dodaj trening dummy (max 4)'}
                                    >
                                        <Icon name="plus" /> Trainer ({trainerCount}/4)
                                    </button>
                                    <button
                                        type="button"
                                        className="combat-ui__chip"
                                        onClick={memberDisabled ? undefined : resetSession}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Reset sesji'}
                                    >
                                        <GameIcon name="counterclockwise-arrows-button" /> Reset
                                    </button>
                                </>
                            );
                        })()}
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
                                if (iAmLeader) {
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishCombatEnd();
                                    }).catch(() => { });
                                }
                                useCombatStore.getState().clearCombatSession();
                                navigate('/');
                            },
                        }}
                    />
                </div>
            </CombatHudHost>

            <div className="trainer__stats">
                <div><span>Całkowite obrażenia:</span> <strong>{totalDmg.toLocaleString('pl-PL')}</strong></div>
                <div><span>Ostatnie {winLabel}:</span> <strong>{curWindow.toLocaleString('pl-PL')}</strong></div>
                <div><span>Best {winLabel}:</span> <strong style={{ color: '#ffc107' }}>{bestWindow.toLocaleString('pl-PL')}</strong></div>
            </div>

            {aggroPickerOpen && (
                <div className="trainer__kill-overlay" onClick={() => setAggroPickerOpen(false)}>
                    <div className="trainer__kill-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="trainer__kill-title"><GameIcon name="bullseye" /> Wybierz cel ataków trainera</div>
                        <div className="trainer__kill-hint">
                            Trainer będzie atakował wybrany cel. Knight Wicher / Cięcie Boga (aggro_steal) automatycznie przeniesie cel z powrotem na Ciebie.
                        </div>
                        <ul className="trainer__kill-list">
                            <li className="trainer__kill-row">
                                <span className="trainer__kill-row-name">
                                    <span style={{ color: CLASS_COLORS[character.class] ?? '#fff' }}><Icon name="dot" /></span> {character.name}
                                    <small> (Ty, lvl {character.level} {character.class})</small>
                                </span>
                                <button
                                    type="button"
                                    className={`trainer__kill-row-btn${aggroTargetId === 'player' ? ' trainer__kill-row-btn--revive' : ' trainer__kill-row-btn--kill'}`}
                                    onClick={() => {
                                        setAggroTargetId('player');
                                        addLog(`:bullseye: Cel trainera: ${character.name}`);
                                        setAggroPickerOpen(false);
                                    }}
                                >
                                    {aggroTargetId === 'player' ? <><GameIcon name="check-mark-button" /> Aktywny</> : <><GameIcon name="bullseye" /> Wybierz</>}
                                </button>
                            </li>
                            {otherPartyMembers.map((m) => {
                                const isActive = aggroTargetId === m.id;
                                return (
                                    <li key={m.id} className="trainer__kill-row">
                                        <span className="trainer__kill-row-name">
                                            <span style={{ color: CLASS_COLORS[m.class] ?? '#fff' }}><Icon name="dot" /></span> {m.name}
                                            <small> (lvl {m.level} {m.class})</small>
                                        </span>
                                        <button
                                            type="button"
                                            className={`trainer__kill-row-btn${isActive ? ' trainer__kill-row-btn--revive' : ' trainer__kill-row-btn--kill'}`}
                                            onClick={() => {
                                                setAggroTargetId(m.id);
                                                addLog(`:bullseye: Cel trainera: ${m.name}`);
                                                setAggroPickerOpen(false);
                                            }}
                                        >
                                            {isActive ? <><GameIcon name="check-mark-button" /> Aktywny</> : <><GameIcon name="bullseye" /> Wybierz</>}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        <button
                            type="button"
                            className="trainer__kill-close"
                            onClick={() => setAggroPickerOpen(false)}
                        >
                            Zamknij
                        </button>
                    </div>
                </div>
            )}

            {killAllyPickerOpen && (
                <div className="trainer__kill-overlay" onClick={() => setKillAllyPickerOpen(false)}>
                    <div className="trainer__kill-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="trainer__kill-title"><GameIcon name="skull" /> Sandbox: uśmierć / wskrześ sojusznika</div>
                        <div className="trainer__kill-hint">
                            Tylko do testów spelli (rez / heal / tarcza). Brak konsekwencji — XP, eq i poziom postaci sojusznika pozostają nietknięte.
                        </div>
                        {otherPartyMembers.length === 0 ? (
                            <div className="trainer__kill-empty">Brak sojuszników w party.</div>
                        ) : (
                            <ul className="trainer__kill-list">
                                {otherPartyMembers.map((m) => {
                                    const isDead = deadAllies.has(m.id);
                                    return (
                                        <li key={m.id} className="trainer__kill-row">
                                            <span className="trainer__kill-row-name">
                                                <span style={{ color: CLASS_COLORS[m.class] ?? '#fff' }}><Icon name="dot" /></span> {m.name}
                                                <small> (lvl {m.level} {m.class})</small>
                                            </span>
                                            <button
                                                type="button"
                                                className={`trainer__kill-row-btn${isDead ? ' trainer__kill-row-btn--revive' : ' trainer__kill-row-btn--kill'}`}
                                                onClick={() => {
                                                    let nowKilled = false;
                                                    setDeadAllies((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(m.id)) {
                                                            next.delete(m.id);
                                                            addLog(`:sparkles: Wskrzeszono ${m.name} (sandbox)`);
                                                        } else {
                                                            next.add(m.id);
                                                            addLog(`:skull: Uśmiercono ${m.name} (sandbox, 0 konsekwencji)`);
                                                            nowKilled = true;
                                                        }
                                                        return next;
                                                    });
                                                    if (nowKilled && aggroTargetId === m.id) {
                                                        setAggroTargetId('player');
                                                        addLog(`:anger-symbol: Aggro spadło z ${m.name} -> wracasz do gracza`);
                                                    }
                                                }}
                                            >
                                                {isDead ? <><GameIcon name="sparkles" /> Wskrześ</> : <><GameIcon name="skull" /> Uśmierć</>}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <button
                            type="button"
                            className="trainer__kill-close"
                            onClick={() => setKillAllyPickerOpen(false)}
                        >
                            Zamknij
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Trainer;
