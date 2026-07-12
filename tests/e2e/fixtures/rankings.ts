
import { expect, type Page } from '@playwright/test';

interface IAssertRankingArgs {
    tabLabel: RegExp;
    nick: string;
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

    await expect
        .poll(
            async () => {
                const txt = await myRow
                    .locator('.leaderboard__level')
                    .first()
                    .textContent()
                    .catch(() => null);
                if (txt && value.test(txt)) return txt;
                await page.locator('.leaderboard__tab').first().tap().catch(() => { });
                await page.waitForTimeout(500);
                await tab.tap().catch(() => { });
                await page.waitForTimeout(500);
                return txt ?? '';
            },
            { timeout: 40_000, intervals: [1000, 1500, 2000, 2500, 3000] },
        )
        .toMatch(value);

    await expect(myRow).toHaveClass(/leaderboard__row--me/);
};
