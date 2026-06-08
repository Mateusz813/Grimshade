/**
 * Wait until the app's boot-time restore chain has fully settled.
 *
 * Pairs with `src/lib/appReady.ts` which flips `window.__grimshadeReady`
 * to `true` in `App.tsx`'s restore() `finally` — i.e. AFTER the awaited
 * cloud `loadGame()` + `applyBlobToStores()` have run.
 *
 * CALL THIS after every hard navigation (`page.goto('/<authed-route>')`)
 * that lands on a character-scoped view, BEFORE interacting with anything
 * backed by a per-character store (inventory, deposit, gold, quests, …).
 *
 * Without it, a tap can land in the window between the synchronous
 * localStorage restore (stores already show seeded values) and the
 * asynchronous cloud load completing — and the late applyBlobToStores
 * reverts the user action. This was the root cause of the deposit/gold
 * "3 → 2 → 3" batch flakes that no amount of retries fully killed.
 *
 * Generous 20s timeout: cold WebKit boot + production-Supabase character
 * fetch + game_saves load can chain to several seconds on a loaded CI box.
 */

import { type Page } from '@playwright/test';

export const waitForAppReady = async (page: Page): Promise<void> => {
    await page.waitForFunction(
        () => window.__grimshadeReady === true,
        { timeout: 20_000 },
    );
};

// Module augmentation so `window.__grimshadeReady` type-checks inside the
// page.waitForFunction predicate (runs in browser context).
declare global {
    interface Window {
        __grimshadeReady?: boolean;
    }
}
