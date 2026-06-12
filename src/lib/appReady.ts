/**
 * E2E app-ready signal.
 *
 * Flips `window.__grimshadeReady` so Playwright tests can deterministically
 * wait until the boot-time restore() chain has FULLY completed:
 *   character fetch -> switchToCharacter -> cloud loadGame -> applyBlobToStores.
 *
 * WHY THIS EXISTS (2026-05-27):
 *   After a hard navigation (`page.goto('/deposit')`) the app remounts and
 *   `App.tsx`'s restore() effect re-runs. There is a window where the stores
 *   ALREADY show the correct (seeded) values from the synchronous localStorage
 *   restore, but the asynchronous cloud `loadGame()` is STILL in flight. If a
 *   test taps during that window, the user mutation lands, then the late
 *   `applyBlobToStores(cloudBlob)` overwrites it — reverting the action
 *   (observed as deposit panel "3 -> 2 -> 3", gold "200 -> 100 -> 200").
 *
 *   Polling the store values does NOT help: they read "correct" both BEFORE
 *   and AFTER the cloud load, so a poll can't distinguish "hydrating" from
 *   "hydrated". This flag is set ONLY in restore()'s `finally`, i.e. AFTER the
 *   awaited cloud load + applyBlobToStores have run — so `=== true` is an
 *   unambiguous "safe to interact" signal.
 *
 * PRODUCTION COST: a single `window` boolean write. No behavioural impact,
 * no bundle weight beyond two tiny functions. Left in prod intentionally so
 * the signal is identical between dev and prod builds (E2E runs against the
 * prod build via `npm run test:e2e`).
 */

declare global {
    interface Window {
        /** `true` once the boot restore chain has fully settled. */
        __grimshadeReady?: boolean;
    }
}

/** Mark the app as fully hydrated (restore chain settled). */
export const markAppReady = (): void => {
    if (typeof window !== 'undefined') {
        window.__grimshadeReady = true;
    }
};

/** Mark the app as mid-restore (cloud loadGame in flight — do not interact). */
export const markAppRestoring = (): void => {
    if (typeof window !== 'undefined') {
        window.__grimshadeReady = false;
    }
};
