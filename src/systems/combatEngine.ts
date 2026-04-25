/**
 * Combat Engine – pure logic functions for background combat.
 * All combat logic previously embedded in Combat.tsx component is now here.
 * These functions read/write directly to Zustand stores (no React dependencies).
 */
import {
    calculateDamage,
    calculateDualWieldDamage,
    calculateBlockChance,
    calculateDodgeChance,
    rollMonsterDamage,
} from './combat';
import { applyDeathPenalty } from './levelSystem';
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
import { getClassSkillBonus, formatItemName, getTotalEquipmentStats, flattenItemsData, type IBaseItem } from './itemSystem';
import { getTrainingBonuses } from './skillSystem';
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
import { useSettingsStore, type CombatSpeed } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { ELIXIRS } from '../stores/shopStore';
import { saveCurrentCharacterStores } from '../stores/characterScope';
import { deathsApi } from '../api/v1/deathsApi';
import { useBuffStore } from '../stores/buffStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../stores/masteryStore';
import { useCooldownStore } from '../stores/cooldownStore';
import { useDeathStore } from '../stores/deathStore';
import { useOfflineHuntStore } from '../stores/offlineHuntStore';
import { useBotStore } from '../stores/botStore';
import { usePartyStore } from '../stores/partyStore';
import { pickWeightedAggroTarget } from './partySystem';
import type { TCharacterClass } from '../types/character';
import type { CharacterClass } from '../api/v1/characterApi';

// ── Constants ────────────────────────────────────────────────────────────────

const SKILL_MP_COST = 15;
const SKILL_COOLDOWN_MS = 8000;

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

// ── Skill cooldown tracking ─────────────────────────────────────────────────
// Module-level so it persists across all tick calls.
const skillCooldownMap = new Map<string, number>();

/**
 * Advance skill cooldowns by `ms` milliseconds.
 * Used by batch processing in useBackgroundCombat to simulate time passing
 * between catch-up attack iterations (browser tab throttling).
 */
export const advanceSkillCooldowns = (ms: number): void => {
    for (const [skillId, lastUsed] of skillCooldownMap.entries()) {
        skillCooldownMap.set(skillId, lastUsed - ms);
    }
};

// ── Bot party helpers ───────────────────────────────────────────────────────
// Bot companions from partyStore are lightweight IPartyMember objects.
// For regular combat we need full IBot with attack/defense/etc. This helper
// hydrates botStore from partyStore's bot members — runs at `startNewFight`.

/**
 * Hydrate `botStore.bots` with full IBot objects generated from the party's
 * bot members. Only runs if:
 *   - Player has an active party
 *   - Party contains at least one `isBot === true` member
 *   - `botStore.bots` is empty (don't clobber an existing combat party)
 */
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
        `🤝 Twoja drużyna (${botMembers.length} bot${botMembers.length === 1 ? '' : 'y'}) dołącza do walki!`,
        'system',
    );
};

// ── Aggro target tracking ───────────────────────────────────────────────────
// In multi-entity combat (player + bots), the monster rolls a class-weighted
// target and sticks with it for AGGRO_SWITCH_INTERVAL_MS before re-rolling.
// Knights eat most of the aggro, Cleric/Bard are backline.

const AGGRO_SWITCH_INTERVAL_MS = 10_000;
let aggroTargetId: string | null = null;
let aggroLastSwitchAt = 0;

/** Reset aggro state — called on new fight / stop / death. */
export const resetAggro = (): void => {
    aggroTargetId = null;
    aggroLastSwitchAt = 0;
    waveAggroState.clear();
};

// ── Per-wave-monster aggro tracking (parallel attacks) ─────────────────────
// Each wave monster has its own independent aggro target which re-rolls at
// an AGGRO_SWITCH_INTERVAL_MS interval. Keyed by monster wave index.
interface IWaveAggroEntry {
    targetId: string;
    lastSwitchAt: number;
}
const waveAggroState = new Map<number, IWaveAggroEntry>();

/** Ensure the given wave monster's aggro target is fresh; returns its current target id. */
const maybeSwitchWaveAggro = (waveIdx: number): string => {
    const now = Date.now();
    const entry = waveAggroState.get(waveIdx);
    const alive = entry && (entry.targetId === 'player'
        || useBotStore.getState().bots.some((b) => b.id === entry.targetId && b.alive));
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

/** Re-roll the monster's aggro target using class weights. */
const rollAggroTarget = (): string => {
    const char = useCharacterStore.getState().character;
    if (!char) return 'player';
    const aliveBots = useBotStore.getState().bots.filter((b) => b.alive);
    const candidates: Array<{ id: string; class: CharacterClass }> = [
        { id: 'player', class: char.class as CharacterClass },
        ...aliveBots.map((b) => ({ id: b.id, class: b.class as CharacterClass })),
    ];
    return pickWeightedAggroTarget(candidates) ?? 'player';
};

/**
 * Ensure the aggro target is fresh. Re-rolls if:
 *   - No target set yet
 *   - Switch interval elapsed
 *   - Current target is a dead bot
 * Returns the current valid target id.
 */
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

// ── Types ────────────────────────────────────────────────────────────────────

export interface IDropDisplay {
    icon: string;
    name: string;
    rarity: string;
    upgradeLevel?: number;
    sold?: boolean;
    soldPrice?: number;
}

export interface ICombatEvent {
    type: 'playerHit' | 'monsterHit' | 'playerDodge' | 'monsterDeath' | 'playerDeath' |
          'floatingDmg' | 'skillAnim' | 'autoPotion' | 'victory' | 'levelUp';
    data?: Record<string, unknown>;
    timestamp: number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Maps game attackSpeed (1.5-4.0 typical) to an interval in ms.
 * speed 1.5 → 2000ms · speed 2.0 → 1500ms · speed 3.0 → 1000ms · min 500ms.
 */
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

export const getEffectiveChar = (char: ReturnType<typeof useCharacterStore.getState>['character']) => {
    if (!char) return null;
    const { equipment } = useInventoryStore.getState();
    const eq = getTotalEquipmentStats(equipment, ALL_ITEMS);
    const { skillLevels } = useSkillStore.getState();
    const tb = getTrainingBonuses(skillLevels, char.class);
    const baseAttackSpeed = char.attack_speed + eq.speed * 0.01 + tb.attack_speed;
    // Point 7: transform bonuses now apply LIVE instead of being baked at claim time.
    // Flat rewards add to the raw pool, percent rewards multiply the whole (base +
    // equip + training + elixir) total so they scale with future gear / training.
    const rawMaxHp = char.max_hp + eq.hp + tb.max_hp + getElixirHpBonus() + getTransformFlatHp();
    const rawMaxMp = char.max_mp + eq.mp + tb.max_mp + getElixirMpBonus() + getTransformFlatMp();
    const rawDefense = char.defense + eq.defense + tb.defense + getElixirDefBonus() + getTransformFlatDefense();
    // Point N5: raw attack pool = base + equip + elixir + flat-transform, then
    // multiplied by the transform % bonus (Archer gets +7% per transform tier,
    // scaling with future gear/level).
    const rawAttack = char.attack + eq.attack + getElixirAtkBonus() + getTransformFlatAttack();
    return {
        ...char,
        attack: Math.floor(rawAttack * getTransformAtkPctMultiplier()),
        defense: Math.floor(rawDefense * getTransformDefPctMultiplier()),
        max_hp: Math.floor(rawMaxHp * getElixirHpPctMultiplier() * getTransformHpPctMultiplier()),
        max_mp: Math.floor(rawMaxMp * getElixirMpPctMultiplier() * getTransformMpPctMultiplier()),
        attack_speed: baseAttackSpeed * getElixirAttackSpeedMultiplier(),
        crit_chance: Math.min(0.5, char.crit_chance + eq.critChance * 0.01 + tb.crit_chance),
        crit_damage: (char.crit_damage ?? 2.0) + eq.critDmg * 0.01 + tb.crit_dmg,
        hp_regen: (char.hp_regen ?? 0) + tb.hp_regen + getTransformHpRegenFlat(),
        mp_regen: (char.mp_regen ?? 0) + getTransformMpRegenFlat(),
    };
};

// ── Drop / loot logic ───────────────────────────────────────────────────────

export const dropLootToInventory = (monster: IMonster, monsterRarity: TMonsterRarity, heroicDropRate: number = 0): IDropDisplay[] => {
    const lootRolls = rollLoot(monster.level, monsterRarity, heroicDropRate);
    const { addItem, addGold } = useInventoryStore.getState();
    const { autoSellCommon, autoSellRare, autoSellEpic, autoSellLegendary, autoSellMythic } = useSettingsStore.getState();
    const drops: IDropDisplay[] = [];
    let autoSellGold = 0;

    for (const roll of lootRolls) {
        const inventoryItem = generateRandomItem(roll.itemLevel, roll.rarity);
        if (!inventoryItem) continue;

        const displayInfo = getItemDisplayInfo(inventoryItem.itemId);
        const displayName = displayInfo?.name_pl ?? formatItemName(roll.itemId);
        const icon = displayInfo?.icon ?? '📦';

        // Track drop rarity for quest progress
        useQuestStore.getState().addProgress('drop_rarity', roll.rarity, 1);

        const shouldAutoSell =
            (roll.rarity === 'common' && autoSellCommon) ||
            (roll.rarity === 'rare' && autoSellRare) ||
            (roll.rarity === 'epic' && autoSellEpic) ||
            (roll.rarity === 'legendary' && autoSellLegendary) ||
            (roll.rarity === 'mythic' && autoSellMythic);

        if (shouldAutoSell) {
            const sellPrice = getGeneratedSellPrice(roll.rarity, roll.itemLevel);
            autoSellGold += sellPrice;
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel, sold: true, soldPrice: sellPrice });
        } else {
            addItem(inventoryItem);
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel });
        }
    }

    if (autoSellGold > 0) addGold(autoSellGold);

    // Stone drop
    const stone = rollStoneDrop(monster.level, monsterRarity);
    if (stone) {
        useInventoryStore.getState().addStones(stone.type, stone.count);
        const stoneRarity = stoneTypeToRarity(stone.type);
        const stoneLabel = STONE_NAMES_MAP[stone.type] ?? stone.type;
        drops.push({ icon: '💎', name: `${stoneLabel} x${stone.count}`, rarity: stoneRarity });
    }

    // Potion drops
    const potionDrops = rollPotionDrop(monster.level);
    for (const pd of potionDrops) {
        useInventoryStore.getState().addConsumable(pd.potionId, pd.count);
        const potionInfo = ELIXIRS.find((e) => e.id === pd.potionId);
        const isHp = pd.potionId.includes('hp') || pd.potionId.includes('health');
        drops.push({ icon: isHp ? '❤️' : '💙', name: potionInfo?.name_pl ?? pd.potionId, rarity: 'common' });
    }

    // Spell chest drops
    const chestDrops = rollSpellChestDrop(monster.level, monsterRarity);
    for (const cd of chestDrops) {
        useInventoryStore.getState().addSpellChest(cd.chestLevel, cd.count);
        drops.push({ icon: getSpellChestIcon(cd.chestLevel), name: getSpellChestDisplayName(cd.chestLevel), rarity: 'epic' });
    }

    return drops;
};

/**
 * Apply monster rarity multipliers to base monster stats.
 */
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

// ── Auto-potion helpers ─────────────────────────────────────────────────────

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
    // Safety: if current value is already at or above max, never fire a potion
    if (maxVal > 0 && currentVal >= maxVal) return;
    const missing = Math.max(0, maxVal - currentVal);
    const valPct = maxVal > 0 ? (currentVal / maxVal) * 100 : 100;
    if (valPct > threshold) return;
    const inv = useInventoryStore.getState();
    const elixir = resolveAutoPotionElixir(potionId, hpOrMp, slotKind, inv.consumables);
    if (!elixir) return;
    // Compute the would-be heal amount and skip if it would be mostly wasted.
    // This is the real guard against the "lost 1 HP, burned a 50 HP potion"
    // frustration — no matter what the % threshold says, we will never fire
    // a potion unless at least its heal amount of HP/MP is actually missing.
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

    // Slot 1: flat HP
    useAutoPotionSlot(settings.autoPotionHpId, settings.autoPotionHpEnabled, settings.autoPotionHpThreshold,
        currentHp, maxHp, cd.hpPotionCooldown > 0, healHp, addLogFn, startHpCd, 'hp', 'flat');

    // Slot 2: pct HP
    useAutoPotionSlot(settings.autoPotionPctHpId, settings.autoPotionPctHpEnabled, settings.autoPotionPctHpThreshold,
        currentHp, maxHp, cd.pctHpCooldown > 0, healHp, addLogFn, startPctHpCd, 'hp', 'pct');

    // Slot 1: flat MP
    useAutoPotionSlot(settings.autoPotionMpId, settings.autoPotionMpEnabled, settings.autoPotionMpThreshold,
        currentMp, maxMp, cd.mpPotionCooldown > 0, healMp, addLogFn, startMpCd, 'mp', 'flat');

    // Slot 2: pct MP
    useAutoPotionSlot(settings.autoPotionPctMpId, settings.autoPotionPctMpEnabled, settings.autoPotionPctMpThreshold,
        currentMp, maxMp, cd.pctMpCooldown > 0, healMp, addLogFn, startPctMpCd, 'mp', 'pct');
};

// ── Monster death handler ───────────────────────────────────────────────────

export const handleMonsterDeath = (currentMonsterRarity: TMonsterRarity): void => {
    const s = useCombatStore.getState();
    if (!s.monster) return;
    // Mastery N7: each mastery level grants +2% XP and +2% Gold (max +50% at lvl 25)
    const masteryLevel = useMasteryStore.getState().getMasteryLevel(s.monster.id);
    const masteryXpMult = getMasteryXpMultiplier(masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);

    const baseGold = calculateGoldDrop(s.monster.gold);
    const gold = Math.floor(baseGold * masteryGoldMult);
    useInventoryStore.getState().addGold(gold);
    const heroicRate = useMasteryStore.getState().getMasteryBonuses(s.monster.id).heroic;
    const drops = dropLootToInventory(s.monster, currentMonsterRarity, heroicRate);
    const dropNames = drops.map(d => `${d.icon} ${d.name}`).join(', ');
    const waveHasMultiple = s.waveMonsters.length > 1;
    s.addLog(
        `${s.monster.name_pl} ginie! +${s.monster.xp} XP, +${gold} Gold${drops.length ? ` · Drop: ${dropNames}` : ''}`,
        'loot',
    );
    const bStore = useBuffStore.getState();
    const xpMultiplier = bStore.getBuffMultiplier('xp_boost');
    const premiumXpMult = bStore.getBuffMultiplier('premium_xp_boost');
    const totalXpMult = xpMultiplier * premiumXpMult;
    const finalXp = Math.floor(s.monster.xp * totalXpMult * masteryXpMult);
    if (masteryLevel > 0) {
        const pct = Math.round((masteryXpMult - 1) * 100);
        s.addLog(`🔥 Mastery Lvl ${masteryLevel}: +${pct}% XP & Gold`, 'system');
    }
    s.addReward(finalXp, gold);
    // Consume pausable XP buff time
    if (bStore.hasBuff('premium_xp_boost')) bStore.consumePausableTime('premium_xp_boost', 2000);
    if (bStore.hasBuff('xp_boost')) bStore.consumePausableTime('xp_boost', 2000);
    if (bStore.hasBuff('skill_xp_boost')) bStore.consumePausableTime('skill_xp_boost', 2000);
    tickCombatElixirs(2000);
    // Snapshot base max HP/MP BEFORE addXp so we can compute level-up grants
    const preChar = useCharacterStore.getState().character;
    const preMaxHp = preChar?.max_hp ?? 0;
    const preMaxMp = preChar?.max_mp ?? 0;
    const xpResult = useCharacterStore.getState().addXp(finalXp);
    if (xpResult.levelsGained > 0) {
        s.addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
    }
    if (totalXpMult > 1) {
        const boostParts: string[] = [];
        if (xpMultiplier > 1) boostParts.push('XP +50%');
        if (premiumXpMult > 1) boostParts.push('Premium x2');
        s.addLog(`⭐ ${boostParts.join(' + ')} aktywny! ${s.monster.xp} × ${totalXpMult} = ${finalXp} XP`, 'system');
    }
    // Persist HP/MP with level-up grants (re-read live combat store for fresh values).
    // On level-up: characterStore.addXp already full-heals HP/MP to the new max,
    // so we sync combat's live HP/MP to character.hp/mp (the source of truth).
    // On no level-up: we bump combat HP by the flat level-grant delta and persist.
    const postChar = useCharacterStore.getState().character;
    if (xpResult.levelsGained > 0) {
        // Full heal — mirror character.hp/mp (already =max) into combat store
        const fullHp = postChar?.hp ?? 0;
        const fullMp = postChar?.mp ?? 0;
        useCombatStore.getState().setHps(
            useCombatStore.getState().monsterCurrentHp,
            fullHp,
        );
        // setHps only touches playerCurrentHp; patch MP separately
        useCombatStore.setState({ playerCurrentMp: fullMp });
    } else {
        const live = useCombatStore.getState();
        const hpLevelGain = Math.max(0, (postChar?.max_hp ?? 0) - preMaxHp);
        // Clamp to effective max to prevent values > effMax in characterStore
        // (happens when buffs/elixirs expire between kills).
        const effForSync = getEffectiveChar(postChar);
        const syncMaxHp = effForSync?.max_hp ?? (postChar?.max_hp ?? 9999);
        const syncMaxMp = effForSync?.max_mp ?? (postChar?.max_mp ?? 9999);
        // Preserve live HP/MP across kills — neither HP nor MP auto-refills on
        // victory. Natural regen (useMpRegen / hp_regen) handles recovery between
        // fights, keeping skill MP costs meaningful across the whole session.
        useCharacterStore.getState().updateCharacter({
            hp: Math.min(syncMaxHp, Math.max(0, live.playerCurrentHp + hpLevelGain)),
            mp: Math.min(syncMaxMp, Math.max(0, live.playerCurrentMp)),
        });
    }
    void saveCurrentCharacterStores();
    // Track kills for tasks, quests, mastery
    const taskKills = MONSTER_RARITY_TASK_KILLS[currentMonsterRarity] ?? 1;
    useTaskStore.getState().addKill(s.monster.id, s.monster.level, taskKills);
    useQuestStore.getState().addProgress('kill', s.monster.id, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', currentMonsterRarity, 1, s.monster.level);
    useDailyQuestStore.getState().addProgress('kill_any', 1);
    useDailyQuestStore.getState().addProgress('earn_gold', gold);
    // Mastery uses the same rarity-weighted count as tasks so progress stays
    // in sync between the two — a legendary kill grants the same number of
    // units to both systems, and offline hunt (which already feeds weighted
    // kills into both) matches live combat.
    useMasteryStore.getState().addMasteryKills(s.monster.id, taskKills);
    // Update session stats
    useCombatStore.getState().addSessionStats(finalXp, gold);
    useCombatStore.getState().incrementSessionKill(currentMonsterRarity);

    // Wave-aware finalization: if more alive monsters exist, promote next target
    if (waveHasMultiple) {
        // Append drops to wave-accumulated drops (don't replace)
        useCombatStore.getState().appendDrops(drops);
        // Mark current active monster dead in wave
        useCombatStore.getState().markActiveWaveMonsterDead();
        // Try to advance to next alive target
        const advanced = useCombatStore.getState().advanceToNextWaveTarget();
        if (advanced) {
            // Continue fighting the next monster
            const next = useCombatStore.getState().monster;
            if (next) {
                useCombatStore.getState().addLog(
                    `🎯 Cel: ${next.name_pl} (${useCombatStore.getState().waveMonsters.filter(w => !w.isDead).length} żywych)`,
                    'system',
                );
            }
            // Do NOT set victory – stay in fighting phase
            return;
        }
        // No more alive monsters – wave cleared, show victory
        useCombatStore.getState().addLog(`⚔️ Fala pokonana! (${s.waveMonsters.length} potworów)`, 'system');
        s.setPhase('victory');
        return;
    }

    // Single-monster path: standard victory
    useCombatStore.getState().setLastDrops(drops);
    s.setPhase('victory');
};

// ── Player death handler ────────────────────────────────────────────────────

export const handlePlayerDeath = (): void => {
    const s = useCombatStore.getState();
    const char = useCharacterStore.getState().character;
    if (!char) return;

    const monsterName = s.monster
        ? (s.monsterRarity && s.monsterRarity !== 'normal'
            ? `${s.monster.name_pl} [${s.monsterRarity}]`
            : s.monster.name_pl)
        : 'Nieznany';
    const monsterLevel = s.monster?.level ?? 0;

    if (s.monster) {
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

    const usedDeathProtection = useInventoryStore.getState().useConsumable('death_protection');
    const usedAol = useInventoryStore.getState().useConsumable('amulet_of_loss');

    useCharacterStore.getState().fullHealEffective();

    const oldLevel = char.level;
    let newLevel = char.level;
    let levelsLost = 0;
    let xpPercent = 100;

    if (usedDeathProtection) {
        s.addLog('🛡️ Eliksir Ochrony uchronil Cie od utraty poziomu!', 'system');
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
        useSkillStore.getState().applyDeathPenalty(char.class);
        if (penalty.levelsLost > 0) {
            s.addLog(`Giniesz… Tracisz poziom! ${char.level} → ${penalty.newLevel} (${penalty.xpPercent}% XP zachowane) · -5% Skill XP`, 'system');
        } else {
            s.addLog(`Giniesz… -50% XP · -5% Skill XP`, 'system');
        }
    }

    const itemsLost = useInventoryStore.getState().applyDeathItemLoss(usedAol);
    if (usedAol) {
        s.addLog('🔱 Amulet of Loss roztrzaskal sie i ochronil Twoje przedmioty!', 'system');
    } else if (itemsLost > 0) {
        s.addLog(`💀 Stracileś ${itemsLost} przedmiot(ow) przy śmierci!`, 'system');
    }

    void saveCurrentCharacterStores();

    // Stop all combat (background included) and trigger epic death overlay
    s.resetCombat();
    useBotStore.getState().clearBots();
    resetAggro();

    useDeathStore.getState().triggerDeath({
        killedBy: monsterName,
        sourceLevel: monsterLevel,
        oldLevel,
        newLevel,
        levelsLost,
        xpPercent,
        protectionUsed: usedDeathProtection,
        source: 'monster',
    });
};

// ── Player attack tick ──────────────────────────────────────────────────────

export const doPlayerAttackTick = (): void => {
    const s = useCombatStore.getState();
    const char = getEffectiveChar(useCharacterStore.getState().character);
    const skillSettings = useSettingsStore.getState();
    if (s.phase !== 'fighting' || !s.monster || !char) return;

    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const classBonus = getClassSkillBonus(char.class, skillLevels);
    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;
    const isDualWield = !!classConfig.dualWield;

    // Single hit helper
    const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
        const freshS = useCombatStore.getState();
        if (freshS.phase !== 'fighting' || !freshS.monster) return 0;
        const wRoll = Math.floor(weaponRollFn() * dmgPercent);
        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: freshS.monster.defense,
            critChance: (char.crit_chance ?? 0.05) + classBonus.extraCritChance,
            maxCritChance: maxCrit,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
        });
        freshS.dealToMonster(r.finalDamage);
        // Emit combat event for animations (only if on combat view)
        const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
        let text = `${handPrefix}Atakujesz ${freshS.monster.name_pl} za ${r.finalDamage} dmg`;
        if (r.isCrit) text += ' ⚡KRYTYK!';
        if (r.isBlocked) text += ' (zablokowane)';
        freshS.addLog(text, hand ? (r.isCrit ? 'crit' : 'dualwield') : (r.isCrit ? 'crit' : 'player'));
        useCombatStore.getState().emitCombatEvent({
            type: 'monsterHit',
            data: { damage: r.finalDamage, isCrit: r.isCrit, isBlocked: r.isBlocked, hand: hand ?? null },
            timestamp: Date.now(),
        });
        return r.finalDamage;
    };

    // Execute attack(s)
    let totalDamage = 0;
    if (isDualWield) {
        totalDamage += doSingleHit('left', rollWeaponDamage, 0.6);
        // Hit 2 150ms later
        setTimeout(() => {
            const dmg2 = doSingleHit('right', rollOffHandDamage, 0.6);
            if (dmg2 > 0) useDailyQuestStore.getState().addProgress('deal_damage', dmg2);
            const s2 = useCombatStore.getState();
            if (s2.monsterCurrentHp <= 0 && s2.phase === 'fighting') {
                handleMonsterDeath(s2.monsterRarity);
            }
        }, 150);
    } else {
        totalDamage += doSingleHit(undefined, rollWeaponDamage, 1.0);
    }

    // Weapon/MLVL XP
    useSkillStore.getState().addMlvlXpFromAttack(char.class as any);
    useSkillStore.getState().addWeaponSkillXpFromAttack(char.class as any);

    // AUTO skill logic
    if (skillSettings.skillMode === 'auto') {
        const slots = useSkillStore.getState().activeSkillSlots;
        const now = Date.now();
        const speedMult = SPEED_MULT[skillSettings.combatSpeed] ?? 1;
        for (const skillId of slots) {
            if (!skillId) continue;
            const lastUsed = skillCooldownMap.get(skillId) ?? 0;
            if ((now - lastUsed) * speedMult < SKILL_COOLDOWN_MS) continue;
            if (s.playerCurrentMp < SKILL_MP_COST) continue;
            const sr = calculateDamage({
                baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                skillBonus: Math.floor(char.attack * 0.5),
                classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                enemyDefense: s.monster.defense,
                critChance: 0.20,
                maxCritChance: maxCrit,
                damageMultiplier: getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier(),
            });
            s.dealToMonster(sr.finalDamage);
            s.spendPlayerMp(SKILL_MP_COST);
            skillCooldownMap.set(skillId, now);
            useCooldownStore.getState().setSkillCooldown(skillId, SKILL_COOLDOWN_MS);
            { const sd = getSkillDef(skillId); if (sd) applySkillBuff(skillId, sd); }
            totalDamage += sr.finalDamage;
            useSkillStore.getState().addMlvlXpFromSkill(char.class as any);
            s.addLog(
                `[AUTO] ${skillId}: ${sr.finalDamage} dmg${sr.isCrit ? ' ⚡KRYTYK!' : ''} (-${SKILL_MP_COST} MP)`,
                sr.isCrit ? 'crit' : 'player',
            );
            useCombatStore.getState().emitCombatEvent({
                type: 'skillAnim',
                data: { skillId },
                timestamp: Date.now(),
            });
            break;
        }
    }

    // Auto-potion. `char` here is already the result of getEffectiveChar, so
    // its max_hp/max_mp already include eq + training + elixirs + transform.
    // Never pass it back into getEffectiveChar — that double-applies every
    // bonus and inflates maxVal enough to drop perceived 100% HP below the
    // auto-potion threshold, which was the "potion at 100% HP" bug.
    const freshAfterAtk = useCombatStore.getState();
    tryAutoPotion(
        freshAfterAtk.playerCurrentHp, char.max_hp,
        freshAfterAtk.playerCurrentMp, char.max_mp,
    );

    // Track damage for daily quests
    if (totalDamage > 0) useDailyQuestStore.getState().addProgress('deal_damage', totalDamage);

    // Check monster death (unless dual wield – 2nd hit checks separately)
    if (!isDualWield) {
        const freshS = useCombatStore.getState();
        if (freshS.monsterCurrentHp <= 0 && freshS.phase === 'fighting') {
            handleMonsterDeath(freshS.monsterRarity);
        }
    } else {
        // For dual wield, check after first hit too
        const freshS = useCombatStore.getState();
        if (freshS.monsterCurrentHp <= 0 && freshS.phase === 'fighting') {
            handleMonsterDeath(freshS.monsterRarity);
        }
    }
};

// ── Monster attack tick ─────────────────────────────────────────────────────

/**
 * Resolve a single wave-monster attack against its per-monster aggro target.
 * Each wave monster attacks independently, so 4 stacked monsters all strike
 * at once instead of waiting their turn in queue.
 * Returns `true` if the player died (so the outer caller can stop iterating).
 */
const doSingleWaveMonsterAttack = (waveIdx: number): boolean => {
    const s = useCombatStore.getState();
    const wm = s.waveMonsters[waveIdx];
    if (!wm || wm.isDead) return false;
    const monster = wm.monster;
    const char = getEffectiveChar(useCharacterStore.getState().character);
    if (!char) return false;

    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const shieldingLevel = skillLevels['shielding'] ?? 0;
    const isPhysical = !monster.magical;

    // Per-monster aggro — independent class-weighted roll per wave monster.
    const hasBots = useBotStore.getState().bots.some((b) => b.alive);
    const targetId = hasBots ? maybeSwitchWaveAggro(waveIdx) : 'player';
    // Mirror the current aggro target into the wave state so the UI can show it
    useCombatStore.getState().setWaveMonsterAggro(waveIdx, targetId);

    if (targetId !== 'player') {
        // Monster attacks a bot. Bots have no block/dodge/elixirs — simple
        // damage calc using their raw defense.
        const bot = useBotStore.getState().bots.find((b) => b.id === targetId);
        if (!bot || !bot.alive) {
            // Fallback: target invalid, clear this monster's aggro state so it re-rolls.
            waveAggroState.delete(waveIdx);
            return false;
        }
        const rolledAtkBot = rollMonsterDamage(monster);
        const dmg = Math.max(1, rolledAtkBot - bot.defense);
        const newHp = Math.max(0, bot.hp - dmg);
        useBotStore.getState().updateBotHp(bot.id, newHp);

        const botIcon = BOT_CLASS_ICONS_LOCAL[bot.class] ?? '🤖';
        s.addLog(`${monster.name_pl} atakuje ${botIcon} ${bot.name} za ${dmg} dmg`, 'monster');

        if (newHp <= 0) {
            s.addLog(`💀 ${botIcon} ${bot.name} ginie w walce!`, 'system');
            // Force immediate per-monster aggro re-roll so next tick picks a new target
            waveAggroState.delete(waveIdx);
        }
        return false;
    }

    // Target is the player.
    const blockChance = classConfig.canBlock ? calculateBlockChance(shieldingLevel, isPhysical) : 0;
    const dodgeChance = classConfig.canDodge ? calculateDodgeChance(char.class, skillLevels['agility'] ?? 0, isPhysical) : 0;

    const rolledAtk = rollMonsterDamage(monster);
    const r = calculateDamage({
        baseAtk: rolledAtk, weaponAtk: 0, skillBonus: 0,
        classModifier: 1.0,
        enemyDefense: char.defense,
        blockChance,
        dodgeChance,
    });

    if (r.isDodged) {
        s.addLog(`${monster.name_pl} atakuje – unikasz ataku!`, 'dodge');
        useCombatStore.getState().emitCombatEvent({ type: 'playerDodge', timestamp: Date.now() });
        return false;
    }

    // Utamo Vita (Magic Shield): 50% dmg → MP
    let hpDamage = r.finalDamage;
    let mpDamage = 0;
    const hasUtamo = useBuffStore.getState().hasBuff('utamo_vita');
    if (hasUtamo && s.playerCurrentMp > 0) {
        mpDamage = Math.floor(r.finalDamage * 0.5);
        hpDamage = r.finalDamage - mpDamage;
        if (mpDamage > s.playerCurrentMp) {
            const overflow = mpDamage - s.playerCurrentMp;
            mpDamage = s.playerCurrentMp;
            hpDamage += overflow;
        }
        s.spendPlayerMp(mpDamage);
        if (s.playerCurrentMp - mpDamage <= 0) {
            useBuffStore.getState().removeBuffByEffect('utamo_vita');
            s.addLog('🔵 Utamo Vita peka! Brak many.', 'system');
        }
    }

    // Re-read playerCurrentHp in case an earlier monster in this tick already hit.
    const live = useCombatStore.getState();
    const newPHp = Math.max(0, live.playerCurrentHp - hpDamage);
    useCombatStore.getState().dealToPlayer(hpDamage);

    if (r.isBlocked) {
        s.addLog(`${monster.name_pl} atakuje za ${r.finalDamage} dmg 🛡️ ZABLOKOWANE! (${r.damage} → ${r.finalDamage})`, 'block');
        useSkillStore.getState().addShieldingXpOnBlock();
    } else {
        const utamoSuffix = hasUtamo && mpDamage > 0 ? ` 🔵 (${hpDamage} HP / ${mpDamage} MP)` : '';
        let text = `${monster.name_pl} atakuje cię za ${r.finalDamage} dmg`;
        if (r.isCrit) text += ' ⚡KRYTYK!';
        if (utamoSuffix) text += utamoSuffix;
        s.addLog(text, r.isCrit ? 'crit' : 'monster');
    }

    useCombatStore.getState().emitCombatEvent({
        type: 'playerHit',
        data: { damage: r.finalDamage, isCrit: r.isCrit, isBlocked: r.isBlocked, hpDamage, mpDamage },
        timestamp: Date.now(),
    });

    // Auto-potion after damage. `char` here is already effective — passing it
    // through getEffectiveChar again would double-apply bonuses and break the
    // threshold math (see doPlayerAttackTick comment above).
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

    // Parallel wave attacks: every alive wave monster takes its turn at once.
    // Each monster uses independent aggro. If any attack kills the player,
    // stop iterating so the death handler owns the transition.
    const aliveIdxs: number[] = [];
    for (let i = 0; i < s.waveMonsters.length; i++) {
        if (!s.waveMonsters[i].isDead) aliveIdxs.push(i);
    }
    if (aliveIdxs.length === 0) return;

    for (const idx of aliveIdxs) {
        // Re-check phase between attacks in case a previous one caused death
        if (useCombatStore.getState().phase !== 'fighting') return;
        const died = doSingleWaveMonsterAttack(idx);
        if (died) return;
    }
};

// ── Bot attack tick ─────────────────────────────────────────────────────────
// Runs on a separate interval in useBackgroundCombat. All alive bots attack
// the active wave target together. Simpler than per-bot intervals and still
// visually readable: bots fire roughly as often as the player does.

export const doBotAttackTick = (): void => {
    const s = useCombatStore.getState();
    if (s.phase !== 'fighting' || !s.monster) return;

    const bots = useBotStore.getState().bots.filter((b) => b.alive);
    if (bots.length === 0) return;

    for (const bot of bots) {
        const live = useCombatStore.getState();
        if (live.phase !== 'fighting' || !live.monster) return;

        // Base damage: bot attack - monster defense, with ±20% variance
        const baseDmg = Math.max(1, bot.attack - live.monster.defense);
        const variance = Math.floor(baseDmg * 0.2);
        const finalDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));

        // Crit roll
        const isCrit = Math.random() * 100 < bot.critChance;
        const dealt = isCrit ? Math.floor(finalDmg * 1.8) : finalDmg;

        live.dealToMonster(dealt);

        const botIcon = BOT_CLASS_ICONS_LOCAL[bot.class] ?? '🤖';
        const critSuffix = isCrit ? ' ⚡KRYTYK!' : '';
        live.addLog(
            `${botIcon} ${bot.name} atakuje ${live.monster.name_pl} za ${dealt} dmg${critSuffix}`,
            isCrit ? 'crit' : 'player',
        );

        // Check monster death after this bot's hit — handle wave/victory
        const afterHit = useCombatStore.getState();
        if (afterHit.monsterCurrentHp <= 0 && afterHit.phase === 'fighting') {
            handleMonsterDeath(afterHit.monsterRarity);
            // If handleMonsterDeath advanced to next wave target, continue
            // with the remaining bots against the new monster. If it set
            // phase to 'victory' (no more alive monsters), the outer guard
            // above will break out of the loop on the next iteration.
        }
    }
};

// Local copy of class icons (mirrors botSystem BOT_CLASS_ICONS) — kept here
// to avoid a circular import at module load time.
const BOT_CLASS_ICONS_LOCAL: Record<string, string> = {
    Knight: '⚔️', Mage: '🔮', Cleric: '✨',
    Archer: '🏹', Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

// ── SKIP mode: instant resolution ───────────────────────────────────────────

export const resolveInstantFight = (m: IMonster, startHp: number, startMp: number, rarity: TMonsterRarity): void => {
    const char = getEffectiveChar(useCharacterStore.getState().character);
    if (!char) return;

    const classConfig = getClassConfig(char.class);
    const playerMs = getAttackMs(char.attack_speed || 1);
    const monsterMs = getAttackMs(m.speed || 1);
    const skipSkillLevels = useSkillStore.getState().skillLevels;
    const skipClassBonus = getClassSkillBonus(char.class, skipSkillLevels);
    const shieldingLevel = skipSkillLevels['shielding'] ?? 0;

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
                    critChance: (char.crit_chance ?? 0.05) + skipClassBonus.extraCritChance,
                    maxCritChance: maxCrit,
                    damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                });
                mHp = Math.max(0, mHp - r.finalDamage);
                skipTotalDamageDealt += r.finalDamage;
            }
            nextPlayer += playerMs;
        } else {
            const isPhysical = !m.magical;
            const blockChance = classConfig.canBlock ? calculateBlockChance(shieldingLevel, isPhysical) : 0;
            const dodgeChance = classConfig.canDodge ? calculateDodgeChance(char.class, skipSkillLevels['agility'] ?? 0, isPhysical) : 0;
            const r = calculateDamage({
                baseAtk: rollMonsterDamage(m), weaponAtk: 0, skillBonus: 0,
                classModifier: 1.0, enemyDefense: char.defense,
                blockChance, dodgeChance,
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
        const skipBStore = useBuffStore.getState();
        const skipXpMult = skipBStore.getBuffMultiplier('xp_boost');
        const skipPremiumMult = skipBStore.getBuffMultiplier('premium_xp_boost');
        // Mastery N7: apply +2% XP per mastery level (SKIP still pays 75% base)
        const skipMasteryLevel = useMasteryStore.getState().getMasteryLevel(m.id);
        const skipMasteryXpMult = getMasteryXpMultiplier(skipMasteryLevel);
        const skipFinalXp = Math.floor(m.xp * skipXpMult * skipPremiumMult * skipMasteryXpMult * 0.75);
        if (skipBStore.hasBuff('premium_xp_boost')) skipBStore.consumePausableTime('premium_xp_boost', 2000);
        if (skipBStore.hasBuff('xp_boost')) skipBStore.consumePausableTime('xp_boost', 2000);
        if (skipBStore.hasBuff('skill_xp_boost')) skipBStore.consumePausableTime('skill_xp_boost', 2000);
        tickCombatElixirs(2000);
        useCombatStore.getState().addReward(skipFinalXp, gold);
        const xpResult = useCharacterStore.getState().addXp(skipFinalXp);
        if (xpResult.levelsGained > 0) {
            useCombatStore.getState().addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
        }
        // On level-up: addXp already full-healed character.hp/mp — don't overwrite.
        // Otherwise persist this fight's final HP/MP, clamped to effective max.
        if (xpResult.levelsGained === 0) {
            const skipEffChar = getEffectiveChar(useCharacterStore.getState().character);
            const skipMaxHp = skipEffChar?.max_hp ?? pHp;
            const skipMaxMp = skipEffChar?.max_mp ?? startMp;
            useCharacterStore.getState().updateCharacter({
                hp: Math.min(skipMaxHp, pHp),
                mp: Math.min(skipMaxMp, startMp),
            });
        } else {
            // Sync combat store to the freshly-healed character
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

// ── Start new fight ─────────────────────────────────────────────────────────

export const startNewFight = (baseMonster: IMonster, bypassLevelCheck = false): void => {
    const char = useCharacterStore.getState().character;
    if (!char) return;
    // Block while offline hunt is running — mutual exclusion.
    if (useOfflineHuntStore.getState().isActive) {
        useCombatStore.getState().addLog('🚫 Nie mozesz walczyc podczas Offline Hunt. Odbierz lub zakoncz polowanie.', 'system');
        return;
    }
    if (!bypassLevelCheck && baseMonster.level > char.level) {
        useCombatStore.getState().addLog(`${baseMonster.name_pl} jest zbyt silny! (wymaga lvl ${baseMonster.level})`, 'system');
        return;
    }
    // Mastery gate
    const masteriesState = useMasteryStore.getState().masteries;
    const unlock = getMonsterUnlockStatus(baseMonster, monsters, char.level, masteriesState);
    if (!unlock.unlocked && unlock.lockKind === 'mastery') {
        useCombatStore.getState().addLog(`🔒 ${unlock.reason}`, 'system');
        return;
    }

    const speed = useSettingsStore.getState().combatSpeed;
    const isSkip = speed === 'SKIP';
    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(baseMonster.id);
    const rarity = rollMonsterRarity(isSkip, masteryBonuses);
    const scaledMonster = applyRarityToMonster(baseMonster, rarity);

    useCombatStore.getState().setLastDrops([]);
    useCombatStore.getState().setBaseMonster(baseMonster);
    // Clamp starting HP/MP to effective max to prevent HP > maxHP
    // (can happen if buffs/elixirs expired since last heal).
    // Don't auto-refill to effMax just because char.hp >= raw max_hp — after a
    // victory char.hp can already exceed raw max_hp (it tracks the elixir-
    // inflated value), and treating that as "full" would re-heal the player
    // to 100% on the next fight even though they took damage.
    const effCharForInit = getEffectiveChar(char);
    const effMaxHpInit = effCharForInit?.max_hp ?? char.max_hp;
    const effMaxMpInit = effCharForInit?.max_mp ?? char.max_mp;
    const clampedHp = Math.min(char.hp, effMaxHpInit);
    const clampedMp = Math.min(char.mp, effMaxMpInit);
    useCombatStore.getState().initCombat(scaledMonster, clampedHp, clampedMp, rarity);

    // Hydrate party bots into botStore so they fight alongside the player.
    // Only runs if player has a party with bot members and botStore is empty
    // (idempotent across auto-fight iterations).
    hydrateBotsFromParty();
    // Fresh aggro roll for the new fight
    resetAggro();

    // Log rarity info
    if (rarity !== 'normal') {
        useCombatStore.getState().addLog(`⚠️ ${MONSTER_RARITY_LABELS[rarity]} ${baseMonster.name_pl} (Poziom ${baseMonster.level}) – wzmocniony potwór!`, 'system');
    } else {
        useCombatStore.getState().addLog(`Walka z ${baseMonster.name_pl} (Poziom ${baseMonster.level}) rozpoczęta!`, 'system');
    }

    // Sticky wave size — spawn remaining planned monsters (each gets its own rarity roll)
    const plannedCount = useCombatStore.getState().wavePlannedCount;
    if (plannedCount > 1 && !isSkip) {
        for (let i = 1; i < plannedCount; i++) {
            const extraRarity = rollMonsterRarity(false, masteryBonuses);
            const extraScaled = applyRarityToMonster(baseMonster, extraRarity);
            useCombatStore.getState().addWaveMonster(extraScaled, extraRarity);
        }
        useCombatStore.getState().addLog(`🐾 Fala ${plannedCount} potworów!`, 'system');
    }

    // Auto-potion at fight start.
    // Read live HP/MP from combatStore (post-initCombat) instead of char.hp/char.mp
    // so we compare against the same effMax the UI shows — char.hp is pre-clamp
    // and can be out of sync with playerCurrentHp/effMax, causing auto-potion to
    // fire at what the user perceives as 100%.
    if (!isSkip) {
        const effChar = getEffectiveChar(char);
        const effMaxHp = effChar?.max_hp ?? char.max_hp;
        const effMaxMp = effChar?.max_mp ?? char.max_mp;
        const liveCs = useCombatStore.getState();
        tryAutoPotion(liveCs.playerCurrentHp, effMaxHp, liveCs.playerCurrentMp, effMaxMp);
    }

    // Set background started timestamp if not already set
    if (!useCombatStore.getState().backgroundStartedAt) {
        useCombatStore.getState().setBackgroundStartedAt(new Date().toISOString());
    }

    if (isSkip) {
        // SKIP mode respects the sticky wave size — simulate `plannedCount`
        // sequential kills. Each iteration rolls a fresh monster + rarity
        // (matching the live-combat behavior where each wave slot rolls).
        const skipCount = Math.max(1, plannedCount);
        for (let i = 0; i < skipCount; i++) {
            // Re-read live HP/MP so consecutive fights start where the
            // previous one ended (death breaks the loop).
            const liveChar = useCharacterStore.getState().character;
            if (!liveChar) return;
            if (useCombatStore.getState().phase === 'dead') return;
            // Auto-potion between SKIP iterations using live HP/MP, clamped
            // to effective max so an expired elixir can't leave HP > max.
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

/**
 * Add another monster of the same base type to the active wave.
 * Only works during `phase === 'fighting'` and when wave < 4.
 * Rolls a fresh rarity for the new monster.
 *
 * Also bumps `wavePlannedCount` so the bigger wave size sticks across
 * subsequent auto-fights — the player doesn't have to re-click after
 * every victory.
 */
export const addMonsterToWave = (): boolean => {
    const cs = useCombatStore.getState();
    if (cs.phase !== 'fighting') return false;
    if (cs.waveMonsters.length >= 4) return false;
    const base = cs.baseMonster;
    if (!base) return false;

    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(base.id);
    // Force non-skip rarity roll
    const rarity = rollMonsterRarity(false, masteryBonuses);
    const scaled = applyRarityToMonster(base, rarity);

    const added = useCombatStore.getState().addWaveMonster(scaled, rarity);
    if (!added) return false;

    // Make the bigger wave sticky for subsequent auto-fights.
    useCombatStore.getState().incrementWavePlannedCount();

    const label = rarity !== 'normal' ? `${MONSTER_RARITY_LABELS[rarity]} ` : '';
    useCombatStore.getState().addLog(
        `➕ Pojawia się kolejny ${label}${base.name_pl}! (${useCombatStore.getState().waveMonsters.length}/4) — kolejne fale będą tej samej wielkości`,
        'system',
    );
    return true;
};

/**
 * Auto-next fight: called after victory + delay.
 * Uses the baseMonster stored in combatStore.
 */
export const startAutoNextFight = (): void => {
    const { baseMonster, autoFight } = useCombatStore.getState();
    if (!autoFight || !baseMonster) return;
    // Run auto-potion between fights
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

/**
 * Stop combat: sync HP/MP to characterStore and reset combat.
 */
export const stopCombat = (): void => {
    const cs = useCombatStore.getState();
    if (cs.phase === 'fighting' || cs.phase === 'victory') {
        useCharacterStore.getState().updateCharacter({
            hp: cs.playerCurrentHp,
            mp: cs.playerCurrentMp,
        });
    }
    cs.resetCombat();
    // Release the bot companions — they re-hydrate on the next startNewFight
    // via hydrateBotsFromParty if the player still has a party.
    useBotStore.getState().clearBots();
    resetAggro();
};

/** Get the list of all monsters (sorted by level) */
export const getAllMonsters = (): IMonster[] => [...monsters].sort((a, b) => a.level - b.level);

// ── Offline Combat Simulation ──────────────────────────────────────────────
// When the computer sleeps or browser tab is suspended, JS timers stop.
// On resume, this function calculates how many fights would have happened
// during the offline period and applies the results.

const MAX_OFFLINE_COMBAT_MS = 10 * 60 * 60 * 1000; // 10 hours

export interface IOfflineCombatResult {
    kills: number;
    xpEarned: number;
    goldEarned: number;
    levelUps: number;
    died: boolean;
    elapsedMinutes: number;
}

/**
 * Simulate combat for a period of time that the app was suspended.
 * Uses SKIP-like math to resolve fights.
 * Returns results and applies them to stores.
 */
export const simulateOfflineCombat = (elapsedMs: number): IOfflineCombatResult | null => {
    const cs = useCombatStore.getState();
    const { baseMonster, phase, backgroundStartedAt } = cs;
    const char = useCharacterStore.getState().character;

    if (!baseMonster || !char) return null;
    if (phase !== 'fighting' && phase !== 'victory') return null;

    // Enforce 10h total cap
    if (backgroundStartedAt) {
        const totalElapsed = Date.now() - new Date(backgroundStartedAt).getTime();
        if (totalElapsed > MAX_OFFLINE_COMBAT_MS) {
            // Time's up – stop combat entirely
            stopCombat();
            return null;
        }
        // Cap simulation to remaining time within 10h
        const remaining = MAX_OFFLINE_COMBAT_MS - (totalElapsed - elapsedMs);
        elapsedMs = Math.min(elapsedMs, remaining);
    }

    if (elapsedMs < 5000) return null; // Don't simulate for tiny gaps

    const effChar = getEffectiveChar(char);
    if (!effChar) return null;

    const speed = useSettingsStore.getState().combatSpeed;
    const speedMult = SPEED_MULT[speed] ?? 1;
    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const classBonus = getClassSkillBonus(char.class, skillLevels);
    const shieldingLevel = skillLevels['shielding'] ?? 0;
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

    const bStore = useBuffStore.getState();
    const xpMult = bStore.getBuffMultiplier('xp_boost') * bStore.getBuffMultiplier('premium_xp_boost');

    // Simulate fights until time runs out or player dies
    while (timeUsed < elapsedMs && !died) {
        // Roll rarity for this fight
        const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(baseMonster.id);
        const rarity = rollMonsterRarity(false, masteryBonuses);
        const scaledMonster = applyRarityToMonster(baseMonster, rarity);

        // Simulate single fight (like resolveInstantFight)
        let mHp = scaledMonster.hp;
        let fightPHp = pHp;
        let nextPlayer = 0;
        let nextMonster = monsterAttackMs;
        let fightDmg = 0;

        for (let iter = 0; iter < 5000 && mHp > 0 && fightPHp > 0; iter++) {
            if (nextPlayer <= nextMonster) {
                // Player attacks
                if (classConfig.dualWield) {
                    const dw = calculateDualWieldDamage({
                        baseAtk: effChar.attack, weaponAtk: rollWeaponDamage(),
                        offHandAtk: rollOffHandDamage(),
                        skillBonus: classBonus.skillBonus,
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: scaledMonster.defense,
                        critChance: (effChar.crit_chance ?? 0.05) + classBonus.extraCritChance,
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    mHp = Math.max(0, mHp - dw.totalDamage);
                    fightDmg += dw.totalDamage;
                } else {
                    const r = calculateDamage({
                        baseAtk: effChar.attack, weaponAtk: rollWeaponDamage(),
                        skillBonus: classBonus.skillBonus,
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: scaledMonster.defense,
                        critChance: (effChar.crit_chance ?? 0.05) + classBonus.extraCritChance,
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    mHp = Math.max(0, mHp - r.finalDamage);
                    fightDmg += r.finalDamage;
                }
                nextPlayer += playerAttackMs;
            } else {
                // Monster attacks
                const isPhysical = !scaledMonster.magical;
                const blockChance = classConfig.canBlock ? calculateBlockChance(shieldingLevel, isPhysical) : 0;
                const dodgeChance = classConfig.canDodge ? calculateDodgeChance(char.class, skillLevels['agility'] ?? 0, isPhysical) : 0;
                const r = calculateDamage({
                    baseAtk: rollMonsterDamage(scaledMonster), weaponAtk: 0, skillBonus: 0,
                    classModifier: 1.0, enemyDefense: effChar.defense,
                    blockChance, dodgeChance,
                });
                fightPHp = Math.max(0, fightPHp - r.finalDamage);
                nextMonster += monsterAttackMs;
            }
        }

        // Estimate fight duration in real ms
        const fightDurationMs = Math.max(nextPlayer, nextMonster);
        timeUsed += fightDurationMs;

        if (mHp <= 0) {
            // Player won
            totalKills++;
            pHp = fightPHp;

            // Mastery N7: read live mastery level per kill (it can level up mid-batch)
            const catchupMasteryLvl = useMasteryStore.getState().getMasteryLevel(baseMonster.id);
            const catchupMasteryXpMult = getMasteryXpMultiplier(catchupMasteryLvl);
            const catchupMasteryGoldMult = getMasteryGoldMultiplier(catchupMasteryLvl);

            // XP (same formula as SKIP mode – 75% efficiency for offline)
            const fightXp = Math.floor(scaledMonster.xp * xpMult * catchupMasteryXpMult * 0.75);
            totalXp += fightXp;

            // Gold
            const fightGold = Math.floor(calculateGoldDrop(scaledMonster.gold) * catchupMasteryGoldMult);
            totalGold += fightGold;

            // Task & quest progress
            const taskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
            useTaskStore.getState().addKill(baseMonster.id, baseMonster.level, taskKills);
            useQuestStore.getState().addProgress('kill', baseMonster.id, taskKills);
            useQuestStore.getState().addProgress('kill_rarity', rarity, 1, baseMonster.level);
            useDailyQuestStore.getState().addProgress('kill_any', 1);
            useMasteryStore.getState().addMasteryKills(baseMonster.id, taskKills);

            // Session stats
            useCombatStore.getState().addSessionStats(fightXp, fightGold);
            useCombatStore.getState().incrementSessionKill(rarity);

            // Auto-heal between fights (regen + small heal)
            const regenPerFight = (effChar.hp_regen ?? 0) * (fightDurationMs / 1000);
            pHp = Math.min(effChar.max_hp, pHp + Math.floor(regenPerFight));

            // Apply XP to character
            const xpResult = useCharacterStore.getState().addXp(fightXp);
            if (xpResult.levelsGained > 0) {
                levelUps += xpResult.levelsGained;
            }

            // Add gold
            useInventoryStore.getState().addGold(fightGold);

            // Drop loot (offline – skip auto-sell processing to avoid spam)
            dropLootToInventory(scaledMonster, rarity, 0);
        } else {
            // Player died – stop simulation
            died = true;
            pHp = 0;
        }
    }

    // Update combat store state
    if (died) {
        // Apply death penalty
        handlePlayerDeath();
        useCombatStore.getState().setLastDrops([]);
    } else {
        // Update player HP in combat store, clamped to effective max
        const postEffChar = getEffectiveChar(useCharacterStore.getState().character);
        const postMaxHp = postEffChar?.max_hp ?? pHp;
        const postMaxMp = postEffChar?.max_mp ?? pMp;
        const clampHp = Math.min(postMaxHp, pHp);
        const clampMp = Math.min(postMaxMp, pMp);
        useCombatStore.getState().setHps(0, clampHp);
        useCharacterStore.getState().updateCharacter({ hp: clampHp, mp: clampMp });
        // Set to victory phase so auto-fight resumes
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
