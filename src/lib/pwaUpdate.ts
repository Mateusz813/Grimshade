import { registerSW } from 'virtual:pwa-register';

/**
 * How often (ms) to poll for a freshly deployed build while the app stays open.
 */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

/**
 * Register the service worker and AGGRESSIVELY check for new deploys so an
 * installed (home-screen) PWA always loads the newest version — without the
 * user having to manually re-add it to the home screen.
 *
 * `registerType: 'autoUpdate'` (vite.config.ts) means: when a new SW is found,
 * it skip-waits and the page auto-reloads (controllerchange) onto the new
 * build. The catch is that the browser only LOOKS for a new SW on cold start.
 * A home-screen PWA that is backgrounded and resumed never reloads, so it kept
 * serving the cached old bundle — that's why new changes "didn't load" until a
 * reinstall.
 *
 * Fix: after registration we trigger `registration.update()` (a fresh SW check)
 *   - every time the app becomes visible (i.e. the user reopening it — the most
 *     reliable, least-disruptive moment to pick up a deploy),
 *   - on a periodic interval while it stays open, and
 *   - whenever connectivity is regained.
 * When the check finds a new version, autoUpdate applies it and reloads. Local
 * gameplay state is persisted (gameStorage), so the reload restores the session.
 *
 * No-op in dev — the SW is only generated for the production build (unless
 * `devOptions.enabled` is set), so `registerSW` does nothing under `vite dev`.
 */
export const initPwaAutoUpdate = (): void => {
  registerSW({
    immediate: true,
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return;

      const checkForUpdate = (): void => {
        // `update()` rejects when offline / mid-install; swallow it and retry
        // on the next trigger rather than throwing into the console.
        void registration.update().catch(() => undefined);
      };

      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('online', checkForUpdate);
    },
  });
};
