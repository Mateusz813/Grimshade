/**
 * Test stub for the Vite-injected `virtual:pwa-register` module.
 *
 * `vite-plugin-pwa` provides this virtual module only when its plugin runs
 * (the production/build Vite config). The dedicated `vitest.config.ts` does
 * NOT load the PWA plugin, so any test importing code that depends on
 * `virtual:pwa-register` (e.g. `src/lib/pwaUpdate.ts`) would fail to resolve
 * the import. This stub gives vitest something to resolve; individual tests
 * override the behaviour with `vi.mock('virtual:pwa-register', ...)`.
 */
export const registerSW = (
  _options?: unknown,
): ((reloadPage?: boolean) => Promise<void>) => () => Promise.resolve();
