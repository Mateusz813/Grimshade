import {
    calculateDamage,
    calculateDualWieldDamage,
    mitigateDamage,
    rollMonsterDamage,
    KILL_XP_TTK_MULT,
    GEAR_HP_SCALE,
} from './combat';
import { applyDeathPenalty } from './levelSystem';
import { consumeDeathProtection } from './deathProtection';
import { applySkillBuff, getSkillDef } from './skillBuffs';
import {
    calculateGoldDrop,
    rollLoot,
    rollMonsterRarity,
    rollStoneDrop,
    rollPotionDrop,
    rollSpellChestDrop,
    getSpellChestIcon,
    getSpellChestDisplayName,
    getGeneratedSellPrice,
    MONSTER_RARITY_MULTIPLIERS,
    MONSTER_RARITY_LABELS,
    MONSTER_RARITY_TASK_KILLS,
    type TMonsterRarity,
} from './lootSystem';
import { getClassSkillBonus, formatItemName, getTotalEquipmentStats, getEquippedGearLevel, getGearGapMultiplier, flattenItemsData, STONE_ICONS, STONE_NAMES, getRequiredStoneType, DISASSEMBLE_STONE_CHANCE, type IBaseItem } from './itemSystem';
import { getTrainingBonuses, rollSkillDamageMult, getShieldingDefBonus } from './skillSystem';
import {
    getAtkDamageMultiplier,
    getSpellDamageMultiplier,
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirAtkBonus,
    getElixirDefBonus,
    getElixirAttackSpeedMultiplier,
    getElixirHpPctMultiplier,
    getElixirMpPctMultiplier,
    tickCombatElixirs,
} from './combatElixirs';
import {
    getTransformDmgMultiplier,
    getTransformFlatHp,
    getTransformFlatMp,
    getTransformFlatAttack,
    getTransformFlatDefense,
    getTransformHpRegenFlat,
    getTransformMpRegenFlat,
    getTransformHpPctMultiplier,
    getTransformMpPctMultiplier,
    getTransformDefPctMultiplier,
    getTransformAtkPctMultiplier,
} from './transformBonuses';
import { generateRandomItem, getItemDisplayInfo } from './itemGenerator';
import { getMonsterUnlockStatus } from './progression';
import {
    getPotionCooldownMs,
    resolveAutoPotionElixir,
} from './potionSystem';
import itemsData from '../data/items.json';
import monstersRaw from '../data/monsters.json';
import classesRaw from '../data/classes.json';
import { useCombatStore, type IMonster } from '../stores/combatStore';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { useAttributeStore } from '../stores/attributeStore';
import { useSettingsStore, type CombatSpeed } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { ELIXIRS } from '../stores/shopStore';
import { saveCurrentCharacterStores, saveCurrentCharacterStoresForce } from '../stores/characterScope';
import { deathsApi } from '../api/v1/deathsApi';
import { isBackendMode } from '../config/backendMode';
import { backendApi } from '../api/backend/backendApi';
import { useBuffStore } from '../stores/buffStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../stores/masteryStore';
import { useCooldownStore } from '../stores/cooldownStore';
import { useDeathStore } from '../stores/deathStore';
import { useOfflineHuntStore } from '../stores/offlineHuntStore';
import { useBotStore } from '../stores/botStore';
import { usePartyStore } from '../stores/partyStore';
import {
    pickWeightedAggroTarget,
    calculateXpMultiplier,
    calculateDropMultiplier,
} from './partySystem';
import type { TCharacterClass } from '../types/character';
import type { CharacterClass } from '../api/v1/characterApi';
import {
    newCombatEffectsSession,
    ensureStatus,
    isCombatantStunned,
    castSkill as effectsCastSkill,
    tickAll as effectsTickAll,
    routeDamage as effectsRouteDamage,
    type ICombatEffectsSession,
} from './combatEffectsHelpers';
import { consumeCasterBasicHitMods, consumeTargetMarkAmp, skillTargetsEnemy, applyManaShieldRedirect } from './skillEffectsV2';

export const syncCasterChargeConsume = (
    consumed: {
        dmgAmpNext: boolean;
        critNext: boolean;
        critBuffNext: boolean;
        lifestealNext?: boolean;
        nextAllyHeal?: boolean;
    },
): void => {
    const bs = useBuffStore.getState();
    if (consumed.dmgAmpNext)    bs.consumeBuffCharge('skill_charge_dmg_amp_next');
    if (consumed.critNext)      bs.consumeBuffCharge('skill_charge_crit_next');
    if (consumed.critBuffNext)  bs.consumeBuffCharge('skill_charge_crit_buff_next');
    if (consumed.lifestealNext) bs.consumeBuffCharge('skill_charge_party_lifesteal_next');
    if (consumed.nextAllyHeal)  bs.consumeBuffCharge('skill_charge_next_ally_heal');
};
import { useNecroSummonStore } from '../stores/necroSummonStore';


const SKILL_MP_COST_FLOOR = 15;
export const getSkillMpCost = (skillId?: string | null): number => {
    if (!skillId) return SKILL_MP_COST_FLOOR;
    try {
        const def = getSkillDef(skillId);
        const c = def?.mpCost;
        if (typeof c === 'number' && c > 0) return c;
        return SKILL_MP_COST_FLOOR;
    } catch {
        return SKILL_MP_COST_FLOOR;
    }
};
const SKILL_COOLDOWN_MS = 20000;
export const REVIVE_PROTECT_MS = 3000;

let huntEffects: ICombatEffectsSession = newCombatEffectsSession();
const HUNT_PLAYER_FX_ID = 'player';
const huntMonsterFxId = (slot: number, id: string): string => `m_${slot}_${id}`;
const lastDotTickAtRef = { value: Date.now() };

export const resetHuntEffects = (): void => {
    huntEffects = newCombatEffectsSession();
    lastDotTickAtRef.value = Date.now();
};

export const consumeHuntMonsterMarkAmp = (slot: number, monsterId: string): {
    mult: number;
    consumed: boolean;
} => {
    const st = huntEffects.statuses.get(huntMonsterFxId(slot, monsterId));
    return consumeTargetMarkAmp(st);
};

export const clearHuntNecroSummons = (): void => {
    useNecroSummonStore.getState().clear(HUNT_PLAYER_FX_ID);
};

export const isHuntPlayerStunned = (): boolean =>
    isCombatantStunned(huntEffects, HUNT_PLAYER_FX_ID);

export const isHuntMonsterStunned = (slot: number, id: string): boolean =>
    isCombatantStunned(huntEffects, huntMonsterFxId(slot, id));

export const huntMonsterSlowSkips = (slot: number, id: string, rng: () => number = Math.random): boolean => {
    const st = huntEffects.statuses.get(huntMonsterFxId(slot, id));
    if (!st || st.enemySlowMs <= 0 || st.enemySlowPct <= 0) return false;
    return rng() * 100 < st.enemySlowPct;
};

export const getHuntMonsterStatusView = (slot: number, id: string): {
    stunMs: number;
    immortalMs: number;
    markHealToDmgMs: number;
    markAmpMs: number;
    markAmpMult: number;
    darkRitualMs: number;
    darkRitualPct: number;
    markAmpAllMs: number;
    markAmpAllMult: number;
} => {
    const st = huntEffects.statuses.get(huntMonsterFxId(slot, id));
    if (!st) return { stunMs: 0, immortalMs: 0, markHealToDmgMs: 0, markAmpMs: 0, markAmpMult: 0, darkRitualMs: 0, darkRitualPct: 0, markAmpAllMs: 0, markAmpAllMult: 0 };
    const top = st.markAmp.find((m) => m.count > 0 && m.remainingMs > 0);
    const topRitual = st.darkRitualPending.length > 0
        ? st.darkRitualPending.reduce((a, b) => (a.triggerInMs <= b.triggerInMs ? a : b))
        : null;
    return {
        stunMs: st.stunMs,
        immortalMs: st.immortalMs,
        markHealToDmgMs: st.markNoHealMs,
        markAmpMs: top?.remainingMs ?? 0,
        markAmpMult: top?.mult ?? 0,
        darkRitualMs: topRitual?.triggerInMs ?? 0,
        darkRitualPct: topRitual?.pctOfMaxHp ?? 0,
        markAmpAllMs: st.markAmpAll?.remainingMs ?? 0,
        markAmpAllMult: st.markAmpAll?.mult ?? 0,
    };
};

export const huntStatusTick = (): void => {
    const s = useCombatStore.getState();
    const ch = useCharacterStore.getState().character;
    if (!ch || s.phase !== 'fighting') return;
    const eff = getEffectiveChar(ch);
    const refs = [
        { id: HUNT_PLAYER_FX_ID, maxHp: eff?.max_hp ?? ch.max_hp },
        ...s.waveMonsters
            .map((wm, idx) => ({ wm, idx }))
            .filter(({ wm }) => !wm.isDead)
            .map(({ wm, idx }) => ({ id: huntMonsterFxId(idx, wm.monster.id), maxHp: wm.maxHp })),
    ];
    const now = Date.now();
    const wallDelta = Math.min(1000, Math.max(50, now - lastDotTickAtRef.value));
    lastDotTickAtRef.value = now;
    const speedMult = SPEED_MULT[useSettingsStore.getState().combatSpeed] ?? 1;
    const delta = wallDelta * speedMult;
    const dots = effectsTickAll(huntEffects, refs, delta);
    for (const r of dots) {
        if (r.dotDamage <= 0 && !r.darkRitualTriggered) continue;
        if (r.id === HUNT_PLAYER_FX_ID) {
            if (r.dotDamage > 0) {
                const apply = effectsRouteDamage(huntEffects, HUNT_PLAYER_FX_ID, s.playerCurrentHp, r.dotDamage);
                if (apply.appliedDmg > 0) useCombatStore.getState().dealToPlayer(apply.appliedDmg);
            }
        } else {
            const live = useCombatStore.getState().waveMonsters;
            for (let slotIdx = 0; slotIdx < live.length; slotIdx++) {
                const wm = live[slotIdx];
                if (wm.isDead) continue;
                if (huntMonsterFxId(slotIdx, wm.monster.id) !== r.id) continue;
                if (r.dotDamage > 0) {
                    const apply = effectsRouteDamage(huntEffects, r.id, wm.currentHp, r.dotDamage);
                    if (apply.appliedDmg > 0) {
                        useCombatStore.getState().damageWaveMonster(slotIdx, apply.appliedDmg);
                        useCombatStore.getState().emitCombatEvent({
                            type: 'dotTick',
                            data: { targetIdx: slotIdx, damage: apply.appliedDmg },
                            timestamp: Date.now(),
                        });
                    }
                }
                if (r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    const ritualDmg = Math.min(useCombatStore.getState().waveMonsters[slotIdx]?.currentHp ?? 0, r.darkRitualDamage);
                    if (ritualDmg > 0) {
                        useCombatStore.getState().damageWaveMonster(slotIdx, ritualDmg);
                        useCombatStore.getState().emitCombatEvent({
                            type: 'darkRitualTick',
                            data: { targetIdx: slotIdx, damage: ritualDmg },
                            timestamp: Date.now(),
                        });
                    }
                }
                const afterTick = useCombatStore.getState();
                const slotAfter = afterTick.waveMonsters[slotIdx];
                if (slotAfter && slotAfter.currentHp <= 0 && !slotAfter.isDead && afterTick.phase === 'fighting') {
                    if (slotIdx === afterTick.activeTargetIdx) {
                        handleMonsterDeath(afterTick.monsterRarity);
                    } else {
                        useCombatStore.setState((s) => ({
                            waveMonsters: s.waveMonsters.map((w, i) =>
                                i === slotIdx ? { ...w, isDead: true, currentHp: 0 } : w,
                            ),
                        }));
                    }
                }
                break;
            }
        }
    }
};

export const huntApplySkillEffectV2 = (
    skillId: string,
    activeIdx: number,
) => {
    const s = useCombatStore.getState();
    const ch = useCharacterStore.getState().character;
    if (!ch) return null;
    if ((ch.hp ?? 0) <= 0 || s.playerCurrentHp <= 0) return null;
    let wm = s.waveMonsters[activeIdx];
    if (!wm || wm.isDead || wm.currentHp <= 0) {
        const aliveIdx = s.waveMonsters.findIndex((w) => !w.isDead && w.currentHp > 0);
        if (aliveIdx < 0) return null;
        activeIdx = aliveIdx;
        wm = s.waveMonsters[aliveIdx];
        useCombatStore.setState({
            activeTargetIdx: aliveIdx,
            monster: wm.monster,
            monsterCurrentHp: wm.currentHp,
            monsterMaxHp: wm.maxHp,
            monsterRarity: wm.rarity,
        });
    }
    if (!wm) return null;
    const def = getSkillDef(skillId);
    {
        const partyState = usePartyStore.getState().party;
        if (partyState && ch?.id) {
            const otherHumans = partyState.members.filter((m) => m.id !== ch.id && !m.isBot);
            if (otherHumans.length > 0) {
                const isDamageHitLocal = ((def as unknown as { damage?: number })?.damage ?? 0) > 0;
                import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishSpellCast({
                        casterId:    ch.id,
                        casterName:  ch.name,
                        skillId,
                        label:       def?.name_pl ?? def?.name_en ?? skillId,
                        targetIdx:   activeIdx,
                        isDamageHit: isDamageHitLocal,
                    });
                }).catch(() => { });
            }
        }
    }
    if ((def?.effect ?? '').includes('death_apocalypse') && ch.class === 'Necromancer') {
        const playerCurHp = useCombatStore.getState().playerCurrentHp;
        const effChar = getEffectiveChar(ch);
        const playerMaxHp = effChar?.max_hp ?? ch.max_hp;
        const hpPct = playerCurHp / Math.max(1, playerMaxHp);
        if (hpPct < 0.05) {
            useCombatStore.getState().addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP', 'system');
            return null;
        }
        let newPlayerHp: number;
        if (hpPct > 0.20) {
            newPlayerHp = Math.max(1, playerCurHp - Math.floor(playerMaxHp * 0.20));
        } else {
            newPlayerHp = Math.max(1, Math.floor(playerMaxHp * 0.03));
        }
        const lost = playerCurHp - newPlayerHp;
        if (lost > 0) {
            useCombatStore.getState().dealToPlayer(lost);
            useCharacterStore.getState().updateCharacter({
                hp: useCombatStore.getState().playerCurrentHp,
            });
            useCombatStore.getState().addLog(
                `:broken-heart: Apokalipsa: -${lost} HP (kanał życia)`,
                'system',
            );
        }
    }
    const aliveBotIds = useBotStore.getState().bots.filter((b) => b.alive).map((b) => b.id);
    const apply = effectsCastSkill({
        session: huntEffects,
        casterId: HUNT_PLAYER_FX_ID,
        targetId: huntMonsterFxId(activeIdx, wm.monster.id),
        targetHpPct: wm.maxHp > 0 ? (wm.currentHp / wm.maxHp) * 100 : 100,
        effect: def?.effect ?? null,
        allyIds: [HUNT_PLAYER_FX_ID, ...aliveBotIds],
        enemyIds: s.waveMonsters
            .map((m, i) => ({ m, i }))
            .filter(({ m }) => !m.isDead)
            .map(({ m, i }) => huntMonsterFxId(i, m.monster.id)),
    });
    if (apply?.summons && apply.summons.length > 0 && ch.class === 'Necromancer') {
        const store = useNecroSummonStore.getState();
        for (const sm of apply.summons) {
            const spawned = store.spawn(HUNT_PLAYER_FX_ID, sm.type, sm.count, ch.attack, ch.max_hp);
            if (spawned > 0) {
                useCombatStore.getState().emitCombatEvent({
                    type: 'summonSpawn',
                    data: { summonType: sm.type, count: spawned },
                    timestamp: Date.now(),
                });
            }
        }
    }
    if (apply?.deathApocalypse && ch.class === 'Necromancer') {
        const apocDmg = Math.max(1, Math.floor(wm.maxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
        useCombatStore.getState().damageWaveMonster(activeIdx, apocDmg);
        useCombatStore.getState().addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'system');
        useCombatStore.getState().emitCombatEvent({
            type: 'monsterHit',
            data: { damage: apocDmg, isCrit: true, isBlocked: false, hand: null, targetIdx: activeIdx },
            timestamp: Date.now(),
        });
        const afterApoc = useCombatStore.getState();
        if (afterApoc.monsterCurrentHp <= 0 && afterApoc.phase === 'fighting') {
            handleMonsterDeath(afterApoc.monsterRarity);
        }
    }
    return apply;
};

export const SPEED_MULT: Record<string, number> = { x1: 1, x2: 2, x4: 4 };
export const SPEED_ORDER: CombatSpeed[] = ['x1', 'x2', 'x4', 'SKIP'];

const CLASS_MODIFIER: Record<string, number> = {
    Knight: 1.0, Mage: 1.3, Cleric: 1.0,
    Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};

interface IClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
    canBlock?: boolean;
    canDodge?: boolean;
    maxCritChance?: number;
    mlvlFromAttacks?: boolean;
}

const classesArray = classesRaw as unknown as (IClassData & { id: string })[];
const classesData: Record<string, IClassData> = {};
for (const c of classesArray) {
    classesData[c.id] = c;
}

const ALL_ITEMS: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
const monsters = monstersRaw as unknown as IMonster[];

const STONE_TYPE_TO_RARITY: Record<string, 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic'> = {
    common_stone: 'common', rare_stone: 'rare', epic_stone: 'epic',
    legendary_stone: 'legendary', mythic_stone: 'mythic', heroic_stone: 'heroic',
};

const STONE_NAMES_MAP: Record<string, string> = {
    normal: 'Common Stone', strong: 'Rare Stone', epic: 'Epic Stone',
    legendary: 'Legendary Stone', boss: 'Mythic Stone',
    common_stone: 'Common Stone', rare_stone: 'Rare Stone', epic_stone: 'Epic Stone',
    legendary_stone: 'Legendary Stone', mythic_stone: 'Mythic Stone', heroic_stone: 'Heroic Stone',
};

const stoneTypeToRarity = (stoneType: string): 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic' =>
    STONE_TYPE_TO_RARITY[stoneType] ?? 'common';

const skillCooldownMap = new Map<string, number>();

export const advanceSkillCooldowns = (ms: number): void => {
    for (const [skillId, lastUsed] of skillCooldownMap.entries()) {
        skillCooldownMap.set(skillId, lastUsed - ms);
    }
};


export const hydrateBotsFromParty = (): void => {
    const party = usePartyStore.getState().party;
    if (!party) return;
    const botMembers = party.members.filter((m) => m.isBot);
    if (botMembers.length === 0) return;
    if (useBotStore.getState().bots.length > 0) return;

    const char = useCharacterStore.getState().character;
    if (!char) return;

    const botClasses = botMembers.map((m) => m.class as TCharacterClass);
    useBotStore.getState().generateBotsCustom(char.level, botClasses);

    useCombatStore.getState().addLog(
        `:handshake: Twoja drużyna (${botMembers.length} bot${botMembers.length === 1 ? '' : 'y'}) dołącza do walki!`,
        'system',
    );
};


const AGGRO_SWITCH_INTERVAL_MS = 10_000;
let aggroTargetId: string | null = null;
let aggroLastSwitchAt = 0;

export const resetAggro = (): void => {
    aggroTargetId = null;
    aggroLastSwitchAt = 0;
    waveAggroState.clear();
};

interface IWaveAggroEntry {
    targetId: string;
    lastSwitchAt: number;
}
const waveAggroState = new Map<number, IWaveAggroEntry>();

const maybeSwitchWaveAggro = (waveIdx: number): string => {
    const now = Date.now();
    const entry = waveAggroState.get(waveIdx);
    const partyState = usePartyStore.getState().party;
    const knownHumanIds = new Set(
        (partyState?.members ?? [])
            .filter((m) => !m.isBot)
            .map((m) => `human_${m.id}`),
    );
    const alive = entry && (
        entry.targetId === 'player'
        || useBotStore.getState().bots.some((b) => b.id === entry.targetId && b.alive)
        || knownHumanIds.has(entry.targetId)
    );
    const needsRoll = !entry
        || !alive
        || now - entry.lastSwitchAt >= AGGRO_SWITCH_INTERVAL_MS;
    if (needsRoll) {
        const targetId = rollAggroTarget();
        waveAggroState.set(waveIdx, { targetId, lastSwitchAt: now });
        return targetId;
    }
    return entry.targetId;
};

const rollAggroTarget = (): string => {
    const char = useCharacterStore.getState().character;
    if (!char) return 'player';
    const aliveBots = useBotStore.getState().bots.filter((b) => b.alive);
    const partyState = usePartyStore.getState().party;
    const remoteHumans: Array<{ id: string; class: CharacterClass }> = [];
    if (partyState && partyState.leaderId === char.id) {
        for (const m of partyState.members) {
            if (m.isBot) continue;
            if (m.id === char.id) continue;
            remoteHumans.push({
                id: `human_${m.id}`,
                class: m.class as CharacterClass,
            });
        }
    }
    const candidates: Array<{ id: string; class: CharacterClass }> = [
        { id: 'player', class: char.class as CharacterClass },
        ...aliveBots.map((b) => ({ id: b.id, class: b.class as CharacterClass })),
        ...remoteHumans,
    ];
    return pickWeightedAggroTarget(candidates) ?? 'player';
};

export const maybeSwitchAggro = (): string => {
    const now = Date.now();
    const needsRoll = aggroTargetId === null
        || now - aggroLastSwitchAt >= AGGRO_SWITCH_INTERVAL_MS
        || (aggroTargetId !== 'player'
            && !useBotStore.getState().bots.some((b) => b.id === aggroTargetId && b.alive));
    if (needsRoll) {
        aggroTargetId = rollAggroTarget();
        aggroLastSwitchAt = now;
    }
    return aggroTargetId ?? 'player';
};


export interface IDropDisplay {
    icon: string;
    name: string;
    rarity: string;
    upgradeLevel?: number;
    sold?: boolean;
    soldPrice?: number;
    disassembled?: boolean;
    stoneGained?: string;
}

export interface ICombatEvent {
    type: 'playerHit' | 'monsterHit' | 'playerDodge' | 'monsterDeath' | 'playerDeath' |
          'botHit' | 'botMonsterHit' |
          'floatingDmg' | 'skillAnim' | 'autoPotion' | 'victory' | 'levelUp' |
          'dotTick' |
          'darkRitualTick' |
          'summonSpawn';
    data?: Record<string, unknown>;
    timestamp: number;
}


export const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

const getClassConfig = (className: string): IClassData => classesData[className] ?? {};

const rollWeaponDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

const rollOffHandDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.offHand ?? equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

export const getEffectiveChar = (
    char: ReturnType<typeof useCharacterStore.getState>['character'],
    contentLevel = 0,
) => {
    if (!char) return null;
    const { equipment } = useInventoryStore.getState();
    const eq = getTotalEquipmentStats(equipment, ALL_ITEMS);
    const { skillLevels } = useSkillStore.getState();
    const tb = getTrainingBonuses(skillLevels, char.class);
    const baseAttack       = char.attack       ?? 0;
    const baseDefense      = char.defense      ?? 0;
    const baseMaxHp        = char.max_hp       ?? 0;
    const baseMaxMp        = char.max_mp       ?? 0;
    const baseAttackSpeedV = char.attack_speed ?? 0;
    const baseCritChance   = char.crit_chance  ?? 0;
    const baseAttackSpeed = baseAttackSpeedV + eq.speed * 0.01 + tb.attack_speed;
    const rawMaxHp = baseMaxHp + Math.floor(eq.hp * GEAR_HP_SCALE) + tb.max_hp + getElixirHpBonus() + getTransformFlatHp();
    const rawMaxMp = baseMaxMp + eq.mp + tb.max_mp + getElixirMpBonus() + getTransformFlatMp();
    const rawDefense = baseDefense + eq.defense + tb.defense + getShieldingDefBonus(skillLevels['shielding'] ?? 0) + getElixirDefBonus() + getTransformFlatDefense();
    const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), contentLevel);
    const rawAttack = (baseAttack + eq.attack + getElixirAtkBonus() + getTransformFlatAttack()) * gearGapMult;
    const attrMult = useAttributeStore.getState().getMultipliers(char.class);
    return {
        ...char,
        attack: Math.floor(rawAttack * getTransformAtkPctMultiplier() * attrMult.attack),
        defense: Math.floor(rawDefense * getTransformDefPctMultiplier() * attrMult.defense),
        max_hp: Math.floor(rawMaxHp * getElixirHpPctMultiplier() * getTransformHpPctMultiplier() * attrMult.hp),
        max_mp: Math.floor(rawMaxMp * getElixirMpPctMultiplier() * getTransformMpPctMultiplier()),
        attack_speed: baseAttackSpeed * getElixirAttackSpeedMultiplier(),
        crit_chance: Math.min(0.5, baseCritChance + eq.critChance * 0.01 + tb.crit_chance),
        hp_regen: (char.hp_regen ?? 0) + tb.hp_regen + getTransformHpRegenFlat(),
        mp_regen: (char.mp_regen ?? 0) + tb.mp_regen + getTransformMpRegenFlat(),
    };
};


export const dropLootToInventory = (monster: IMonster, monsterRarity: TMonsterRarity, heroicDropRate: number = 0): IDropDisplay[] => {
    const lootRolls = rollLoot(monster.level, monsterRarity, heroicDropRate);
    const { addItem, addGold } = useInventoryStore.getState();
    const s = useSettingsStore.getState();
    const drops: IDropDisplay[] = [];
    let autoSellGold = 0;

    const autoSellByRarity: Record<string, boolean> = {
        common: s.autoSellCommon, rare: s.autoSellRare, epic: s.autoSellEpic,
        legendary: s.autoSellLegendary, mythic: s.autoSellMythic,
    };
    const autoDisassembleByRarity: Record<string, boolean> = {
        common: s.autoDisassembleCommon, rare: s.autoDisassembleRare, epic: s.autoDisassembleEpic,
        legendary: s.autoDisassembleLegendary, mythic: s.autoDisassembleMythic,
    };

    for (const roll of lootRolls) {
        const inventoryItem = generateRandomItem(roll.itemLevel, roll.rarity);
        if (!inventoryItem) continue;

        const displayInfo = getItemDisplayInfo(inventoryItem.itemId);
        const displayName = displayInfo?.name_pl ?? formatItemName(roll.itemId);
        const icon = displayInfo?.icon ?? 'package';

        useQuestStore.getState().addProgress('drop_rarity', roll.rarity, 1);

        const shouldAutoSell = autoSellByRarity[roll.rarity] === true
            && (s.autoSellMaxLevel <= 0 || roll.itemLevel <= s.autoSellMaxLevel);
        const shouldAutoDisassemble = !shouldAutoSell
            && autoDisassembleByRarity[roll.rarity] === true
            && (s.autoDisassembleMaxLevel <= 0 || roll.itemLevel <= s.autoDisassembleMaxLevel);

        if (shouldAutoSell) {
            const sellPrice = getGeneratedSellPrice(roll.rarity, roll.itemLevel);
            autoSellGold += sellPrice;
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel, sold: true, soldPrice: sellPrice });
        } else if (shouldAutoDisassemble) {
            let stoneGained: string | undefined;
            if (Math.random() < DISASSEMBLE_STONE_CHANCE) {
                const stoneType = getRequiredStoneType(roll.rarity);
                useInventoryStore.getState().addStones(stoneType, 1);
                stoneGained = STONE_NAMES[stoneType] ?? stoneType;
            }
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel, disassembled: true, stoneGained });
        } else {
            addItem(inventoryItem);
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel });
        }
    }

    if (autoSellGold > 0) addGold(autoSellGold);

    const stone = rollStoneDrop(monster.level, monsterRarity);
    if (stone) {
        useInventoryStore.getState().addStones(stone.type, stone.count);
        const stoneRarity = stoneTypeToRarity(stone.type);
        const stoneLabel = STONE_NAMES_MAP[stone.type] ?? stone.type;
        drops.push({ icon: STONE_ICONS[stone.type] ?? 'gem-stone', name: `${stoneLabel} x${stone.count}`, rarity: stoneRarity });
    }

    const potionDrops = rollPotionDrop(monster.level);
    for (const pd of potionDrops) {
        useInventoryStore.getState().addConsumable(pd.potionId, pd.count);
        const potionInfo = ELIXIRS.find((e) => e.id === pd.potionId);
        const isHp = pd.potionId.includes('hp') || pd.potionId.includes('health');
        drops.push({ icon: isHp ? 'red-heart' : 'blue-heart', name: potionInfo?.name_pl ?? pd.potionId, rarity: 'common' });
    }

    const hasMaxMastery = useMasteryStore.getState().isMaxMastery(monster.id);
    const chestDrops = rollSpellChestDrop(monster.level, monsterRarity, false, false, hasMaxMastery);
    for (const cd of chestDrops) {
        useInventoryStore.getState().addSpellChest(cd.chestLevel, cd.count);
        drops.push({ icon: getSpellChestIcon(cd.chestLevel), name: getSpellChestDisplayName(cd.chestLevel), rarity: 'epic' });
    }

    return drops;
};

export const applyRarityToMonster = (baseMonster: IMonster, rarity: TMonsterRarity): IMonster => {
    if (rarity === 'normal') return baseMonster;
    const mult = MONSTER_RARITY_MULTIPLIERS[rarity];
    return {
        ...baseMonster,
        hp:      Math.floor(baseMonster.hp * mult.hp),
        attack:  Math.floor(baseMonster.attack * mult.atk),
        defense: Math.floor(baseMonster.defense * mult.def),
        xp:      Math.floor(baseMonster.xp * mult.xp),
        gold:    [
            Math.floor(baseMonster.gold[0] * mult.gold),
            Math.floor(baseMonster.gold[1] * mult.gold),
        ],
    };
};


const useAutoPotionSlot = (
    potionId: string,
    enabled: boolean,
    threshold: number,
    currentVal: number,
    maxVal: number,
    onCooldown: boolean,
    healFn: (amount: number, max: number) => void,
    addLogFn: (text: string, type: 'player' | 'monster' | 'crit' | 'system' | 'loot' | 'block' | 'dodge' | 'dualwield') => void,
    startCdFn: (cdMs: number) => void,
    hpOrMp: 'hp' | 'mp',
    slotKind: 'flat' | 'pct' = 'flat',
): void => {
    if (!enabled || threshold <= 0 || onCooldown) return;
    if (maxVal > 0 && currentVal >= maxVal) return;
    const missing = Math.max(0, maxVal - currentVal);
    const valPct = maxVal > 0 ? (currentVal / maxVal) * 100 : 100;
    if (valPct > threshold) return;
    const inv = useInventoryStore.getState();
    const autoLevel = useCharacterStore.getState().character?.level ?? 1;
    const elixir = resolveAutoPotionElixir(potionId, hpOrMp, slotKind, inv.consumables, autoLevel);
    if (!elixir) return;
    const flatMatch = elixir.effect.match(hpOrMp === 'hp' ? /^heal_hp_(\d+)$/ : /^heal_mp_(\d+)$/);
    const pctMatch = elixir.effect.match(hpOrMp === 'hp' ? /^heal_hp_pct_(\d+)$/ : /^heal_mp_pct_(\d+)$/);
    let healAmount = 0;
    if (flatMatch) healAmount = parseInt(flatMatch[1], 10);
    else if (pctMatch) healAmount = Math.floor(maxVal * parseInt(pctMatch[1], 10) / 100);
    if (healAmount <= 0) return;
    if (missing < healAmount) return;
    inv.useConsumable(elixir.id);
    useDailyQuestStore.getState().addProgress('use_potion', 1);
    const cd = getPotionCooldownMs(elixir.id);
    if (cd > 0) startCdFn(cd);
    healFn(healAmount, maxVal);
    const pctText = pctMatch ? ` (${parseInt(pctMatch[1], 10)}%)` : '';
    addLogFn(`[Auto-Potion] ${elixir.name_pl} +${healAmount} ${hpOrMp.toUpperCase()}${pctText}`, 'system');
};

export const tryAutoPotion = (
    currentHp: number, maxHp: number,
    currentMp: number, maxMp: number,
): void => {
    const settings = useSettingsStore.getState();
    const cs = useCombatStore.getState();
    const cd = useCooldownStore.getState();

    const healHp = cs.healPlayerHp;
    const healMp = cs.healPlayerMp;
    const addLogFn = cs.addLog;

    const startHpCd = (ms: number) => useCooldownStore.getState().setHpPotionCooldown(ms);
    const startMpCd = (ms: number) => useCooldownStore.getState().setMpPotionCooldown(ms);
    const startPctHpCd = (ms: number) => useCooldownStore.getState().setPctHpCooldown(ms);
    const startPctMpCd = (ms: number) => useCooldownStore.getState().setPctMpCooldown(ms);

    useAutoPotionSlot(settings.autoPotionHpId, settings.autoPotionHpEnabled, settings.autoPotionHpThreshold,
        currentHp, maxHp, cd.hpPotionCooldown > 0, healHp, addLogFn, startHpCd, 'hp', 'flat');

    useAutoPotionSlot(settings.autoPotionPctHpId, settings.autoPotionPctHpEnabled, settings.autoPotionPctHpThreshold,
        currentHp, maxHp, cd.pctHpCooldown > 0, healHp, addLogFn, startPctHpCd, 'hp', 'pct');

    useAutoPotionSlot(settings.autoPotionMpId, settings.autoPotionMpEnabled, settings.autoPotionMpThreshold,
        currentMp, maxMp, cd.mpPotionCooldown > 0, healMp, addLogFn, startMpCd, 'mp', 'flat');

    useAutoPotionSlot(settings.autoPotionPctMpId, settings.autoPotionPctMpEnabled, settings.autoPotionPctMpThreshold,
        currentMp, maxMp, cd.pctMpCooldown > 0, healMp, addLogFn, startPctMpCd, 'mp', 'pct');
};


export const handleMonsterDeath = (currentMonsterRarity: TMonsterRarity): void => {
    const s = useCombatStore.getState();
    if (!s.monster) return;
    {
        const partyState = usePartyStore.getState().party;
        const ch = useCharacterStore.getState().character;
        if (partyState && ch) {
            const otherHumans = partyState.members.filter((m) => m.id !== ch.id && !m.isBot);
            const isNonLeaderMember = otherHumans.length > 0 && partyState.leaderId !== ch.id;
            if (isNonLeaderMember) return;
        }
    }
    const masteryLevel = useMasteryStore.getState().getMasteryLevel(s.monster.id);
    const masteryXpMult = getMasteryXpMultiplier(masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);

    const partyState = usePartyStore.getState().party;
    const partySize = partyState ? Math.max(1, partyState.members.length) : 1;
    const partyDropMult = calculateDropMultiplier(partySize);
    const partyXpMult = calculateXpMultiplier(partySize);

    const baseGold = calculateGoldDrop(s.monster.gold);
    const gold = Math.floor(baseGold * masteryGoldMult);
    useInventoryStore.getState().addGold(gold);
    const heroicRate = useMasteryStore.getState().getMasteryBonuses(s.monster.id).heroic;
    const drops = dropLootToInventory(s.monster, currentMonsterRarity, heroicRate * partyDropMult);
    const safeIcon = (icon: string): string => {
        if (!icon) return '';
        if (icon.includes('/') || /\.(png|svg|jpe?g|webp)$/i.test(icon)) return '';
        return icon;
    };
    const dropNames = drops.map(d => {
        const i = safeIcon(d.icon);
        return i ? `${i} ${d.name}` : d.name;
    }).join(', ');
    const waveHasMultiple = s.waveMonsters.length > 1;
    s.addLog(
        `${s.monster.name_pl} ginie! +${s.monster.xp} XP, +${gold} Gold${drops.length ? ` · Drop: ${dropNames}` : ''}`,
        'loot',
    );
    const bStore = useBuffStore.getState();
    const xpBoostMult = bStore.getXpBoostMultiplier();
    const baseXp = Math.floor(s.monster.xp * KILL_XP_TTK_MULT * masteryXpMult * partyXpMult);
    if (masteryLevel > 0) {
        const pct = Math.round((masteryXpMult - 1) * 100);
        s.addLog(`:fire: Mastery Lvl ${masteryLevel}: +${pct}% XP & Gold`, 'system');
    }
    tickCombatElixirs(2000);
    const preChar = useCharacterStore.getState().character;
    const preMaxHp = preChar?.max_hp ?? 0;
    const xpResult = useCharacterStore.getState().addXp(baseXp);
    const finalXp = xpResult.xpApplied;
    s.addReward(finalXp, gold);
    if (xpResult.levelsGained > 0) {
        s.addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
    }
    if (xpBoostMult > 1) {
        const boostParts: string[] = [];
        if (bStore.hasBuff('xp_boost_100')) boostParts.push('XP +100%');
        else if (bStore.hasBuff('xp_boost')) boostParts.push('XP +50%');
        if (bStore.hasBuff('premium_xp_boost')) boostParts.push('Premium x2');
        s.addLog(`:star: ${boostParts.join(' + ')} aktywny! ${baseXp} × ${xpBoostMult} = ${finalXp} XP`, 'system');
    }
    const postChar = useCharacterStore.getState().character;
    if (xpResult.levelsGained > 0) {
        const fullHp = postChar?.hp ?? 0;
        const fullMp = postChar?.mp ?? 0;
        useCombatStore.getState().setHps(
            useCombatStore.getState().monsterCurrentHp,
            fullHp,
        );
        useCombatStore.setState({ playerCurrentMp: fullMp });
    } else {
        const live = useCombatStore.getState();
        const hpLevelGain = Math.max(0, (postChar?.max_hp ?? 0) - preMaxHp);
        const effForSync = getEffectiveChar(postChar);
        const syncMaxHp = effForSync?.max_hp ?? (postChar?.max_hp ?? 9999);
        const syncMaxMp = effForSync?.max_mp ?? (postChar?.max_mp ?? 9999);
        useCharacterStore.getState().updateCharacter({
            hp: Math.min(syncMaxHp, Math.max(0, live.playerCurrentHp + hpLevelGain)),
            mp: Math.min(syncMaxMp, Math.max(0, live.playerCurrentMp)),
        });
    }
    void saveCurrentCharacterStores();
    const taskKills = MONSTER_RARITY_TASK_KILLS[currentMonsterRarity] ?? 1;
    useTaskStore.getState().addKill(s.monster.id, s.monster.level, taskKills);
    useQuestStore.getState().addProgress('kill', s.monster.id, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', currentMonsterRarity, 1, s.monster.level);
    useDailyQuestStore.getState().addProgress('kill_any', 1);
    useDailyQuestStore.getState().addProgress('earn_gold', gold);
    useMasteryStore.getState().addMasteryKills(s.monster.id, taskKills);
    useCombatStore.getState().addSessionStats(finalXp, gold);
    useCombatStore.getState().incrementSessionKill(currentMonsterRarity);

    void broadcastMonsterKillIfInParty(s.monster, currentMonsterRarity, baseXp);

    if (waveHasMultiple) {
        useCombatStore.getState().appendDrops(drops);
        useCombatStore.getState().markActiveWaveMonsterDead();
        const advanced = useCombatStore.getState().advanceToNextWaveTarget();
        if (advanced) {
            const next = useCombatStore.getState().monster;
            if (next) {
                useCombatStore.getState().addLog(
                    `:bullseye: Cel: ${next.name_pl} (${useCombatStore.getState().waveMonsters.filter(w => !w.isDead).length} żywych)`,
                    'system',
                );
            }
            return;
        }
        useCombatStore.getState().addLog(`:crossed-swords: Fala pokonana! (${s.waveMonsters.length} potworów)`, 'system');
        s.setPhase('victory');
        return;
    }

    useCombatStore.getState().setLastDrops(drops);
    s.setPhase('victory');
};

const broadcastMonsterKillIfInParty = (monster: IMonster, rarity: TMonsterRarity, finalXp: number): void => {
    try {
        const partyState = usePartyStore.getState().party;
        const ch = useCharacterStore.getState().character;
        if (!partyState || !ch) return;
        const otherHumans = partyState.members.filter((m) => !m.isBot && m.id !== ch.id);
        if (otherHumans.length === 0) return;
        if (partyState.leaderId !== ch.id) return;
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishMonsterKilled({
                monsterId:    monster.id,
                monsterLevel: monster.level,
                monsterRarity: rarity,
                finalXp,
            });
        }).catch(() => { });
    } catch { }
};

export const applyMonsterKillRewardsForMember = (
    monsterId: string,
    monsterLevel: number,
    rarity: TMonsterRarity,
    finalXpFromLeader: number,
): void => {
    const monster = (monstersRaw as unknown as IMonster[]).find((m) => m.id === monsterId);
    if (!monster) return;
    const s = useCombatStore.getState();
    const masteryLevel = useMasteryStore.getState().getMasteryLevel(monsterId);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);
    const partyState = usePartyStore.getState().party;
    const partySize = partyState ? Math.max(1, partyState.members.length) : 1;
    const partyDropMult = calculateDropMultiplier(partySize);

    const baseGold = calculateGoldDrop(monster.gold);
    const gold = Math.floor(baseGold * masteryGoldMult);
    useInventoryStore.getState().addGold(gold);

    const heroicRate = useMasteryStore.getState().getMasteryBonuses(monsterId).heroic;
    const drops = dropLootToInventory(monster, rarity, heroicRate * partyDropMult);
    const safeIcon = (icon: string): string => {
        if (!icon) return '';
        if (icon.includes('/') || /\.(png|svg|jpe?g|webp)$/i.test(icon)) return '';
        return icon;
    };
    const dropNames = drops.map((d) => {
        const i = safeIcon(d.icon);
        return i ? `${i} ${d.name}` : d.name;
    }).join(', ');
    const xpResult = useCharacterStore.getState().addXp(finalXpFromLeader);
    const appliedXp = xpResult.xpApplied;
    s.addLog(
        `${monster.name_pl} ginie! +${appliedXp} XP, +${gold} Gold${drops.length ? ` · Drop: ${dropNames}` : ''}`,
        'loot',
    );

    s.addReward(appliedXp, gold);
    if (xpResult.levelsGained > 0) {
        s.addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk)`, 'system');
    }

    const taskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
    useTaskStore.getState().addKill(monsterId, monsterLevel, taskKills);
    useQuestStore.getState().addProgress('kill', monsterId, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', rarity, 1, monsterLevel);
    useDailyQuestStore.getState().addProgress('kill_any', 1);
    useDailyQuestStore.getState().addProgress('earn_gold', gold);
    useMasteryStore.getState().addMasteryKills(monsterId, taskKills);

    useCombatStore.getState().addSessionStats(appliedXp, gold);
    useCombatStore.getState().incrementSessionKill(rarity);

    useCombatStore.getState().appendDrops(drops);

    void saveCurrentCharacterStores();
};

const PARTY_EXIT_GRACE_MS = 15_000;
let _partyExitGraceUntil = 0;

const markPartyExitGrace = (): void => {
    _partyExitGraceUntil = Date.now() + PARTY_EXIT_GRACE_MS;
};


export const handlePlayerDeath = (forceConfirm: boolean = false): void => {
    const s = useCombatStore.getState();
    const char = useCharacterStore.getState().character;
    if (!char) return;
    if (Date.now() < _partyExitGraceUntil) {
        if ((char.hp ?? 0) <= 0) {
            useCharacterStore.getState().fullHealEffective();
        }
        return;
    }
    {
        const partyState = usePartyStore.getState().party;
        if (partyState && char.id) {
            const otherHumans = partyState.members.filter((m) => m.id !== char.id && !m.isBot);
            const isNonLeaderMember = otherHumans.length > 0 && partyState.leaderId !== char.id;
            if (isNonLeaderMember) {
                if ((char.hp ?? 0) <= 0) {
                    useCharacterStore.getState().fullHealEffective();
                }
                return;
            }
            const isLeaderInMultiHumanParty = otherHumans.length > 0 && partyState.leaderId === char.id;
            if (isLeaderInMultiHumanParty && !forceConfirm) {
                return;
            }
        }
    }

    const monsterName = s.monster
        ? (s.monsterRarity && s.monsterRarity !== 'normal'
            ? `${s.monster.name_pl} [${s.monsterRarity}]`
            : s.monster.name_pl)
        : 'Nieznany';
    const monsterLevel = s.monster?.level ?? 0;

    if (s.monster) {
        if (isBackendMode() && char) {
            void backendApi.logDeath(char.id, {
                source: 'monster',
                source_name: monsterName,
                source_level: monsterLevel,
                result: 'killed',
            });
        } else {
            void deathsApi.logDeath({
                character_id: char.id,
                character_name: char.name,
                character_class: char.class,
                character_level: char.level,
                source: 'monster',
                source_name: monsterName,
                source_level: monsterLevel,
            });
        }
    }

    const prot = consumeDeathProtection();

    useCharacterStore.getState().fullHealEffective();

    const oldLevel = char.level;
    let newLevel = char.level;
    let levelsLost = 0;
    let xpPercent = 100;

    if (prot.isProtected) {
        const label = prot.consumedId === 'death_protection' ? 'Eliksir Ochrony' : 'Amulet of Loss';
        s.addLog(`:shield: ${label} uchronił Cię od wszystkich strat (poziom, XP, przedmioty)!`, 'system');
    } else {
        const penalty = applyDeathPenalty(char.level, char.xp);
        newLevel = penalty.newLevel;
        levelsLost = penalty.levelsLost;
        xpPercent = penalty.xpPercent;
        const currentHighest = char.highest_level ?? char.level;
        const preservedHighest = Math.max(currentHighest, char.level);
        useCharacterStore.getState().updateCharacter({
            xp: penalty.newXp,
            level: penalty.newLevel,
            highest_level: preservedHighest,
        });
        useCharacterStore.getState().fullHealEffective();
        useSkillStore.getState().applyDeathPenalty(char.class, penalty.skillXpLossPercent);
        useSkillStore.getState().purgeLockedSkillSlots(char.class, penalty.newLevel);
        const skillPctTxt = `-${penalty.skillXpLossPercent}% Skill XP`;
        if (penalty.levelsLost > 0) {
            s.addLog(`Giniesz… Tracisz ${penalty.levelsLost} poziom${penalty.levelsLost === 1 ? '' : 'y'}! ${char.level} -> ${penalty.newLevel} · ${skillPctTxt}`, 'system');
        } else {
            s.addLog(`Giniesz… ${skillPctTxt}`, 'system');
        }
        const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
        if (itemsLost > 0) {
            s.addLog(`:skull: Straciłeś ${itemsLost} przedmiot(ów) przy śmierci!`, 'system');
        }
    }

    void saveCurrentCharacterStoresForce();

    s.resetCombat();
    useBotStore.getState().clearBots();
    clearHuntNecroSummons();
    resetAggro();

    useDeathStore.getState().triggerDeath({
        killedBy: monsterName,
        sourceLevel: monsterLevel,
        oldLevel,
        newLevel,
        levelsLost,
        xpPercent,
        protectionUsed: prot.isProtected,
        source: 'monster',
    });
};


export const doPlayerAttackTick = (autoSkillOnly = false): void => {
    const s = useCombatStore.getState();
    const char = getEffectiveChar(useCharacterStore.getState().character, s.monster?.level ?? 0);
    const skillSettings = useSettingsStore.getState();
    if (s.phase !== 'fighting' || !s.monster || !char) return;
    if (isHuntPlayerStunned()) return;
    if (s.playerCurrentHp <= 0) return;

    const liveCharRaw = useCharacterStore.getState().character;
    const partyState = usePartyStore.getState().party;
    const otherHumans = partyState?.members.filter((m) => m.id !== liveCharRaw?.id && !m.isBot) ?? [];
    const isNonLeaderMember = !!(
        partyState && liveCharRaw &&
        otherHumans.length > 0 &&
        partyState.leaderId !== liveCharRaw.id
    );

    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const classBonus = getClassSkillBonus(char.class, skillLevels);
    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;
    const isDualWield = !!classConfig.dualWield;

    const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
        const freshS = useCombatStore.getState();
        if (freshS.phase !== 'fighting' || !freshS.monster) return 0;
        const wRoll = Math.floor(weaponRollFn() * dmgPercent);
        const playerStatus = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
        const mods = consumeCasterBasicHitMods(playerStatus);
        syncCasterChargeConsume(mods.consumed);
        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: freshS.monster.defense,
            attackerLevel: char.level, playerSource: true,
            critChance: (char.crit_chance ?? 0.05) + classBonus.extraCritChance + mods.extraCritChance,
            maxCritChance: maxCrit,
            isCrit: mods.forceCrit ? true : undefined,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier() * mods.dmgMult,
        });
        const targetSt = ensureStatus(huntEffects, huntMonsterFxId(freshS.activeTargetIdx, freshS.monster.id));
        const amp = consumeTargetMarkAmp(targetSt);
        if (amp.mult !== 1) {
            r.finalDamage = Math.max(1, Math.floor(r.finalDamage * amp.mult));
        }
        freshS.dealToMonster(r.finalDamage);
        const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
        let text = `${handPrefix}Atakujesz ${freshS.monster.name_pl} za ${r.finalDamage} dmg`;
        if (r.isCrit) text += ' :high-voltage:KRYTYK!';
        freshS.addLog(text, hand ? (r.isCrit ? 'crit' : 'dualwield') : (r.isCrit ? 'crit' : 'player'));
        useCombatStore.getState().emitCombatEvent({
            type: 'monsterHit',
            data: {
                damage: r.finalDamage,
                isCrit: r.isCrit,
                hand: hand ?? null,
                targetIdx: freshS.activeTargetIdx,
            },
            timestamp: Date.now(),
        });
        {
            const liveCh = useCharacterStore.getState().character;
            const ps = usePartyStore.getState().party;
            const otherH = ps?.members.filter((m) => m.id !== liveCh?.id && !m.isBot) ?? [];
            const isLeaderInParty = !!(
                ps && liveCh && otherH.length > 0 && ps.leaderId === liveCh.id
            );
            if (isLeaderInParty) {
                import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishDamageEvent({
                        attackerId:   liveCh!.id,
                        attackerName: liveCh!.name,
                        damage:       r.finalDamage,
                        isCrit:       r.isCrit,
                        targetIdx:    freshS.activeTargetIdx,
                        hand:         hand ?? null,
                    });
                }).catch(() => { });
            }
        }
        return r.finalDamage;
    };

    let totalDamage = 0;
    if (!autoSkillOnly && isNonLeaderMember && liveCharRaw) {
        const wRoll = Math.floor(rollWeaponDamage() * 1.0);
        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: s.monster.defense,
            attackerLevel: char.level, playerSource: true,
            critChance: (char.crit_chance ?? 0.05) + classBonus.extraCritChance,
            maxCritChance: maxCrit,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
        });
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishAttackAction({
                attackerId:   liveCharRaw.id,
                attackerName: liveCharRaw.name,
                damage:       r.finalDamage,
                isCrit:       r.isCrit,
                targetIdx:    s.activeTargetIdx,
                hand:         null,
            });
        }).catch(() => { });
        totalDamage += r.finalDamage;
    } else if (!autoSkillOnly && isDualWield) {
        totalDamage += doSingleHit('left', rollWeaponDamage, 0.6);
        setTimeout(() => {
            const dmg2 = doSingleHit('right', rollOffHandDamage, 0.6);
            if (dmg2 > 0) useDailyQuestStore.getState().addProgress('deal_damage', dmg2);
            const s2 = useCombatStore.getState();
            if (s2.monsterCurrentHp <= 0 && s2.phase === 'fighting') {
                handleMonsterDeath(s2.monsterRarity);
            }
        }, 150);
    } else if (!autoSkillOnly) {
        totalDamage += doSingleHit(undefined, rollWeaponDamage, 1.0);
    }
    const psAs = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
    if (!autoSkillOnly && psAs.asMultMs > 0 && psAs.asMult > 1) {
        const bonus = psAs.asMult - 1;
        const guaranteed = Math.floor(bonus);
        const fractional = bonus - guaranteed;
        const extra = guaranteed + (Math.random() < fractional ? 1 : 0);
        for (let i = 0; i < extra; i++) {
            setTimeout(() => {
                const ss = useCombatStore.getState();
                if (ss.phase !== 'fighting' || !ss.monster) return;
                doSingleHit(undefined, rollWeaponDamage, 1.0);
                const after = useCombatStore.getState();
                if (after.monsterCurrentHp <= 0 && after.phase === 'fighting') {
                    handleMonsterDeath(after.monsterRarity);
                }
            }, 80 * (i + 1));
        }
    }

    if (!autoSkillOnly && char.class === 'Necromancer') {
        const liveSummons = useNecroSummonStore.getState().summons[HUNT_PLAYER_FX_ID] ?? [];
        if (liveSummons.length > 0) {
            const SUMMON_TYPE_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
            const sorted = [...liveSummons].sort((a, b) => SUMMON_TYPE_RANK[a.type] - SUMMON_TYPE_RANK[b.type]);
            sorted.forEach((sm, idx) => {
                window.setTimeout(() => {
                    const freshS = useCombatStore.getState();
                    if (freshS.phase !== 'fighting' || !freshS.monster) return;
                    const targetIdx = freshS.activeTargetIdx;
                    const wm = freshS.waveMonsters[targetIdx];
                    if (!wm || wm.isDead) return;
                    let dmg = mitigateDamage(Math.floor(char.attack * sm.dmgMult), Math.floor(freshS.monster.defense * 0.5), char.level, true);
                    const ampSum = consumeHuntMonsterMarkAmp(targetIdx, freshS.monster.id);
                    if (ampSum.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampSum.mult));
                    }
                    useCombatStore.getState().damageWaveMonster(targetIdx, dmg);
                    freshS.addLog(`:skull: ${sm.type}: ${dmg} dmg`, 'player');
                    useCombatStore.getState().emitCombatEvent({
                        type: 'monsterHit',
                        data: {
                            damage: dmg, isCrit: false,
                            hand: null, targetIdx,
                            isSummon: true,
                            summonType: sm.type,
                        },
                        timestamp: Date.now(),
                    });
                }, 80 + idx * 100);
            });
            const totalSummon = sorted.reduce((s, sm) => s + Math.max(1, Math.floor(char.attack * sm.dmgMult)), 0);
            totalDamage += totalSummon;
        }
    }

    if (!autoSkillOnly) {
        useSkillStore.getState().addMlvlXpFromAttack(char.class as CharacterClass);
        useSkillStore.getState().addWeaponSkillXpFromAttack(char.class as CharacterClass);
    }

    if (skillSettings.skillMode === 'auto') {
        const slots = useSkillStore.getState().activeSkillSlots;
        const now = Date.now();
        const speedMult = SPEED_MULT[skillSettings.combatSpeed] ?? 1;
        for (const skillId of slots) {
            if (!skillId) continue;
            const lastUsed = skillCooldownMap.get(skillId) ?? 0;
            if ((now - lastUsed) * speedMult < SKILL_COOLDOWN_MS) continue;
            const autoMpCost = getSkillMpCost(skillId);
            if (s.playerCurrentMp < autoMpCost) continue;
            const sDef = getSkillDef(skillId);
            const skillMult = sDef?.damage ?? 0;
            const isDamageHit = skillMult > 0;
            const targetsEnemy = isDamageHit || skillTargetsEnemy(sDef?.effect ?? null);
            const effApply = huntApplySkillEffectV2(skillId, s.activeTargetIdx);
            if (effApply === null) continue;
            const autoDefPenFrac = Math.max(0, Math.min(1, (effApply?.defPenPct ?? 0) / 100));
            const autoEffectiveDef = Math.max(0, Math.floor(s.monster.defense * (1 - autoDefPenFrac)));
            const skillUpgradeLevel = useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0;
            const sr = calculateDamage({
                baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                skillBonus: classBonus.skillBonus,
                classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                enemyDefense: autoEffectiveDef,
                attackerLevel: char.level, playerSource: true,
                critChance: 0.20,
                maxCritChance: maxCrit,
                damageMultiplier: isDamageHit
                    ? getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * rollSkillDamageMult(skillMult, skillUpgradeLevel)
                    : 0,
            });
            const aoeTargetIdxs: number[] = [];
            let totalDmgDealtThisCast = 0;
            let primaryExecuteBurstDmg = 0;
            if (isDamageHit) {
                if (effApply?.instantKill) {
                    const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                    if (wm) {
                        useCombatStore.getState().damageWaveMonster(s.activeTargetIdx, wm.currentHp);
                        totalDmgDealtThisCast += wm.currentHp;
                    }
                } else {
                    let primaryDmg = sr.finalDamage;
                    if ((effApply?.executeBurstPct ?? 0) > 0) {
                        const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                        const burst = Math.floor((wm?.maxHp ?? 0) * (effApply!.executeBurstPct) / 100);
                        primaryDmg = Math.max(primaryDmg, burst);
                        primaryExecuteBurstDmg = primaryDmg;
                    }
                    const ampPrimary = consumeHuntMonsterMarkAmp(s.activeTargetIdx, s.monster.id);
                    if (ampPrimary.mult !== 1) {
                        primaryDmg = Math.max(1, Math.floor(primaryDmg * ampPrimary.mult));
                    }
                    s.dealToMonster(primaryDmg);
                    totalDmgDealtThisCast += primaryDmg;
                    if (effApply?.aoe) {
                        const splashDmg = Math.max(1, Math.floor(primaryDmg * 0.75));
                        const splashIkPct = effApply?.instantKillPct ?? 0;
                        const wave = useCombatStore.getState().waveMonsters;
                        for (let ii = 0; ii < wave.length; ii++) {
                            if (ii === s.activeTargetIdx) continue;
                            if (wave[ii].isDead) continue;
                            const splashIk = splashIkPct > 0 && Math.random() * 100 < splashIkPct;
                            if (splashIk) {
                                const ikDmg = Math.max(splashDmg, Math.floor(wave[ii].maxHp * 12 / 100));
                                useCombatStore.getState().damageWaveMonster(ii, ikDmg);
                                totalDmgDealtThisCast += ikDmg;
                            } else {
                                let thisSplash = splashDmg;
                                const ampSplash = consumeHuntMonsterMarkAmp(ii, wave[ii].monster.id);
                                if (ampSplash.mult !== 1) {
                                    thisSplash = Math.max(1, Math.floor(thisSplash * ampSplash.mult));
                                }
                                useCombatStore.getState().damageWaveMonster(ii, thisSplash);
                                totalDmgDealtThisCast += thisSplash;
                            }
                            aoeTargetIdxs.push(ii);
                        }
                    }
                }
                if (effApply && effApply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                    const heal = Math.floor(totalDmgDealtThisCast * (effApply.healCasterPctOfDmg / 100));
                    const beforeHp = useCombatStore.getState().playerCurrentHp;
                    useCombatStore.getState().healPlayerHp(heal, char.max_hp);
                    const afterHp = useCombatStore.getState().playerCurrentHp;
                    const actual = afterHp - beforeHp;
                    useCombatStore.getState().emitCombatEvent({
                        type: 'playerHit',
                        data: {
                            damage: 0, isCrit: false, isBlocked: false,
                            hpDamage: 0, mpDamage: 0,
                            isSpellHeal: true,
                            spellHealAmount: actual,
                            spellHealRequested: heal,
                        },
                        timestamp: Date.now(),
                    });
                }
            }
            if (effApply && effApply.healLowestAllyPct > 0) {
                const aliveBots = useBotStore.getState().bots.filter((b) => b.alive);
                const playerHp = useCombatStore.getState().playerCurrentHp;
                let lowestKind: 'player' | 'bot' = 'player';
                let lowestRatio = playerHp / Math.max(1, char.max_hp);
                let lowestBotIdx = -1;
                for (let i = 0; i < aliveBots.length; i++) {
                    const ratio = aliveBots[i].hp / Math.max(1, aliveBots[i].maxHp);
                    if (ratio < lowestRatio) {
                        lowestKind = 'bot';
                        lowestRatio = ratio;
                        lowestBotIdx = i;
                    }
                }
                if (lowestKind === 'player') {
                    const heal = Math.floor(char.max_hp * (effApply.healLowestAllyPct / 100));
                    const before = useCombatStore.getState().playerCurrentHp;
                    useCombatStore.getState().healPlayerHp(heal, char.max_hp);
                    const after = useCombatStore.getState().playerCurrentHp;
                    const actual = after - before;
                    if (heal > 0) {
                        useCombatStore.getState().emitCombatEvent({
                            type: 'playerHit',
                            data: {
                                damage: 0, isCrit: false, isBlocked: false,
                                hpDamage: 0, mpDamage: 0,
                                isSpellHeal: true,
                                spellHealAmount: actual,
                                spellHealRequested: heal,
                            },
                            timestamp: Date.now(),
                        });
                    }
                } else if (lowestBotIdx >= 0) {
                    const bot = aliveBots[lowestBotIdx];
                    const heal = Math.floor(bot.maxHp * (effApply.healLowestAllyPct / 100));
                    const newHp = Math.min(bot.maxHp, bot.hp + heal);
                    useBotStore.getState().updateBotHp(bot.id, newHp);
                }
            }
            if (effApply && effApply.reviveDeadAllies) {
                const allBots = useBotStore.getState().bots;
                const revivedNames: string[] = [];
                for (const bot of allBots) {
                    if (!bot.alive) {
                        const reviveHp = Math.max(1, Math.floor(bot.maxHp * 0.5));
                        useBotStore.getState().updateBotHp(bot.id, reviveHp);
                        ensureStatus(huntEffects, bot.id).immortalMs = REVIVE_PROTECT_MS;
                        revivedNames.push(bot.name);
                    }
                }
                const humanMemberIds = usePartyStore.getState().party?.members
                    .filter((m) => !m.isBot && m.id !== char.id)
                    .map((m) => m.id) ?? [];
                if (humanMemberIds.length > 0) {
                    import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        for (const memberId of humanMemberIds) {
                            usePartyCombatSyncStore.getState().publishMemberRevive({
                                memberId,
                                hpPct: 0.5,
                                protectMs: REVIVE_PROTECT_MS,
                            });
                        }
                    }).catch(() => { });
                }
                if (revivedNames.length > 0) {
                    s.addLog(`:sparkles: ${skillId}: wskrzeszono ${revivedNames.join(', ')} (ochrona ${Math.round(REVIVE_PROTECT_MS / 1000)}s)`, 'system');
                }
            }
            if ((effApply?.multistrike ?? 0) > 0) {
                const extra = Math.max(0, Math.floor(effApply!.multistrike));
                const baseDmgPercent = 1.0;
                for (let n = 0; n < extra; n++) {
                    setTimeout(() => {
                        const fresh = useCombatStore.getState();
                        if (fresh.phase !== 'fighting' || !fresh.monster) return;
                        const wm = fresh.waveMonsters[fresh.activeTargetIdx];
                        if (!wm || wm.isDead) return;
                        const wRoll = Math.floor(rollWeaponDamage() * baseDmgPercent);
                        const followup = calculateDamage({
                            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
                            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                            enemyDefense: autoEffectiveDef,
                            attackerLevel: char.level, playerSource: true,
                            critChance: (char.crit_chance ?? 0.05),
                            maxCritChance: maxCrit,
                            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                        });
                        useCombatStore.getState().damageWaveMonster(fresh.activeTargetIdx, followup.finalDamage);
                        useCombatStore.getState().emitCombatEvent({
                            type: 'monsterHit',
                            data: { damage: followup.finalDamage, isCrit: followup.isCrit, isBlocked: false, hand: null, targetIdx: fresh.activeTargetIdx },
                            timestamp: Date.now(),
                        });
                        fresh.addLog(`:bow-and-arrow:×${n + 2} ${followup.finalDamage} dmg${followup.isCrit ? 'high-voltage' : ''}`, followup.isCrit ? 'crit' : 'player');
                    }, 120 * (n + 1));
                }
            }
            s.spendPlayerMp(autoMpCost);
            skillCooldownMap.set(skillId, now);
            useCooldownStore.getState().setSkillCooldown(skillId, SKILL_COOLDOWN_MS);
            if (sDef) applySkillBuff(skillId, sDef, speedMult);
            totalDamage += isDamageHit ? sr.finalDamage : 0;
            useSkillStore.getState().addMlvlXpFromSkill(char.class as CharacterClass);
            const stunLabel = effApply?.paralyzeApplied
                ? 'PARAL'
                : effApply?.stunApplied
                    ? 'STUN'
                    : null;
            s.addLog(
                isDamageHit
                    ? `[AUTO] ${skillId}: ${sr.finalDamage} dmg${sr.isCrit ? ' :high-voltage:KRYTYK!' : ''} (-${autoMpCost} MP)`
                    : `[AUTO] ${skillId}: ${targetsEnemy ? 'DEBUFF' : 'BUFF'} (-${autoMpCost} MP)`,
                sr.isCrit ? 'crit' : 'player',
            );
            useCombatStore.getState().emitCombatEvent({
                type: 'skillAnim',
                data: {
                    skillId,
                    damage: isDamageHit ? sr.finalDamage : 0,
                    splashDamage: isDamageHit ? Math.max(1, Math.floor(sr.finalDamage * 0.75)) : 0,
                    isCrit: sr.isCrit,
                    targetIdx: useCombatStore.getState().activeTargetIdx,
                    aoeTargets: aoeTargetIdxs,
                    targetsEnemy,
                    stunLabel,
                    instantKill: !!effApply?.instantKill,
                    executeBurstDmg: primaryExecuteBurstDmg,
                },
                timestamp: Date.now(),
            });
            break;
        }
    }

    const freshAfterAtk = useCombatStore.getState();
    tryAutoPotion(
        freshAfterAtk.playerCurrentHp, char.max_hp,
        freshAfterAtk.playerCurrentMp, char.max_mp,
    );

    if (totalDamage > 0) useDailyQuestStore.getState().addProgress('deal_damage', totalDamage);

    if (!isDualWield) {
        const freshS = useCombatStore.getState();
        if (freshS.monsterCurrentHp <= 0 && freshS.phase === 'fighting') {
            handleMonsterDeath(freshS.monsterRarity);
        }
    } else {
        const freshS = useCombatStore.getState();
        if (freshS.monsterCurrentHp <= 0 && freshS.phase === 'fighting') {
            handleMonsterDeath(freshS.monsterRarity);
        }
    }
};


const doSingleWaveMonsterAttack = (waveIdx: number): boolean => {
    const s = useCombatStore.getState();
    const wm = s.waveMonsters[waveIdx];
    if (!wm || wm.isDead) return false;
    const monster = wm.monster;
    const char = getEffectiveChar(useCharacterStore.getState().character);
    if (!char) return false;

    const partyStateForAggro = usePartyStore.getState().party;
    const hasBots = useBotStore.getState().bots.some((b) => b.alive);
    const iAmLeader = !!(
        partyStateForAggro && char.id &&
        partyStateForAggro.leaderId === char.id &&
        partyStateForAggro.members.some((m) => !m.isBot && m.id !== char.id)
    );
    const widenPool = hasBots || iAmLeader;
    const targetId = widenPool ? maybeSwitchWaveAggro(waveIdx) : 'player';
    useCombatStore.getState().setWaveMonsterAggro(waveIdx, targetId);

    if (typeof targetId === 'string' && targetId.startsWith('human_')) {
        const memberId = targetId.slice('human_'.length);
        const rolledAtkM = rollMonsterDamage(monster);
        const approxMemberDef = Math.floor(char.defense * 0.75);
        const dmgM = mitigateDamage(rolledAtkM, approxMemberDef, monster.level);
        useCombatStore.getState().addLog(
            `${monster.name_pl} atakuje sojusznika za ${dmgM} dmg`,
            'monster',
        );
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishMemberHit({
                memberId,
                damage: dmgM,
                sourceMonsterIdx: waveIdx,
            });
        }).catch(() => { });
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.setState({
                lastMemberHit: {
                    memberId,
                    damage: dmgM,
                    sourceMonsterIdx: waveIdx,
                    sentAt: Date.now(),
                },
            });
        }).catch(() => { });
        return false;
    }

    if (targetId !== 'player') {
        const bot = useBotStore.getState().bots.find((b) => b.id === targetId);
        if (!bot || !bot.alive) {
            waveAggroState.delete(waveIdx);
            return false;
        }
        const botStatus = huntEffects.statuses.get(bot.id);
        if (botStatus && botStatus.immortalMs > 0) {
            return false;
        }
        const botDefMult = (botStatus && botStatus.defBuffMs > 0 && botStatus.defBuffPct > 0)
            ? 1 + (botStatus.defBuffPct / 100) : 1;
        const effBotDef = Math.floor(bot.defense * botDefMult);
        const rolledAtkBot = rollMonsterDamage(monster);
        const dmg = mitigateDamage(rolledAtkBot, effBotDef, monster.level);
        const newHp = Math.max(0, bot.hp - dmg);
        useBotStore.getState().updateBotHp(bot.id, newHp);

        useCombatStore.getState().emitCombatEvent({
            type: 'botHit',
            data: { botId: bot.id, damage: dmg, attackerWaveIdx: waveIdx },
            timestamp: Date.now(),
        });

        const botIcon = `:robot::${BOT_CLASS_ICONS_LOCAL[bot.class] ?? 'robot'}:`;
        s.addLog(`${monster.name_pl} atakuje ${botIcon} ${bot.name} za ${dmg} dmg`, 'monster');

        if (newHp <= 0) {
            s.addLog(`:skull: ${botIcon} ${bot.name} ginie w walce!`, 'system');
            waveAggroState.delete(waveIdx);
        }
        return false;
    }

    if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
        useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
        s.addLog(`${monster.name_pl} atakuje – Krok Cienia! Unik!`, 'dodge');
        useCombatStore.getState().emitCombatEvent({ type: 'playerDodge', timestamp: Date.now() });
        return false;
    }
    if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
        useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
        s.addLog(`:shield: Boska Tarcza! Blok ${monster.name_pl}!`, 'system');
        useCombatStore.getState().emitCombatEvent({
            type: 'playerHit',
            data: { damage: 0, isCrit: false, hpDamage: 0, mpDamage: 0, isImmortal: true },
            timestamp: Date.now(),
        });
        return false;
    }
    const huntPlayerStatus = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
    if (huntPlayerStatus.dodgeBuffMs > 0 && huntPlayerStatus.dodgeBuffPct > 0) {
        if (Math.random() * 100 < huntPlayerStatus.dodgeBuffPct) {
            s.addLog(`:dashing-away: Bomba Dymna! Unikasz ataku ${monster.name_pl} (${huntPlayerStatus.dodgeBuffPct}%)`, 'dodge');
            useCombatStore.getState().emitCombatEvent({ type: 'playerDodge', timestamp: Date.now() });
            return false;
        }
    }
    const playerStatusForDef = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
    const defBuffMult = (playerStatusForDef.defBuffMs > 0 && playerStatusForDef.defBuffPct > 0)
        ? 1 + (playerStatusForDef.defBuffPct / 100) : 1;
    const effectivePlayerDef = Math.floor(char.defense * defBuffMult);

    const rolledAtk = rollMonsterDamage(monster);
    const r = calculateDamage({
        baseAtk: rolledAtk, weaponAtk: 0, skillBonus: 0,
        classModifier: 1.0,
        enemyDefense: effectivePlayerDef,
        attackerLevel: monster.level,
    });

    if (playerStatusForDef.immortalMs > 0) {
        s.addLog(`${monster.name_pl} atakuje – BLOCK! Niewrażliwość!`, 'block');
        useCombatStore.getState().emitCombatEvent({
            type: 'playerHit',
            data: { damage: 0, isCrit: false, hpDamage: 0, mpDamage: 0, isImmortal: true },
            timestamp: Date.now(),
        });
        return false;
    }

    let hpDamage = r.finalDamage;
    let mpDamage = 0;
    const manaShieldSplit = applyManaShieldRedirect(playerStatusForDef, s.playerCurrentMp, r.finalDamage);
    if (manaShieldSplit.shieldActive) {
        mpDamage += manaShieldSplit.mpDmg;
        hpDamage = manaShieldSplit.hpDmg;
        if (manaShieldSplit.mpDmg > 0) {
            s.spendPlayerMp(manaShieldSplit.mpDmg);
            s.addLog(`:shield: Tarcza Many pochłania ${manaShieldSplit.mpDmg} MP`, 'block');
            useCombatStore.getState().emitCombatEvent({
                type: 'playerHit',
                data: { damage: 0, mpDamage: manaShieldSplit.mpDmg, hpDamage: 0, isCrit: false, isManaShield: true },
                timestamp: Date.now(),
            });
        }
    }
    const hasUtamo = useBuffStore.getState().hasBuff('utamo_vita');
    if (hasUtamo && s.playerCurrentMp > 0 && hpDamage > 0) {
        const utamoMp = Math.floor(hpDamage * 0.5);
        let actualMp = utamoMp;
        let leftover = 0;
        if (actualMp > s.playerCurrentMp) {
            leftover = actualMp - s.playerCurrentMp;
            actualMp = s.playerCurrentMp;
        }
        mpDamage += actualMp;
        hpDamage = hpDamage - utamoMp + leftover;
        s.spendPlayerMp(actualMp);
        if (s.playerCurrentMp - actualMp <= 0) {
            useBuffStore.getState().removeBuffByEffect('utamo_vita');
            s.addLog(':blue-circle: Utamo Vita peka! Brak many.', 'system');
        }
    }

    if (char.class === 'Necromancer' && hpDamage > 0) {
        const store = useNecroSummonStore.getState();
        if (store.count(HUNT_PLAYER_FX_ID) > 0) {
            const r2 = store.damageFirst(HUNT_PLAYER_FX_ID, hpDamage);
            hpDamage = Math.max(0, hpDamage - r2.dmgConsumed);
        }
    }

    const live = useCombatStore.getState();
    const newPHp = Math.max(0, live.playerCurrentHp - hpDamage);
    if (hpDamage > 0) useCombatStore.getState().dealToPlayer(hpDamage);

    if (char.class === 'Knight') useSkillStore.getState().addShieldingXpOnHit();

    {
        const utamoSuffix = hasUtamo && mpDamage > 0 ? ` :blue-circle: (${hpDamage} HP / ${mpDamage} MP)` : '';
        let text = `${monster.name_pl} atakuje cię za ${r.finalDamage} dmg`;
        if (r.isCrit) text += ' :high-voltage:KRYTYK!';
        if (utamoSuffix) text += utamoSuffix;
        s.addLog(text, r.isCrit ? 'crit' : 'monster');
    }

    useCombatStore.getState().emitCombatEvent({
        type: 'playerHit',
        data: { damage: r.finalDamage, isCrit: r.isCrit, hpDamage, mpDamage },
        timestamp: Date.now(),
    });

    {
        const liveChForBroadcast = useCharacterStore.getState().character;
        const ps = usePartyStore.getState().party;
        const oh = ps?.members.filter((m) => m.id !== liveChForBroadcast?.id && !m.isBot) ?? [];
        const isLeaderInParty = !!(
            ps && liveChForBroadcast && oh.length > 0 && ps.leaderId === liveChForBroadcast.id
        );
        if (isLeaderInParty && hpDamage > 0) {
            import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                usePartyCombatSyncStore.getState().publishMemberHit({
                    memberId: liveChForBroadcast!.id,
                    damage: hpDamage,
                    sourceMonsterIdx: waveIdx,
                });
            }).catch(() => { });
        }
    }

    if (newPHp > 0) {
        tryAutoPotion(
            newPHp, char.max_hp,
            useCombatStore.getState().playerCurrentMp, char.max_mp,
        );
    }

    if (newPHp <= 0) {
        handlePlayerDeath();
        return true;
    }
    return false;
};

export const doMonsterAttackTick = (): void => {
    const s = useCombatStore.getState();
    if (s.phase !== 'fighting' || !s.monster) return;

    const aliveIdxs: number[] = [];
    for (let i = 0; i < s.waveMonsters.length; i++) {
        if (!s.waveMonsters[i].isDead) aliveIdxs.push(i);
    }
    if (aliveIdxs.length === 0) return;

    for (const idx of aliveIdxs) {
        if (useCombatStore.getState().phase !== 'fighting') return;
        const wm = useCombatStore.getState().waveMonsters[idx];
        if (wm && isHuntMonsterStunned(idx, wm.monster.id)) continue;
        if (wm && huntMonsterSlowSkips(idx, wm.monster.id)) {
            useCombatStore.getState().addLog(`${wm.monster.name_pl} jest spowolniony i traci atak`, 'system');
            continue;
        }
        const died = doSingleWaveMonsterAttack(idx);
        if (died) return;
    }
};


export const doBotAttackTick = (): void => {
    const s = useCombatStore.getState();
    if (s.phase !== 'fighting' || !s.monster) return;

    const bots = useBotStore.getState().bots.filter((b) => b.alive);
    if (bots.length === 0) return;

    for (const bot of bots) {
        const live = useCombatStore.getState();
        if (live.phase !== 'fighting' || !live.monster) return;

        const botStatus = huntEffects.statuses.get(bot.id);
        const botAtkBuffMult = (botStatus && botStatus.atkBuffMs > 0 && botStatus.atkBuffPct > 0)
            ? 1 + (botStatus.atkBuffPct / 100) : 1;
        const botPartyCritBonus = (botStatus && botStatus.partyCritMs > 0 && botStatus.partyCritPct > 0)
            ? botStatus.partyCritPct : 0;

        const buffedAtk = Math.floor(bot.attack * botAtkBuffMult);
        const baseDmg = mitigateDamage(buffedAtk, live.monster.defense, bot.level, true);
        const variance = Math.floor(baseDmg * 0.2);
        const finalDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));

        const isCrit = Math.random() * 100 < (bot.critChance + botPartyCritBonus);
        let dealt = isCrit ? Math.floor(finalDmg * 1.8) : finalDmg;

        const ampBot = consumeHuntMonsterMarkAmp(live.activeTargetIdx, live.monster.id);
        if (ampBot.mult !== 1) {
            dealt = Math.max(1, Math.floor(dealt * ampBot.mult));
        }

        live.dealToMonster(dealt);

        const botIcon = `:robot::${BOT_CLASS_ICONS_LOCAL[bot.class] ?? 'robot'}:`;
        const critSuffix = isCrit ? ' :high-voltage:KRYTYK!' : '';
        live.addLog(
            `${botIcon} ${bot.name} atakuje ${live.monster.name_pl} za ${dealt} dmg${critSuffix}`,
            isCrit ? 'crit' : 'player',
        );

        useCombatStore.getState().emitCombatEvent({
            type: 'botMonsterHit',
            data: { damage: dealt, isCrit, targetIdx: live.activeTargetIdx, botId: bot.id, attackerClass: bot.class },
            timestamp: Date.now(),
        });

        const afterHit = useCombatStore.getState();
        if (afterHit.monsterCurrentHp <= 0 && afterHit.phase === 'fighting') {
            handleMonsterDeath(afterHit.monsterRarity);
        }
    }
};

const BOT_CLASS_ICONS_LOCAL: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles',
    Archer: 'bow-and-arrow', Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};


export const resolveInstantFight = (m: IMonster, startHp: number, startMp: number, rarity: TMonsterRarity): void => {
    const char = getEffectiveChar(useCharacterStore.getState().character, m.level ?? 0);
    if (!char) return;

    const classConfig = getClassConfig(char.class);
    const playerMs = getAttackMs(char.attack_speed || 1);
    const monsterMs = getAttackMs(m.speed || 1);
    const skipSkillLevels = useSkillStore.getState().skillLevels;
    const skipClassBonus = getClassSkillBonus(char.class, skipSkillLevels);

    let mHp = m.hp;
    let pHp = Math.max(1, startHp);
    let nextPlayer = 0;
    let nextMonster = monsterMs;
    let skipTotalDamageDealt = 0;

    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

    for (let iter = 0; iter < 5000 && mHp > 0 && pHp > 0; iter++) {
        if (nextPlayer <= nextMonster) {
            if (classConfig.dualWield) {
                const dw = calculateDualWieldDamage({
                    baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                    offHandAtk: rollOffHandDamage(),
                    skillBonus: skipClassBonus.skillBonus,
                    classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                    enemyDefense: m.defense,
                    attackerLevel: char.level, playerSource: true,
                    critChance: (char.crit_chance ?? 0.05) + skipClassBonus.extraCritChance,
                    maxCritChance: maxCrit,
                    damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                });
                mHp = Math.max(0, mHp - dw.totalDamage);
                skipTotalDamageDealt += dw.totalDamage;
            } else {
                const r = calculateDamage({
                    baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                    skillBonus: skipClassBonus.skillBonus,
                    classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                    enemyDefense: m.defense,
                    attackerLevel: char.level, playerSource: true,
                    critChance: (char.crit_chance ?? 0.05) + skipClassBonus.extraCritChance,
                    maxCritChance: maxCrit,
                    damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                });
                mHp = Math.max(0, mHp - r.finalDamage);
                skipTotalDamageDealt += r.finalDamage;
            }
            nextPlayer += playerMs;
        } else {
            const r = calculateDamage({
                baseAtk: rollMonsterDamage(m), weaponAtk: 0, skillBonus: 0,
                classModifier: 1.0, enemyDefense: char.defense,
                attackerLevel: m.level,
            });
            pHp = Math.max(0, pHp - r.finalDamage);
            nextMonster += monsterMs;
        }
    }

    useCombatStore.getState().setHps(mHp, pHp);

    if (skipTotalDamageDealt > 0) {
        useDailyQuestStore.getState().addProgress('deal_damage', skipTotalDamageDealt);
    }

    if (mHp <= 0) {
        const gold = 0;
        useCombatStore.getState().setLastDrops([]);
        const skipMasteryLevel = useMasteryStore.getState().getMasteryLevel(m.id);
        const skipMasteryXpMult = getMasteryXpMultiplier(skipMasteryLevel);
        const skipBaseXp = Math.floor(m.xp * skipMasteryXpMult * 0.75);
        tickCombatElixirs(2000);
        const xpResult = useCharacterStore.getState().addXp(skipBaseXp);
        const skipFinalXp = xpResult.xpApplied;
        useCombatStore.getState().addReward(skipFinalXp, gold);
        if (xpResult.levelsGained > 0) {
            useCombatStore.getState().addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
        }
        if (xpResult.levelsGained === 0) {
            const skipEffChar = getEffectiveChar(useCharacterStore.getState().character);
            const skipMaxHp = skipEffChar?.max_hp ?? pHp;
            const skipMaxMp = skipEffChar?.max_mp ?? startMp;
            useCharacterStore.getState().updateCharacter({
                hp: Math.min(skipMaxHp, pHp),
                mp: Math.min(skipMaxMp, startMp),
            });
        } else {
            const healed = useCharacterStore.getState().character;
            if (healed) {
                useCombatStore.getState().setHps(mHp, healed.hp);
                useCombatStore.setState({ playerCurrentMp: healed.mp });
            }
        }
        void saveCurrentCharacterStores();
        const skipTaskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
        useTaskStore.getState().addKill(m.id, m.level, skipTaskKills);
        useQuestStore.getState().addProgress('kill', m.id, skipTaskKills);
        useQuestStore.getState().addProgress('kill_rarity', rarity, 1, m.level);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useMasteryStore.getState().addMasteryKills(m.id, skipTaskKills);
        useCombatStore.getState().addSessionStats(skipFinalXp, 0);
        useCombatStore.getState().incrementSessionKill(rarity);
        useCombatStore.getState().setPhase('victory');
    } else {
        handlePlayerDeath();
        useCombatStore.getState().setLastDrops([]);
    }
};


export const startNewFight = (baseMonster: IMonster, bypassLevelCheck = false): void => {
    resetHuntEffects();
    const char = useCharacterStore.getState().character;
    if (!char) return;
    if (useOfflineHuntStore.getState().isActive) {
        useCombatStore.getState().addLog(':prohibited: Nie mozesz walczyc podczas Offline Hunt. Odbierz lub zakoncz polowanie.', 'system');
        return;
    }
    if (!bypassLevelCheck && baseMonster.level > char.level) {
        useCombatStore.getState().addLog(`${baseMonster.name_pl} jest zbyt silny! (wymaga lvl ${baseMonster.level})`, 'system');
        return;
    }
    if (!bypassLevelCheck) {
        const masteriesState = useMasteryStore.getState().masteries;
        const unlock = getMonsterUnlockStatus(baseMonster, monsters, char.level, masteriesState);
        if (!unlock.unlocked && unlock.lockKind === 'mastery') {
            useCombatStore.getState().addLog(`:locked: ${unlock.reason}`, 'system');
            return;
        }
    }

    const speed = useSettingsStore.getState().combatSpeed;
    const isSkip = speed === 'SKIP';
    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(baseMonster.id);
    const rarity = rollMonsterRarity(isSkip, masteryBonuses);
    const scaledMonster = applyRarityToMonster(baseMonster, rarity);

    useCombatStore.getState().setLastDrops([]);
    useCombatStore.getState().setBaseMonster(baseMonster);
    const effCharForInit = getEffectiveChar(char);
    const effMaxHpInit = effCharForInit?.max_hp ?? char.max_hp;
    const effMaxMpInit = effCharForInit?.max_mp ?? char.max_mp;
    const clampedHp = Math.min(char.hp, effMaxHpInit);
    const clampedMp = Math.min(char.mp, effMaxMpInit);
    useCombatStore.getState().initCombat(scaledMonster, clampedHp, clampedMp, rarity);

    hydrateBotsFromParty();
    resetAggro();

    if (rarity !== 'normal') {
        useCombatStore.getState().addLog(`:warning: ${MONSTER_RARITY_LABELS[rarity]} ${baseMonster.name_pl} (Poziom ${baseMonster.level}) – wzmocniony potwór!`, 'system');
    } else {
        useCombatStore.getState().addLog(`Walka z ${baseMonster.name_pl} (Poziom ${baseMonster.level}) rozpoczęta!`, 'system');
    }

    const plannedCount = useCombatStore.getState().wavePlannedCount;
    if (plannedCount > 1 && !isSkip) {
        for (let i = 1; i < plannedCount; i++) {
            const extraRarity = rollMonsterRarity(false, masteryBonuses);
            const extraScaled = applyRarityToMonster(baseMonster, extraRarity);
            useCombatStore.getState().addWaveMonster(extraScaled, extraRarity);
        }
        useCombatStore.getState().addLog(`:paw-prints: Fala ${plannedCount} potworów!`, 'system');
    }

    if (!isSkip) {
        const effChar = getEffectiveChar(char);
        const effMaxHp = effChar?.max_hp ?? char.max_hp;
        const effMaxMp = effChar?.max_mp ?? char.max_mp;
        const liveCs = useCombatStore.getState();
        tryAutoPotion(liveCs.playerCurrentHp, effMaxHp, liveCs.playerCurrentMp, effMaxMp);
    }

    if (!useCombatStore.getState().backgroundStartedAt) {
        useCombatStore.getState().setBackgroundStartedAt(new Date().toISOString());
    }

    if (isSkip) {
        const skipCount = Math.max(1, plannedCount);
        for (let i = 0; i < skipCount; i++) {
            const liveChar = useCharacterStore.getState().character;
            if (!liveChar) return;
            if (useCombatStore.getState().phase === 'dead') return;
            const effChar = getEffectiveChar(liveChar);
            const effMaxHp = effChar?.max_hp ?? liveChar.max_hp;
            const effMaxMp = effChar?.max_mp ?? liveChar.max_mp;
            const curHp = Math.min(liveChar.hp, effMaxHp);
            const curMp = Math.min(liveChar.mp, effMaxMp);
            tryAutoPotion(curHp, effMaxHp, curMp, effMaxMp);
            const postPotionChar = useCharacterStore.getState().character;
            if (!postPotionChar) return;
            let iterMonster = scaledMonster;
            let iterRarity = rarity;
            if (i > 0) {
                iterRarity = rollMonsterRarity(true, masteryBonuses);
                iterMonster = applyRarityToMonster(baseMonster, iterRarity);
                useCombatStore.getState().initCombat(iterMonster, postPotionChar.hp, postPotionChar.mp, iterRarity);
            }
            resolveInstantFight(iterMonster, postPotionChar.hp, postPotionChar.mp, iterRarity);
            if (useCombatStore.getState().phase === 'dead') return;
        }
    }
};

export const addMonsterToWave = (): boolean => {
    const cs = useCombatStore.getState();
    if (cs.phase !== 'fighting') return false;
    if (cs.waveMonsters.length >= 4) return false;
    const base = cs.baseMonster;
    if (!base) return false;

    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(base.id);
    const rarity = rollMonsterRarity(false, masteryBonuses);
    const scaled = applyRarityToMonster(base, rarity);

    const added = useCombatStore.getState().addWaveMonster(scaled, rarity);
    if (!added) return false;

    useCombatStore.getState().incrementWavePlannedCount();

    const label = rarity !== 'normal' ? `${MONSTER_RARITY_LABELS[rarity]} ` : '';
    useCombatStore.getState().addLog(
        `:plus: Pojawia się kolejny ${label}${base.name_pl}! (${useCombatStore.getState().waveMonsters.length}/4) — kolejne fale będą tej samej wielkości`,
        'system',
    );
    return true;
};

export const startAutoNextFight = (): void => {
    const { baseMonster, autoFight } = useCombatStore.getState();
    if (!autoFight || !baseMonster) return;
    const char = useCharacterStore.getState().character;
    if (char) {
        const effChar = getEffectiveChar(char);
        const s = useCombatStore.getState();
        tryAutoPotion(
            s.playerCurrentHp, effChar?.max_hp ?? char.max_hp,
            s.playerCurrentMp, effChar?.max_mp ?? char.max_mp,
        );
    }
    startNewFight(baseMonster, true);
};

export const stopCombat = (): void => {
    const cs = useCombatStore.getState();
    const partyState = usePartyStore.getState().party;
    const ch = useCharacterStore.getState().character;
    const otherHumans = partyState?.members.filter((m) => m.id !== ch?.id && !m.isBot) ?? [];
    const isMemberInPartyCombat = !!(
        ch && partyState && otherHumans.length > 0 && partyState.leaderId !== ch.id
    );
    if ((cs.phase === 'fighting' || cs.phase === 'victory') && !isMemberInPartyCombat) {
        useCharacterStore.getState().updateCharacter({
            hp: cs.playerCurrentHp,
            mp: cs.playerCurrentMp,
        });
    }
    if (isMemberInPartyCombat) {
        markPartyExitGrace();
        if (ch && (ch.hp ?? 0) <= 0) {
            useCharacterStore.getState().fullHealEffective();
        }
    }
    const iAmLeaderInPartyCombat = !!(
        ch && partyState && otherHumans.length > 0 && partyState.leaderId === ch.id
    );
    if (iAmLeaderInPartyCombat) {
        void import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatEnd();
        }).catch(() => { });
    }
    cs.resetCombat();
    useBotStore.getState().clearBots();
    clearHuntNecroSummons();
    resetAggro();
};

export const getAllMonsters = (): IMonster[] => [...monsters].sort((a, b) => a.level - b.level);


const MAX_OFFLINE_COMBAT_MS = 10 * 60 * 60 * 1000;

export interface IOfflineCombatResult {
    kills: number;
    xpEarned: number;
    goldEarned: number;
    levelUps: number;
    died: boolean;
    elapsedMinutes: number;
}

export const simulateOfflineCombat = (elapsedMs: number): IOfflineCombatResult | null => {
    const cs = useCombatStore.getState();
    const { baseMonster, phase, backgroundStartedAt } = cs;
    const char = useCharacterStore.getState().character;

    if (!baseMonster || !char) return null;
    if (phase !== 'fighting' && phase !== 'victory') return null;

    if (backgroundStartedAt) {
        const totalElapsed = Date.now() - new Date(backgroundStartedAt).getTime();
        if (totalElapsed > MAX_OFFLINE_COMBAT_MS) {
            stopCombat();
            return null;
        }
        const remaining = MAX_OFFLINE_COMBAT_MS - (totalElapsed - elapsedMs);
        elapsedMs = Math.min(elapsedMs, remaining);
    }

    if (elapsedMs < 5000) return null;

    const effChar = getEffectiveChar(char);
    if (!effChar) return null;

    const speed = useSettingsStore.getState().combatSpeed;
    const speedMult = SPEED_MULT[speed] ?? 1;
    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const classBonus = getClassSkillBonus(char.class, skillLevels);
    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

    const playerAttackMs = Math.max(200, getAttackMs(effChar.attack_speed ?? 1) / speedMult);
    const monsterAttackMs = Math.max(200, getAttackMs(baseMonster.speed) / speedMult);

    let totalKills = 0;
    let totalXp = 0;
    let totalGold = 0;
    let levelUps = 0;
    let pHp = cs.playerCurrentHp > 0 ? cs.playerCurrentHp : effChar.max_hp;
    const pMp = cs.playerCurrentMp;
    let died = false;
    let timeUsed = 0;

    while (timeUsed < elapsedMs && !died) {
        const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(baseMonster.id);
        const rarity = rollMonsterRarity(false, masteryBonuses);
        const scaledMonster = applyRarityToMonster(baseMonster, rarity);

        let mHp = scaledMonster.hp;
        let fightPHp = pHp;
        let nextPlayer = 0;
        let nextMonster = monsterAttackMs;

        for (let iter = 0; iter < 5000 && mHp > 0 && fightPHp > 0; iter++) {
            if (nextPlayer <= nextMonster) {
                if (classConfig.dualWield) {
                    const dw = calculateDualWieldDamage({
                        baseAtk: effChar.attack, weaponAtk: rollWeaponDamage(),
                        offHandAtk: rollOffHandDamage(),
                        skillBonus: classBonus.skillBonus,
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: scaledMonster.defense,
                        attackerLevel: effChar.level, playerSource: true,
                        critChance: (effChar.crit_chance ?? 0.05) + classBonus.extraCritChance,
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    mHp = Math.max(0, mHp - dw.totalDamage);
                } else {
                    const r = calculateDamage({
                        baseAtk: effChar.attack, weaponAtk: rollWeaponDamage(),
                        skillBonus: classBonus.skillBonus,
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: scaledMonster.defense,
                        attackerLevel: effChar.level, playerSource: true,
                        critChance: (effChar.crit_chance ?? 0.05) + classBonus.extraCritChance,
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    mHp = Math.max(0, mHp - r.finalDamage);
                }
                nextPlayer += playerAttackMs;
            } else {
                const r = calculateDamage({
                    baseAtk: rollMonsterDamage(scaledMonster), weaponAtk: 0, skillBonus: 0,
                    classModifier: 1.0, enemyDefense: effChar.defense,
                    attackerLevel: baseMonster.level,
                });
                fightPHp = Math.max(0, fightPHp - r.finalDamage);
                nextMonster += monsterAttackMs;
            }
        }

        const fightDurationMs = Math.max(nextPlayer, nextMonster);
        timeUsed += fightDurationMs;

        if (mHp <= 0) {
            totalKills++;
            pHp = fightPHp;

            const catchupMasteryLvl = useMasteryStore.getState().getMasteryLevel(baseMonster.id);
            const catchupMasteryXpMult = getMasteryXpMultiplier(catchupMasteryLvl);
            const catchupMasteryGoldMult = getMasteryGoldMultiplier(catchupMasteryLvl);

            const fightXp = Math.floor(scaledMonster.xp * KILL_XP_TTK_MULT * catchupMasteryXpMult * 0.75);

            const fightGold = Math.floor(calculateGoldDrop(scaledMonster.gold) * catchupMasteryGoldMult);
            totalGold += fightGold;

            const taskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
            useTaskStore.getState().addKill(baseMonster.id, baseMonster.level, taskKills);
            useQuestStore.getState().addProgress('kill', baseMonster.id, taskKills);
            useQuestStore.getState().addProgress('kill_rarity', rarity, 1, baseMonster.level);
            useDailyQuestStore.getState().addProgress('kill_any', 1);
            useMasteryStore.getState().addMasteryKills(baseMonster.id, taskKills);

            const regenPerFight = (effChar.hp_regen ?? 0) * (fightDurationMs / 1000);
            pHp = Math.min(effChar.max_hp, pHp + Math.floor(regenPerFight));

            const xpResult = useCharacterStore.getState().addXp(fightXp);
            const fightXpApplied = xpResult.xpApplied;
            totalXp += fightXpApplied;
            if (xpResult.levelsGained > 0) {
                levelUps += xpResult.levelsGained;
            }

            useCombatStore.getState().addSessionStats(fightXpApplied, fightGold);
            useCombatStore.getState().incrementSessionKill(rarity);

            useInventoryStore.getState().addGold(fightGold);

            dropLootToInventory(scaledMonster, rarity, 0);
        } else {
            died = true;
            pHp = 0;
        }
    }

    if (died) {
        handlePlayerDeath();
        useCombatStore.getState().setLastDrops([]);
    } else {
        const postEffChar = getEffectiveChar(useCharacterStore.getState().character);
        const postMaxHp = postEffChar?.max_hp ?? pHp;
        const postMaxMp = postEffChar?.max_mp ?? pMp;
        const clampHp = Math.min(postMaxHp, pHp);
        const clampMp = Math.min(postMaxMp, pMp);
        useCombatStore.getState().setHps(0, clampHp);
        useCharacterStore.getState().updateCharacter({ hp: clampHp, mp: clampMp });
        useCombatStore.getState().setPhase('victory');
    }

    useCombatStore.getState().setLastCombatTickAt(new Date().toISOString());
    void saveCurrentCharacterStores();

    return {
        kills: totalKills,
        xpEarned: totalXp,
        goldEarned: totalGold,
        levelUps,
        died,
        elapsedMinutes: Math.floor(timeUsed / 60000),
    };
};
