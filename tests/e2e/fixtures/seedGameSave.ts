/**
 * Direct-API game_save seeder via service_role.
 *
 * Writes (or overwrites) a row in `game_saves` for a given character so
 * the next time the player selects them, `switchToCharacter` →
 * `loadGame` returns this blob and every per-character store
 * (inventoryStore, skillStore, taskStore, …) rehydrates with our seeded
 * values BEFORE the player interacts with the UI.
 *
 * Why this exists:
 *   `createCharacterViaApi` only writes the `characters` row (level, hp,
 *   stat_points, base `gold` column). `inventoryStore.gold` is
 *   re-hydrated from the `inventory.gold` slice of the `game_saves`
 *   blob — NOT from `characters.gold` — so a seeded character with
 *   `characters.gold = 100000` would still see `inventoryStore.gold = 0`
 *   in the Shop UI until they earn or sell something. For tests that
 *   need the player to have real spendable currency (e.g. "buy item
 *   from shop"), we MUST seed the game_save too.
 *
 * Blob shape mirrors `STORE_ENTRIES` in `src/stores/characterScope.ts`:
 *   - Each baseKey ('inventory', 'skills', 'tasks', ...) → object with
 *     only the keys listed in `stateKeys` (other keys are silently
 *     filtered by `applyBlobToStores`).
 *   - `_ownerCharacterId` + per-entry `_entryOwner` stamps prevent the
 *     blob from being applied to a wrong character if a switch races.
 *   - `_characterStats` reflects the characters-row values on disk (only
 *     written, never read back).
 *
 * Architectural notes (2026-05-25):
 *
 * 1. **Service role only** — bypasses RLS so we can `.upsert` into
 *    `game_saves` regardless of which user owns the character. Same
 *    pattern as `createCharacterViaApi` and `cleanup.ts`.
 *
 * 2. **Upsert on `character_id`** — game_saves table has a unique
 *    constraint on character_id (one save per character). Re-running
 *    a test overwrites whatever was there.
 *
 * 3. **Cleanup is automatic** — `cleanupCharacterById` already includes
 *    `game_saves` in `CHARACTER_CHILD_TABLES`, so the same `finally`
 *    block that nukes the character also nukes the seeded save.
 *
 * 4. **No `bag` seeding yet** — current tests only need gold +
 *    consumables. If a future test needs a pre-populated bag (e.g.
 *    "sell all" / "mass-disassemble"), add an `bag` array param here
 *    matching the `IInventoryItem` shape from `itemSystem.ts`.
 *    For "bag full" edge-case tests you can pass 1000 dummy items
 *    via `bagItems` (each needs `uuid`, `itemId`, `rarity`, `bonuses`,
 *    `itemLevel`).
 */

// Admin client + user lookup są w shared `adminClient.ts` — cached
// per-worker. Stary duplikat tutaj robił własny listUsers per call →
// CPU NANO compute 82% w jednym test runie (2026-05-25 incident).
import { getAdminClient, withSupabaseRetry, findUserIdByEmail as cachedFindUserIdByEmail } from './adminClient';

/** Minimal IInventoryItem shape — only what's needed to satisfy the
 *  in-bag persistence path. UUID + itemId + rarity + bonuses + level. */
export interface ISeedBagItem {
    uuid: string;
    itemId: string;
    rarity: string;
    bonuses: Record<string, number>;
    itemLevel: number;
    upgradeLevel?: number;
}

export interface ISeedGameSaveArgs {
    /** Character UUID (from `createCharacterViaApi` result). */
    characterId: string;
    /** Auth user UUID — must match `characters.user_id`. */
    userId: string;
    /** Starting gold the player will see in inventoryStore.gold. Default 0. */
    gold?: number;
    /** Consumable counts (id → quantity), e.g. `{ hp_potion_sm: 5 }`. */
    consumables?: Record<string, number>;
    /** Pre-populated bag items. For "bag full" tests pass 1000 entries. */
    bagItems?: ISeedBagItem[];
    /**
     * Pre-populated deposit items (max 10000). Used by `/deposit` tests
     * that need real items in the deposit panel — e.g. "take with full
     * bag" → seed 1 item w deposit + 1000 items w bagu → tap take → item
     * stays in deposit because bag.length >= MAX_BAG_SIZE in
     * `inventoryStore.withdrawItem` (linia 516 inventoryStore.ts).
     */
    depositItems?: ISeedBagItem[];
    /**
     * Mastery levels per-monster — np. `{ rat: 25 }` ustawia Mastery
     * 25/25 dla Szczura. Wkleja się do `state.mastery.masteries` slice
     * (per `STORE_ENTRIES['mastery']` w `src/stores/characterScope.ts`).
     * Test "Mastery 25/25 → purple border" seeduje tu MASTERY_MAX_LEVEL
     * (=25) i sprawdza class `combat__mcard--mastery-max` na karcie
     * w `/monsters`.
     */
    masteries?: Record<string, { level: number }>;
    /**
     * Active skill bar state — pre-equips skills + marks them unlocked
     * so the player walks into combat with a populated action bar.
     *
     * Passed verbatim to the `skills` slice persisted by
     * `STORE_ENTRIES['skills']` (see `src/stores/characterScope.ts` linia
     * 181-198). `activeSkillSlots` is a length-4 tuple matching
     * `useSkillStore.activeSkillSlots`; nulls = empty slots.
     * `unlockedSkills` is a flag map keyed by skill id (e.g.
     * `{ shield_bash: true }`) — without this entry the skill is treated
     * as "not purchased yet" by `unlockedSkills.get(id)` checks even if
     * it's slotted, so the slot stays disabled.
     *
     * Use case: BACKLOG.md 12.5 — per-class skill smoke E2E. Seed
     * tier-1 spell (unlockLevel 5) of each class into slot 0 + flag it
     * unlocked, raise character level above its unlockLevel, jump into
     * combat → verify action bar renders the skill button.
     */
    skills?: {
        activeSkillSlots?: [string | null, string | null, string | null, string | null];
        unlockedSkills?: Record<string, boolean>;
        /** Optional skill levels (id → level). Defaults skip — combat
         *  doesn't need a non-zero weapon-skill level to render the
         *  action bar. Provide only when a test asserts something tied to
         *  weapon-skill XP / level. */
        skillLevels?: Record<string, number>;
    };
    /**
     * Active buffs slice — persists into `state.buffs.allBuffs` per
     * `STORE_ENTRIES['buffs']` (characterScope.ts ~line 294-298). Each
     * entry mirrors `IActiveBuff` from `src/stores/buffStore.ts`:
     *   { id, characterId, name, icon, effect, expiresAt, timerMode,
     *     remainingMs, charges?, maxCharges?, gameMsRemaining?,
     *     healPctPerSec? }
     *
     * Use case: HP/MP consistency tests (BACKLOG 3.5, 3.6, 3.10) need an
     * active elixir buff (e.g. `hp_pct_25`, `hp_boost_500`) so the effective
     * max HP differs from `characters.max_hp` and we can verify every UI
     * surface reads the SAME effective value.
     *
     * Helper enforces:
     *  • `characterId === args.characterId` (overwritten regardless of
     *    what caller passes — guard against owner-mismatch bugs).
     *  • Pausable buffs that haven't been seeded with `remainingMs` get a
     *    very large default (24h in ms) so they survive the entire test
     *    even if combat starts and ticks once.
     *  • Realtime buffs that haven't been seeded with `expiresAt` get a
     *    timestamp 24h in the future.
     *
     * The caller is still responsible for picking a valid `effect` that
     * matches `BUFF_CONFIG` in `src/views/Inventory/Inventory.tsx` (see
     * lines ~2580-2620). Common effects:
     *  • `hp_pct_25` → +25% Max HP (pausable)
     *  • `hp_boost_500` → +500 Max HP (pausable)
     *  • `mp_pct_25` → +25% Max MP (pausable)
     *  • `mp_boost_500` → +500 Max MP (pausable)
     *
     * NOTE: pausable buff timers only tick during combat
     * (`tickCombatElixirs`). Out-of-combat assertions (Town /
     * CharacterSelect / TopHeader popover) are race-free — the buff stays
     * active for the entire test.
     */
    buffs?: ISeedBuff[];
    /**
     * Friends-store slice — primes the per-character `friends`, `favorites`,
     * and `blocked` lists. Persisted via the `friends` STORE_ENTRY in
     * `src/stores/characterScope.ts` (linia ~348).
     *
     * **Why we seed this rather than going through the UI add-flow**:
     * `friendsApi.findByName` queries `characters` with the current user's
     * Bearer token, and RLS on that table restricts SELECT to rows owned
     * by the calling user. So the "search for another player's nick" UI
     * flow returns "Nie znaleziono" cross-user under the current RLS
     * config — the only way to land a friend row on `useFriendsStore`
     * deterministically in E2E is to seed it. The rendering side
     * (`Friends.tsx` row paint, "💌 PM" button, "🚫 Zablokuj" flow) is
     * unaffected by the RLS limitation because it reads from the local
     * store, not Supabase.
     *
     * `favorites` MUST be a subset of `friends` — the UI gracefully
     * handles mismatches but real flow guarantees it via
     * `toggleFavorite` requiring `friends.includes(name)`.
     */
    friends?: {
        friends?: string[];
        favorites?: string[];
        blocked?: string[];
    };
    /**
     * Transforms slice — pre-populates `completedTransforms` + flags.
     * Persists into `state.transforms` per `STORE_ENTRIES['transforms']`
     * (characterScope.ts linia 300-314), `stateKeys` allow-lists
     * `['completedTransforms', 'currentTransformQuest', 'bakedBonusesApplied',
     * 'pendingClaimTransformId']`.
     *
     * Use case: BACKLOG 8.1 — Stats popup pełna agregacja włącznie z
     * transform contribution. Seed `completedTransforms: [1]` +
     * `bakedBonusesApplied: false` żeby `getLiveTransformBreakdown`
     * (`src/systems/transformBonuses.ts` linia 191) zwracało `active: true`
     * + per-class bonuses (Knight tier 1: flatHp=420, hpPercent=4).
     *
     * **CRITICAL caveat — legacy migration**: characterScope.ts linia 436-446
     * checks `localStorage['tibia_transform_migration_v1_<charId>']` po
     * hydration. Brak markera → wymusza `bakedBonusesApplied: true` i
     * odpala `migrateLegacyBakedBonuses` (MUTUJE character.max_hp etc.).
     * Test MUSI ustawić marker via `page.addInitScript` ZANIM character
     * jest pickany, inaczej (a) bonusy są zbaked w stats (active=false),
     * (b) max_hp i defense są zmienione. Seedem `bakedBonusesApplied=false`
     * pomaga TYLKO gdy marker już jest — bez markera blok wymusza true.
     */
    transforms?: {
        completedTransforms?: number[];
        currentTransformQuest?: unknown;
        /**
         * Default `false`. Set `true` żeby symulować legacy save (bonusy
         * zbaked w stats; `getLiveTransformBreakdown.active=false`).
         */
        bakedBonusesApplied?: boolean;
        pendingClaimTransformId?: number | null;
    };
}

/**
 * Seed shape for active buffs. Mirrors a subset of `IActiveBuff` from
 * `src/stores/buffStore.ts` line 20. `characterId` is filled in by
 * `seedGameSave` (do not pre-set — helper overwrites).
 */
export interface ISeedBuff {
    /** Buff id (matches BUFF_CONFIG[<dose_id>].id), e.g. `'hp_pct_25'`. */
    id: string;
    /** Display name shown in BuffPopover row. Free text. */
    name: string;
    /** Display icon (emoji). */
    icon: string;
    /** Effect key that triggers downstream multipliers, e.g. `'hp_pct_25'`. */
    effect: string;
    /** 'realtime' | 'pausable' | 'game'. Default 'pausable' (test-friendly — no clock drain). */
    timerMode?: 'realtime' | 'pausable' | 'game';
    /** Pausable buffs — ms remaining. Default 86_400_000 (24h). */
    remainingMs?: number;
    /** Realtime buffs — unix ms when expires. Default now + 24h. */
    expiresAt?: number;
    /** Charge-based buffs (Krok Cienia family). Optional. */
    charges?: number;
    maxCharges?: number;
    /** Game-time buffs — ms remaining at speed-scaled drain. Optional. */
    gameMsRemaining?: number;
    /** Heal-over-time payload (Cleric blessing). Optional. */
    healPctPerSec?: number;
}

/**
 * Upsert a game_save row that primes the per-character stores with the
 * desired starting state. Idempotent — re-running overwrites.
 *
 * @example
 * const created = await createCharacterViaApi({ ..., overrides: { gold: 100000 } });
 * const userId = await findUserIdByEmail(testUsers.primary.email);
 * await seedGameSave({
 *   characterId: created.id,
 *   userId,
 *   gold: 100000,
 * });
 * // Now login + select character → Shop sees 100,000 gold.
 */
export const seedGameSave = async (args: ISeedGameSaveArgs): Promise<void> => {
    const admin = getAdminClient();
    const now = new Date().toISOString();

    // Build the per-store slice blob. `_entryOwner` mirrors the
    // owner-stamp that `forceSaveCharacterData` writes when the game
    // saves naturally — characterScope's `applyBlobToStores` checks it
    // and refuses to apply blob with mismatched owner.
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

    // Mastery slice — only added when caller passes `masteries`. Empty
    // object would still seed a valid blob (masteries={}) but skipping
    // saves a little space + makes it explicit which tests touch mastery.
    // `masteryKills: {}` because we're "past" any per-level kill grind —
    // the seeded level already implies all required kills happened.
    if (args.masteries) {
        state.mastery = {
            _entryOwner: args.characterId,
            masteries: args.masteries,
            masteryKills: {},
        };
    }

    // Skills slice — only added when caller passes `skills`. Matches the
    // `stateKeys` allowlist for the `skills` STORE_ENTRY (linia 191-197
    // of characterScope.ts) — unlisted keys would be silently dropped by
    // `applyBlobToStores`. We feed minimal fields needed by combat:
    // activeSkillSlots (so slots render in action bar), unlockedSkills
    // (so the slot isn't treated as "not purchased" → disabled), plus
    // optional skillLevels. Other persisted keys (skillXp,
    // skillUpgradeLevels, offlineTrainingSkillId, trainingSegmentStartedAt,
    // trainingAccumulatedEffectiveSeconds) default to {}/null which is
    // safe — combat doesn't read them.
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

    // Buffs slice — only added when caller passes `buffs`. Each entry gets
    // its `characterId` stamped to args.characterId (overwriting whatever
    // the caller passed) so the per-character filter in BuffPopover /
    // getEffectiveChar / getElixirHpBonus works correctly. Defaults fill
    // in `timerMode='pausable'`, `remainingMs=24h`, `expiresAt=now+24h` so
    // a minimal seed `{ id, name, icon, effect }` already produces an
    // active, persistent buff. Pausable buffs are test-friendly because
    // their timer only drains during combat — out-of-combat assertions
    // are race-free.
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

    // Friends slice — local-per-character social graph. Lists hold
    // character NAMES (not UUIDs) per the store's design — names are
    // used directly for `friendsApi.findManyByName` lookups + PM
    // channel ids (`buildPmChannel` lower-cases & sorts the pair).
    // `stateKeys` for the `friends` STORE_ENTRY allow-lists exactly
    // `['friends', 'favorites', 'blocked']` (characterScope.ts line
    // 352), so any other keys passed here would be silently dropped.
    if (args.friends) {
        state.friends = {
            _entryOwner: args.characterId,
            friends: args.friends.friends ?? [],
            favorites: args.friends.favorites ?? [],
            blocked: args.friends.blocked ?? [],
        };
    }

    // Transforms slice — `completedTransforms` array + 3 flag keys per
    // `STORE_ENTRIES['transforms']` allow-list. Only added when caller
    // passes `args.transforms`. See ISeedGameSaveArgs.transforms for the
    // critical localStorage marker caveat (legacy migration WILL force
    // bakedBonusesApplied=true if marker missing).
    if (args.transforms) {
        state.transforms = {
            _entryOwner: args.characterId,
            completedTransforms: args.transforms.completedTransforms ?? [],
            currentTransformQuest: args.transforms.currentTransformQuest ?? null,
            bakedBonusesApplied: args.transforms.bakedBonusesApplied ?? false,
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

/**
 * Generate N "filler" bag items to consume slots. Used by bag-full edge
 * cases. Items are deterministic common-rarity placeholders — the test
 * doesn't care what they are, only that they fill the bag.
 *
 * `itemId` is set to "small_hp_potion" so it's a valid entry in
 * `items.json` (won't crash any UI tile that looks it up by id) — but
 * because it has `uuid`, the store treats it as a discrete bag slot,
 * NOT a stack like consumables.
 */
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

/**
 * Generate a single deterministic "real" item (default: wooden_sword)
 * that renders a clickable tile in `/deposit`. Default-args version of
 * generateFillerBagItems suited for tests that want **one** identifiable
 * item w deposit żeby tap-nąć po nazwie, nie po countcie.
 *
 * Use case: `city/deposit/take-with-full-inventory.spec.ts` seeduje
 * 1000 itemów w bagu + 1 item w deposit, próbuje tap-nąć tile w deposit,
 * weryfikuje że item zostaje (bo `withdrawItem` w `inventoryStore.ts`
 * linia 516 zwraca false gdy `bag.length >= MAX_BAG_SIZE`).
 */
export const generateDepositItem = (itemId = 'wooden_sword'): ISeedBagItem => ({
    uuid: `e2e-deposit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId,
    rarity: 'common',
    bonuses: {},
    itemLevel: 1,
});

/**
 * Find a Supabase auth user-id by email. Forwards to cached implementation
 * in `adminClient.ts` (per-worker Map cache). Throws if not found.
 */
export const findUserIdByEmail = async (email: string): Promise<string> => {
    const userId = await cachedFindUserIdByEmail(email);
    if (!userId) throw new Error(`[seedGameSave] User not found for email: ${email}`);
    return userId;
};
