/**
 * Direct-API seeder for `character_weapon_skills` rows.
 *
 * Powers BACKLOG 5.11 weapon-skill ranking tests. The Leaderboard reads
 * weapon-skill tabs (Sword / Magic / Dagger / Distance / Bard / Shield /
 * AS / HP / MP / regen / DEF / Crit / Boss) from `character_weapon_skills`
 * directly (Leaderboard.tsx linia 316-318):
 *
 *   GET /rest/v1/character_weapon_skills
 *       ?select=skill_level,skill_xp,character_id
 *       &skill_name=eq.{skillName}
 *       &order=skill_level.desc,skill_xp.desc
 *       &limit=100
 *
 * In normal play this table is populated by `syncWeaponSkillsToSupabase`
 * (`src/stores/characterScope.ts` linia 1021-1069) — periodic flush of
 * `useSkillStore.skillLevels` to a server snapshot. For E2E we INSERT
 * directly via service_role, bypassing the store + sync round-trip.
 *
 * Schema (mined from `syncWeaponSkillsToSupabase` linia 1033-1040):
 *   {
 *     character_id : uuid (FK characters.id)
 *     skill_name   : text (e.g. 'sword_fighting', 'magic_level', 'boss_score')
 *     skill_level  : int  (the rank value the leaderboard sorts on)
 *     skill_xp     : int  (secondary sort, displayed as faded pill in row)
 *     hits_count   : int  (defaults to 0 in sync — non-load-bearing)
 *     updated_at   : timestamptz
 *   }
 *
 * `boss_score` is a pseudo-skill — same table, but `skill_level` is the
 * boss-score total and `skill_xp` is the boss kill count. Leaderboard
 * uses the same weapon_skill branch to render it.
 *
 * ## Sync hook caveat
 *
 * `syncWeaponSkillsToSupabase` is THROTTLED inside `forceSaveCharacterData`
 * (characterScope.ts) — runs periodically while a character is loaded.
 * If a test triggers a real save flush AFTER seeding, the live
 * `skillLevels` from the store (probably 0/empty) gets DELETE+INSERT-ed
 * over the seed, blanking the high values.
 *
 * Mitigation: seed JUST BEFORE the `page.goto('/leaderboard')` step.
 * Read-only navigation doesn't trigger save flushes; the leaderboard
 * fetches data via REST GET, no skillStore mutations involved.
 *
 * Alternative for fully race-proof setup: ALSO seed `skills.skillLevels`
 * in `seedGameSave({ skills: { skillLevels: {...} } })` matching the
 * weapon-skill row level — then a stray sync runs DELETE + reinserts the
 * SAME value (idempotent).
 *
 * ## Cleanup
 *
 * `character_weapon_skills` is in `CHARACTER_CHILD_TABLES`
 * (`tests/e2e/fixtures/cleanup.ts` linia 84), so
 * `cleanupCharacterById(charId)` wipes seeded rows automatically.
 */

import { getAdminClient, withSupabaseRetry } from './adminClient';

export interface ISeedWeaponSkillArgs {
    /** Character ID from `createCharacterViaApi` result. */
    characterId: string;
    /** Skill key (e.g. 'sword_fighting', 'magic_level', 'boss_score'). */
    skillName: string;
    /** Skill level — primary sort key for the leaderboard. */
    skillLevel: number;
    /** Skill XP — secondary sort + faded pill in the row. Default 0. */
    skillXp?: number;
}

/**
 * Upsert (delete+insert) a single character_weapon_skills row.
 *
 * Why delete+insert rather than upsert: the table doesn't have a
 * unique constraint on (character_id, skill_name) per the production
 * sync code's comment ("avoids dependency on a unique constraint that
 * may not exist"). So we mimic the same strategy.
 *
 * @example
 * await seedWeaponSkill({
 *   characterId: created.id,
 *   skillName: 'sword_fighting',
 *   skillLevel: 999,
 *   skillXp: 0,
 * });
 * // Now /leaderboard Sword tab top-100 will include this row.
 */
export const seedWeaponSkill = async (
    args: ISeedWeaponSkillArgs,
): Promise<void> => {
    const admin = getAdminClient();

    // Delete existing row (idempotent — no row = no-op).
    const { error: delErr } = await withSupabaseRetry(
        () => admin
            .from('character_weapon_skills')
            .delete()
            .eq('character_id', args.characterId)
            .eq('skill_name', args.skillName),
    );
    if (delErr) {
        throw new Error(`[seedWeaponSkill] delete failed: ${delErr.message ?? JSON.stringify(delErr)}`);
    }

    // Insert fresh row matching schema in syncWeaponSkillsToSupabase
    // (characterScope.ts linia 1033-1040).
    const { error: insErr } = await withSupabaseRetry(
        () => admin
            .from('character_weapon_skills')
            .insert({
                character_id: args.characterId,
                skill_name: args.skillName,
                skill_level: args.skillLevel,
                skill_xp: args.skillXp ?? 0,
                hits_count: 0,
                updated_at: new Date().toISOString(),
            }),
    );
    if (insErr) {
        throw new Error(`[seedWeaponSkill] insert failed: ${insErr.message ?? JSON.stringify(insErr)}`);
    }
};
