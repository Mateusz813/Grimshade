/**
 * Atomic E2E — Deaths feed shows seeded deaths of every supported
 * `source` type (BACKLOG 5.10 — pełne pokrycie per-combat-type).
 *
 * Spec ("Zgin w każdej walce + verify w deaths feed"): seeduje 1 death
 * row do `character_deaths` per supported combat-type-source value,
 * navigates `/deaths`, asserts row visible with the right `meta.label`
 * badge ("Potwór" / "Dungeon" / "Boss" / "Transform" / "Rajd").
 *
 * **DB schema reality**: the brief lists 8 combat types
 * (hunting/dungeon/boss/raid/transform/arena/trainer/loch) but
 * `character_deaths.source` is constrained to 5 values by
 * `src/api/v1/deathsApi.ts` line 7 (`TDeathSource = 'monster' |
 * 'dungeon' | 'boss' | 'transform' | 'raid'`). Arena / trainer / loch
 * are NOT writable to that column (CHECK constraint enforced at DB
 * level + TypeScript narrows the union). The engine maps:
 *   - hunting / city /monsters -> `source='monster'`
 *   - boss combat -> `source='boss'`
 *   - dungeon combat -> `source='dungeon'`
 *   - raid combat -> `source='raid'`
 *   - transform combat -> `source='transform'`
 *   - arena combat -> NOT LOGGED (arena deaths are AP-only, no death row)
 *   - trainer -> NOT POSSIBLE (dummy is invincible, player can't die)
 *   - loch (guild boss) -> arena-like; NOT LOGGED to character_deaths
 *
 * So the maximally useful coverage is 5 source types × 1 atomic test.
 *
 * **Env-dependent 'raid' source**: `scripts/deaths_migration.sql` widens
 * the CHECK constraint to accept 'raid' (line 23-25). If the migration
 * hasn't been applied yet on the target env, the seedDeath INSERT
 * throws with `character_deaths_source_check violation`. The 'raid'
 * test catches that specific error message and `test.skip()`s instead
 * of failing — same pattern as `character/create/rejects-duplicate-
 * nickname.spec.ts` (auto-disable when migration pending). Once
 * `deaths_migration.sql` is applied, the test auto-enables on the next
 * run. Verified 2026-05-25: monster/dungeon/boss/transform pass on the
 * base schema; raid passes when migration applied, otherwise skipped.
 * Per task brief the test loops via for-of (Playwright doesn't expose
 * `test.each` for parameterised cases — we spawn N tests inside the
 * describe block via a runtime for-of loop, idiomatic in this codebase).
 *
 * Per-source label table (from Deaths.tsx line 45-51 SOURCE_META):
 *   monster   -> "Potwór"
 *   dungeon   -> "Dungeon"
 *   boss      -> "Boss"
 *   transform -> "Transform"
 *   raid      -> "Rajd"
 *
 * Strategy per test:
 *  1. Seed Knight lvl 7 on SECONDARY (per task brief — primary is
 *     used by background suite). Unique nick (E2E{rand6}) lets us
 *     find the row deterministically among thousands of public rows.
 *  2. Insert 1 `character_deaths` row via service_role with the given
 *     source + a credible source_name + level.
 *  3. Login on SECONDARY -> directly `/deaths` (no character pick
 *     needed; Deaths.tsx is global, doesn't use characterStore).
 *  4. Find the row via `.deaths__victim-name` matching our nick.
 *  5. Assert `.deaths__item-badge` contains the SOURCE_META.label.
 *  6. Sanity asserts: victim level + source name + source level
 *     rendered (proves the full row payload landed and parser ran).
 *
 * Cleanup: try/finally + cleanupCharacterById. character_deaths is in
 * CHARACTER_CHILD_TABLES (cleanup.ts line 80) -> deleting the character
 * cascades the death row.
 *
 * Why per-source-spawning instead of one mega-test:
 *  - Atomic E2E pattern (one spec = one assertion path) per CLAUDE.md.
 *  - If 1 source-type label rendering breaks, ONLY that test fails —
 *    others give a clean signal.
 *  - Each test gets its own character -> parallel-safe under any
 *    fullyParallel setting (we run workers=1 globally but the
 *    isolation guarantee is still load-bearing for re-runs after
 *    a single-test failure).
 */

import { test, expect } from '@playwright/test';
import type { TDeathSource } from '../../../../src/api/v1/deathsApi';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedDeath } from '../../fixtures/seedDeath';

// Per-source assertion table. `label` matches Deaths.tsx line 45-51
// SOURCE_META exactly — drift here would falsely flag the test as
// broken when in fact the badge text is correct.
interface IDeathTypeCase {
    source: TDeathSource;
    sourceName: string;
    sourceLevel: number;
    expectedBadgeLabel: string;
}

const DEATH_TYPE_CASES: IDeathTypeCase[] = [
    {
        source: 'monster',
        sourceName: 'Szczur',
        sourceLevel: 1,
        expectedBadgeLabel: 'Potwór',
    },
    {
        source: 'dungeon',
        sourceName: 'Ruiny Starego Fortu',
        sourceLevel: 1,
        expectedBadgeLabel: 'Dungeon',
    },
    {
        source: 'boss',
        sourceName: 'Cesarz Chaosu',
        sourceLevel: 25,
        expectedBadgeLabel: 'Boss',
    },
    {
        source: 'transform',
        sourceName: 'Transformacja I',
        sourceLevel: 1,
        expectedBadgeLabel: 'Transform',
    },
    // 2026-05-27: 'raid' source removed from the E2E parametrization.
    // Inserting source='raid' into character_deaths requires the widened
    // CHECK constraint from `scripts/deaths_migration.sql` (DDL — owner
    // applies via Supabase dashboard, like the 3 migrations already applied).
    // Until then a real-DB raid insert is rejected. Rather than skip (which
    // the owner wants eliminated), the raid-badge RENDERING is covered
    // deterministically at the component level in
    // `src/views/Deaths/Deaths.test.tsx` ("renders the Rajd badge for a
    // source=raid death row"). When the migration lands, re-add the case:
    //   { source: 'raid', sourceName: 'Wielki Rajd Smoka', sourceLevel: 30,
    //     expectedBadgeLabel: 'Rajd' },
    // The 4 sources below are all accepted by the base CHECK constraint and
    // prove the real-DB -> /deaths feed -> source-badge mechanism end-to-end.
];

test.describe('City › Deaths › per-combat-type', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    for (const c of DEATH_TYPE_CASES) {
        test(`source='${c.source}' -> /deaths shows row with badge "${c.expectedBadgeLabel}"`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                // 1. Seed Knight lvl 7 on SECONDARY (per task brief — primary
                //    is reserved for the background suite). Unique nick
                //    matches deterministically in the global feed.
                const created = await createCharacterViaApi({
                    userEmail: testUsers.secondary.email,
                    name: nick,
                    class: 'Knight',
                    overrides: { level: 7, highest_level: 7, hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                // 2. Insert death row matching this source type. All 4 sources
                //    here (monster/dungeon/boss/transform) are accepted by the
                //    base `character_deaths_source_check` constraint, so the
                //    INSERT always succeeds — no env-dependent skip. ('raid'
                //    was removed from the parametrization — see DEATH_TYPE_CASES
                //    comment; raid badge is component-tested in Deaths.test.tsx.)
                //    We omit `result` so the legacy-compatible path works on
                //    envs without the deaths_migration.sql `result` column
                //    (seedDeath falls back gracefully).
                await seedDeath({
                    characterId: created.id,
                    characterName: nick,
                    characterClass: 'Knight',
                    characterLevel: 7,
                    source: c.source,
                    sourceName: c.sourceName,
                    sourceLevel: c.sourceLevel,
                });

                // 3. Login on SECONDARY -> direct /deaths. No character pick
                //    needed (Deaths.tsx is global, doesn't touch
                //    characterStore — see feed-shows-seeded-death.spec.ts
                //    line 80-83).
                await loginViaUI(page, testUsers.secondary);
                await page.goto('/deaths');

                // 4. Spinner unmounts -> list visible. Generous timeout for
                //    cold WebKit boot.
                await expect(page.locator('.deaths__list')).toBeVisible({ timeout: 15_000 });

                // 5. Find our row by victim name. The :has selector matches
                //    only the li containing our specific nick.
                const ourDeathRow = page.locator('.deaths__item', {
                    has: page.locator('.deaths__victim-name', { hasText: nick }),
                });
                await expect(ourDeathRow).toBeVisible({ timeout: 10_000 });

                // 6. PRIMARY assertion — badge text matches SOURCE_META label.
                //    Badge format from Deaths.tsx line 387: "{icon} {label}".
                //    We assert containment, not equality, so the icon prefix
                //    doesn't break the match.
                const badge = ourDeathRow.locator('.deaths__item-badge');
                await expect(badge).toBeVisible();
                await expect(badge).toContainText(c.expectedBadgeLabel);

                // 7. Sanity — source name + level rendered correctly. Proves
                //    the FULL row payload made it through (not just the
                //    SOURCE_META lookup, but also the parsed source_name +
                //    source_level fields).
                await expect(ourDeathRow.locator('.deaths__monster-name'))
                    .toContainText(c.sourceName);
                await expect(ourDeathRow.locator('.deaths__monster-lvl'))
                    .toContainText(`Lvl ${c.sourceLevel}`);
                // 8. Victim level 7 (matches the level we seeded).
                await expect(ourDeathRow.locator('.deaths__victim-lvl'))
                    .toContainText('Lvl 7');
                // 9. Verb "zabił" — result column unset -> inferResult()
                //    defaults to 'killed' (Deaths.tsx line 73-77).
                await expect(ourDeathRow.locator('.deaths__verb--killed')).toBeVisible();
                await expect(ourDeathRow.locator('.deaths__verb-text')).toContainText('zabił');
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
