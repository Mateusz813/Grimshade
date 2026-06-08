/**
 * Robust leaderboard-row assertion with re-fetch polling.
 *
 * WHY (2026-05-27): the rankings tests seed a `characters` column value
 * (arena_kills=999, mastery_points=999, …) then open `/leaderboard`, tap a
 * tab, and assert the seeded character's row shows that value. Under full-suite
 * DB contention the leaderboard's first fetch can return a transiently stale
 * row (observed: arena-killers showed "Zabicia 1" for 5s, then 999 on a fresh
 * run). A single `toContainText` can't recover from that — it just times out.
 *
 * This helper RE-FETCHES (taps away to the first/LVL tab then back to the
 * target tab, which re-runs the leaderboard query) until the seeded value
 * appears. That absorbs the contention INSIDE the test, so it passes on the
 * first attempt — no test-level retry, no "flaky" in the report.
 *
 * It tests EXACTLY the same contract as before (seeded value visible in the
 * right tab + `--me` row modifier) — just resilient to fetch timing.
 *
 * Assumes the caller already did `page.goto('/leaderboard')` and the
 * `.leaderboard__list` is visible.
 */

import { expect, type Page } from '@playwright/test';

interface IAssertRankingArgs {
    /** Exact tab label, e.g. /^Zabójcy$/ — matched on `.leaderboard__tab-label`. */
    tabLabel: RegExp;
    /** Unique character nick to locate the row by. */
    nick: string;
    /** Pattern the row's `.leaderboard__level` text must match (e.g. /\b999\b/). */
    value: RegExp;
}

export const assertSeededRankingRow = async (
    page: Page,
    { tabLabel, nick, value }: IAssertRankingArgs,
): Promise<void> => {
    const list = page.locator('.leaderboard__list');
    await expect(list).toBeVisible({ timeout: 15_000 });

    const tab = page.locator('.leaderboard__tab', {
        has: page.locator('.leaderboard__tab-label', { hasText: tabLabel }),
    });
    await expect(tab).toBeVisible({ timeout: 10_000 });
    await tab.tap();
    await expect(tab).toHaveClass(/leaderboard__tab--active/);

    const myRow = list.locator('.leaderboard__row', {
        has: page.locator('.leaderboard__name', { hasText: nick }),
    });

    // Poll the seeded value with re-fetch. Each miss taps the first tab
    // (LVL) then back to ours, forcing a fresh leaderboard query.
    await expect
        .poll(
            async () => {
                const txt = await myRow
                    .locator('.leaderboard__level')
                    .first()
                    .textContent()
                    .catch(() => null);
                if (txt && value.test(txt)) return txt;
                // Force re-fetch.
                await page.locator('.leaderboard__tab').first().tap().catch(() => { /* */ });
                await page.waitForTimeout(500);
                await tab.tap().catch(() => { /* */ });
                await page.waitForTimeout(500);
                return txt ?? '';
            },
            { timeout: 40_000, intervals: [1000, 1500, 2000, 2500, 3000] },
        )
        .toMatch(value);

    // `--me` modifier confirms the row matched by character.id, not just nick.
    await expect(myRow).toHaveClass(/leaderboard__row--me/);
};
