// ── Character ────────────────────────────────────────────────────────────────
export type { ICharacter, TCharacterClass, ICharacterPayload, IXpGainResult } from './character';

// ── Item ─────────────────────────────────────────────────────────────────────
export type { IBaseItem, IInventoryItem, IItemStats, IEquipment, TEquipmentSlot, TRarity } from './item';

// ── Monster ──────────────────────────────────────────────────────────────────
export type { IMonster, TMonsterRarity } from './monster';

// ── Combat ───────────────────────────────────────────────────────────────────
export type { ICombatParams, ICombatResult, ICombatLogEntry, TCombatPhase, TCombatSpeed, ICombatState } from './combat';

// ── Skill ────────────────────────────────────────────────────────────────────
export type { ISkill, IWeaponSkill, IActiveSkill, ICharacterSkill, ISkillState, TSkillMode } from './skill';

// ── Quest ────────────────────────────────────────────────────────────────────
export type { IQuest, IQuestGoal, IQuestReward, IActiveQuest, TQuestGoalType, TQuestRewardType } from './quest';

// ── Task ─────────────────────────────────────────────────────────────────────
export type { ITask, IActiveTask, ICompletedTask } from './task';

// ── Dungeon ──────────────────────────────────────────────────────────────────
export type { IDungeon, IDungeonMonster, IDungeonResult, IDungeonDropEntry } from './dungeon';

// ── Boss ─────────────────────────────────────────────────────────────────────
export type { IBoss, IBossResult, IBossDropEntry, IBossUniqueItem } from './boss';

// ── Party ────────────────────────────────────────────────────────────────────
export type { IPartyMember, IPartyInfo } from './party';

// ── Shop ─────────────────────────────────────────────────────────────────────
export type { IElixir, IShopItem, TBuyResult } from './shop';

// ── Bot ──────────────────────────────────────────────────────────────────────
export type { IBot, IBotAction } from './bot';

// ── Loot ─────────────────────────────────────────────────────────────────────
export type { IDropTableEntry, IGeneratedItem, ILootResult } from './loot';
