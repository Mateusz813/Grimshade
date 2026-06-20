/**
 * Guild progression + boss-scaling helpers.
 *
 * The XP curve is steep on purpose — the spec calls out that "każdy
 * poziom gildii jest bardzo ciężko wbić i każdy kolejny jest coraz
 * trudniejszy", so each level multiplies the prior threshold rather
 * than adding a flat delta. Member cap rises by +1 per level on top
 * of the level-1 baseline of 20, which dovetails with the weekly
 * boss tier increase (kill the boss -> +1 tier next week -> harder
 * fight, better rewards).
 */

/** Initial members allowed in a fresh guild. Spec: "Na początku limit
 *  graczy w gildii to 20." */
export const GUILD_INITIAL_MEMBER_CAP = 20;

/** Cost (in gold) of creating a guild. Spec: "stworzenie gildie kosztuje
 *  10 cc golda" — and per `goldFormat.ts` the cc tier is 100 000 gp,
 *  so 10 cc = 1 000 000 gp (NOT 10 000 000 — earlier draft assumed
 *  1 cc = 1 000 000 which was off by an order of magnitude). */
export const GUILD_CREATE_COST_GOLD = 1_000_000;

/** No upper bound on guild level — spec ("nie ma limitu na maksymalny
 *  poziom gildii"). Kept as a sentinel so any UI that needs to format
 *  the value (e.g. "Lvl X/MAX") can still reference it; we set it to
 *  `Number.POSITIVE_INFINITY` so display-side checks `level >= MAX`
 *  naturally read as false for every reachable level. */
export const GUILD_MAX_LEVEL = Number.POSITIVE_INFINITY;

/** Maximum boss tier — currently 50 art tiers shipped
 *  (loch-1..loch-50). 2026-05-19 v21 spec ("dodalem bossow do
 *  poziomu 50 wiec dodaj wszystkie bossy w lochach do poziomu 50
 *  i poziom 50 jest ostatnim po nim boss 50 powtarza sie"): once a
 *  guild grinds past tier 50, the weekly fight stays pinned at the
 *  tier-50 art + spell kit until a new pack ships. */
export const GUILD_BOSS_MAX_TIER = 50;

/** Clamp a tier to [1, GUILD_BOSS_MAX_TIER]. */
export const clampGuildBossTier = (tier: number): number => {
    if (!Number.isFinite(tier) || tier < 1) return 1;
    if (tier > GUILD_BOSS_MAX_TIER) return GUILD_BOSS_MAX_TIER;
    return Math.floor(tier);
};

/** Treasury slot cap. Spec: "skarbiec gildii w którym jest 1000 miejsca." */
export const GUILD_TREASURY_SLOTS = 1000;

/** Heroic-drop max chance from a fully-cleared boss. Spec: "musi być
 *  szansa na dropniecie przedmiotu HEROIC ale nie większą niż 1%". */
export const GUILD_BOSS_HEROIC_MAX_CHANCE = 0.01;

/** Per-attack HP percentage gate. Spec: "Pierwsza osoba jak zabije
 *  bossowi 10 % HP to kolejna walczy jak już ma 90 % HP" — i.e. an
 *  active fighter holds the arena until they've taken 10 % of the
 *  boss's max HP (or the boss dies, or they flee). */
export const GUILD_BOSS_BLOCK_PCT = 0.10;

/**
 * XP required to advance from `level` -> `level + 1`. Spec 2026-05-18
 * v12 ("zabicie bossa za 1 LVL dal maksymalnie 1 poziom gildi a nie
 * 20, tak samo kolejne poziomy maja byc jeszcze trudniejsze do
 * wbicia, czyli trzeba wtedy zabic 2x bossa na 2 LVL i kolejny 3x
 * bossa na 3 lvl i tak dalej"): each level costs as much XP as
 * **N kills of a tier-N boss**, where N = current guild level. Since
 * "1 HP dealt = 1 guild XP", the formula is literally
 * `level × getGuildBossMaxHp(level)`. So:
 *   L1 -> L2:  1 × 15M           = 15M XP   (one tier-1 kill)
 *   L2 -> L3:  2 × 23.25M         = 46.5M XP (two tier-2 kills)
 *   L3 -> L4:  3 × 36M            = 108M XP (three tier-3 kills)
 *   L4 -> L5:  4 × 55.8M          = 223M XP (four tier-4 kills)
 *   L10 -> L11:10 × ~1.1B         = ~11B  XP (ten tier-10 kills)
 *   L20 -> L21:20 × ~1.1B (tier capped at 10) ≈ ~22B XP
 * No upper bound — once a guild grinds past tier 10, the boss tier
 * stays clamped but the level cost keeps climbing linearly.
 */
export const guildXpToNextLevel = (level: number): number => {
    if (level <= 0) return 0;
    const tierForLevel = clampGuildBossTier(level);
    return Math.floor(level * getGuildBossMaxHp(tierForLevel));
};

/** Total XP required to reach `level` from level 1. Useful for the
 *  level-up progress bar that sums every step. */
export const guildXpForLevel = (level: number): number => {
    let total = 0;
    for (let l = 1; l < level; l++) {
        total += guildXpToNextLevel(l);
    }
    return total;
};

/** Member cap derived from level. Level 1 grants 20 slots; every
 *  level above 1 adds one extra slot. */
export const guildMemberCap = (level: number): number => {
    return GUILD_INITIAL_MEMBER_CAP + Math.max(0, level - 1);
};

/**
 * Apply XP gain — returns the new level/xp tuple plus a boolean
 * `leveledUp` so the UI can fire a celebratory popup. Stacks multiple
 * level-ups in a single call when the gain bridges multiple thresholds
 * (e.g. a Sunday boss claim that ships 10× the daily haul).
 *
 * 2026-05-18 v12: no max-level guard — guild level grows without
 * bound. The new XP curve scales linearly per level (cost = level ×
 * boss-tier HP), so even an absurdly large single haul can only ever
 * roll forward a finite number of levels before `xp` drops below the
 * next threshold and the loop terminates naturally.
 */
export const applyGuildXp = (
    currentLevel: number,
    currentXp: number,
    gain: number,
): { level: number; xp: number; leveledUp: boolean } => {
    let level = currentLevel;
    let xp = currentXp + Math.max(0, gain);
    let leveled = false;
    while (xp >= guildXpToNextLevel(level)) {
        xp -= guildXpToNextLevel(level);
        level += 1;
        leveled = true;
    }
    return { level, xp, leveledUp: leveled };
};

/**
 * Boss-tier scaling. Tier 1 starts at a baseline strong enough that
 * a single member CANNOT solo it within their daily attack — they
 * shave a chunk off and another mate has to step in. Higher tiers
 * scale super-linearly so the difficulty climbs as the guild does.
 *
 * Per-attack damage scales by character level (engine-side, not
 * here); the boss HP scaling here just keeps the fight WEEK-long
 * for an active 20-member guild.
 *
 * The "1 HP = 1 guild XP" rule lives in the API (it credits XP per
 * damage event) — the multiplier here purposefully keeps tier 1
 * around the 15M HP mark so a level-1 guild that does kill it banks
 * 15M XP, enough to vault several levels at once and feel rewarding.
 *
 * 2026-05-18 v10 spec ("Mam wrazenie ze bossy sa troche za slabe bo
 * 400 LVL bez przedmiotow bez problemu zabil sam bossa na 1 LVL"):
 * tier 1 HP bumped 6M -> 15M (×2.5) and the per-tier multiplier
 * stepped from 1.45 -> 1.55 so the curve climbs faster — tier 10 is
 * now ~ 15M × 1.55^9 ≈ 1.9B HP (was ~ 240M).
 */
// 2026-06-18 balance pass: the old curve (15M × 1.55^tier for HP while per-swing
// damage SHRANK ×1.15^tier) diverged — tier 20+ needed tens of millions of swings
// and was mathematically unkillable. New curve: gentler HP growth (×1.25/tier from
// a 2M base) PLUS per-swing damage that scales UP with tier (see computeGuildBossDamage),
// so every tier stays a week-long-but-achievable fight for a real guild.
export const getGuildBossMaxHp = (tier: number): number => {
    const tBoss = Math.max(1, tier);
    return Math.floor(2_000_000 * Math.pow(1.25, tBoss - 1));
};

/** Boss's incoming damage per character attack. Scales with the
 *  character's level so a fresh recruit and a level-1000 veteran
 *  both feel a meaningful contribution. Tuned so an average member
 *  shaves 5–15 % of boss HP per attack at low tiers, less at high.
 *  Spec: each HP dealt = 1 guild XP; this caps a single attack at
 *  ~5 % of boss max so the block-gate trigger fires reliably.
 *
 *  2026-05-18 v10 spec ("400 LVL bez przedmiotow bez problemu zabil
 *  sam bossa"): level-scaling softened from `1 + level/50` (9× at
 *  level 400) to `1 + level/120` (≈4.3× at level 400), and the
 *  per-hit hard cap dropped from 15% -> 5% of boss max HP so even a
 *  level-1000 veteran needs 20+ swings to take a tier-1 boss down. */
export const computeGuildBossDamage = (
    characterAttack: number,
    characterLevel: number,
    tier: number,
): number => {
    const tBoss = Math.max(1, tier);
    // Base = char attack × (1 + level/120) — gentler level multiplier
    // so very high level characters still hit a meaningful number, but
    // don't soar past mid-tier players by an order of magnitude.
    const base = Math.max(1, characterAttack) * (1 + characterLevel / 120);
    // 2026-06-18 balance pass: per-swing damage now scales UP with tier
    // (+5%/tier) instead of DOWN (÷1.15^tier). Combined with the gentler HP
    // curve this keeps every tier finite — a real guild clears a
    // tier-appropriate boss over a week of attempts instead of needing
    // millions of swings at high tiers.
    const scaled = base * (1 + (tBoss - 1) * 0.05);
    // Hard cap each attack at 5 % of boss max HP so a single veteran can't
    // solo it and the guild always shares the kill (≥20 swings minimum).
    const cap = Math.floor(getGuildBossMaxHp(tier) * 0.05);
    return Math.max(1, Math.min(cap, Math.floor(scaled)));
};

/**
 * Compute the start-of-week boundary (Monday 00:00 UTC) for a given
 * timestamp. Used to key the weekly boss row + contributions log.
 * Sunday's date counts as the PREVIOUS Monday's week so the claim
 * window naturally lands inside the same `week_start`.
 */
export const getCurrentWeekStartIso = (now: Date = new Date()): string => {
    const d = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0, 0,
    ));
    // Mon=1 ... Sun=7 (ISO). JS Date returns Sun=0..Sat=6, so shift
    // Sunday to 7 so the offset math always subtracts to the prior
    // Monday rather than jumping forward.
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    return d.toISOString().slice(0, 10);
};

/** Are we currently in the Sunday claim window? Fighting is locked
 *  on Sunday — only reward claim allowed. */
export const isGuildBossClaimDay = (now: Date = new Date()): boolean => {
    return now.getUTCDay() === 0; // Sun
};

/** YYYY-MM-DD for the per-attempt unique key. */
export const getTodayIso = (now: Date = new Date()): string => {
    return now.toISOString().slice(0, 10);
};

/**
 * Drop-chance bias from contribution share. Used everywhere in the
 * reward roller — gold / XP / stones / mikstury / item drop chance
 * all scale linearly off this number.
 *
 * 2026-05-18 v11 spec ("Tym wiecej HP zabiore bossowi tym lepsze
 * nagrody dostane tak?"): YES — strictly proportional. The
 * multiplier now climbs from 0.05× at "barely tagged" to 2.0× when
 * a single member soloed the entire boss, with NO middle plateau.
 * Old curve `share * 2` capped at 1.0× by 50 % damage so anyone
 * doing 60 %, 80 % or 100 % all got the same loot — that hid the
 * "more damage = more reward" link the spec asks for. New curve
 * `0.1 + share × 1.9` (floor 0.05) keeps every percentage point
 * meaningful: 10 % share -> 0.29×, 50 % -> 1.05×, 100 % -> 2.00×.
 */
export const contributionMultiplier = (
    damageDealt: number,
    bossMaxHp: number,
): number => {
    if (bossMaxHp <= 0) return 0;
    const share = Math.min(1, damageDealt / bossMaxHp);
    return Math.max(0.05, 0.1 + share * 1.9);
};
