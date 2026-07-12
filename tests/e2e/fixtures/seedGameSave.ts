
import { getAdminClient, withSupabaseRetry, findUserIdByEmail as cachedFindUserIdByEmail } from './adminClient';

export interface ISeedBagItem {
    uuid: string;
    itemId: string;
    rarity: string;
    bonuses: Record<string, number>;
    itemLevel: number;
    upgradeLevel?: number;
}

export interface ISeedGameSaveArgs {
    characterId: string;
    userId: string;
    gold?: number;
    consumables?: Record<string, number>;
    bagItems?: ISeedBagItem[];
    depositItems?: ISeedBagItem[];
    masteries?: Record<string, { level: number }>;
    skills?: {
        activeSkillSlots?: [string | null, string | null, string | null, string | null];
        unlockedSkills?: Record<string, boolean>;
        skillLevels?: Record<string, number>;
    };
    buffs?: ISeedBuff[];
    friends?: {
        friends?: string[];
        favorites?: string[];
        blocked?: string[];
    };
    transforms?: {
        completedTransforms?: number[];
        currentTransformQuest?: unknown;
        bakedBonusesApplied?: boolean;
        transformMigrationVersion?: number;
        pendingClaimTransformId?: number | null;
    };
}

export interface ISeedBuff {
    id: string;
    name: string;
    icon: string;
    effect: string;
    timerMode?: 'realtime' | 'pausable' | 'game';
    remainingMs?: number;
    expiresAt?: number;
    charges?: number;
    maxCharges?: number;
    gameMsRemaining?: number;
    healPctPerSec?: number;
}

export const seedGameSave = async (args: ISeedGameSaveArgs): Promise<void> => {
    const admin = getAdminClient();
    const now = new Date().toISOString();

    const state: Record<string, unknown> = {
        _ownerCharacterId: args.characterId,
        inventory: {
            _entryOwner: args.characterId,
            bag: args.bagItems ?? [],
            equipment: {
                helmet: null, armor: null, pants: null, gloves: null,
                shoulders: null, boots: null, mainHand: null, offHand: null,
                ring1: null, ring2: null, earrings: null, necklace: null,
            },
            deposit: args.depositItems ?? [],
            gold: args.gold ?? 0,
            consumables: args.consumables ?? {},
            stones: {},
        },
    };

    if (args.masteries) {
        state.mastery = {
            _entryOwner: args.characterId,
            masteries: args.masteries,
            masteryKills: {},
        };
    }

    if (args.skills) {
        state.skills = {
            _entryOwner: args.characterId,
            activeSkillSlots: args.skills.activeSkillSlots ?? [null, null, null, null],
            unlockedSkills: args.skills.unlockedSkills ?? {},
            skillLevels: args.skills.skillLevels ?? {},
            skillXp: {},
            skillUpgradeLevels: {},
            offlineTrainingSkillId: null,
            trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 0,
        };
    }

    if (args.buffs) {
        const nowMs = Date.now();
        const DAY_MS = 24 * 60 * 60 * 1000;
        state.buffs = {
            _entryOwner: args.characterId,
            allBuffs: args.buffs.map((b) => ({
                id: b.id,
                characterId: args.characterId,
                name: b.name,
                icon: b.icon,
                effect: b.effect,
                timerMode: b.timerMode ?? 'pausable',
                remainingMs: b.remainingMs ?? DAY_MS,
                expiresAt: b.expiresAt ?? (nowMs + DAY_MS),
                ...(b.charges !== undefined ? { charges: b.charges } : {}),
                ...(b.maxCharges !== undefined ? { maxCharges: b.maxCharges } : {}),
                ...(b.gameMsRemaining !== undefined ? { gameMsRemaining: b.gameMsRemaining } : {}),
                ...(b.healPctPerSec !== undefined ? { healPctPerSec: b.healPctPerSec } : {}),
            })),
        };
    }

    if (args.friends) {
        state.friends = {
            _entryOwner: args.characterId,
            friends: args.friends.friends ?? [],
            favorites: args.friends.favorites ?? [],
            blocked: args.friends.blocked ?? [],
        };
    }

    if (args.transforms) {
        state.transforms = {
            _entryOwner: args.characterId,
            completedTransforms: args.transforms.completedTransforms ?? [],
            currentTransformQuest: args.transforms.currentTransformQuest ?? null,
            bakedBonusesApplied: args.transforms.bakedBonusesApplied ?? false,
            transformMigrationVersion: args.transforms.transformMigrationVersion ?? 1,
            pendingClaimTransformId: args.transforms.pendingClaimTransformId ?? null,
        };
    }

    const { error } = await withSupabaseRetry(
        () => admin
            .from('game_saves')
            .upsert(
                {
                    user_id: args.userId,
                    character_id: args.characterId,
                    state,
                    updated_at: now,
                },
                { onConflict: 'character_id' },
            ),
    );

    if (error) {
        throw new Error(`[seedGameSave] upsert failed: ${error.message ?? JSON.stringify(error)}`);
    }
};

export const generateFillerBagItems = (count: number): ISeedBagItem[] => {
    const items: ISeedBagItem[] = [];
    for (let i = 0; i < count; i++) {
        items.push({
            uuid: `e2e-filler-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            itemId: 'small_hp_potion',
            rarity: 'common',
            bonuses: {},
            itemLevel: 1,
        });
    }
    return items;
};

export const generateDepositItem = (itemId = 'wooden_sword'): ISeedBagItem => ({
    uuid: `e2e-deposit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId,
    rarity: 'common',
    bonuses: {},
    itemLevel: 1,
});

export const findUserIdByEmail = async (email: string): Promise<string> => {
    const userId = await cachedFindUserIdByEmail(email);
    if (!userId) throw new Error(`[seedGameSave] User not found for email: ${email}`);
    return userId;
};
