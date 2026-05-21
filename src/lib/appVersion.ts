/**
 * App version — single source of truth = `package.json`.
 *
 * The value is injected by Vite at build time via the `define` block in
 * `vite.config.ts` (`__APP_VERSION__ = JSON.stringify(pkg.version)`). We
 * keep this file as the typed import surface so views never reach for
 * the global directly — that keeps the typing clean and gives us one
 * place to introduce fallbacks if the build pipeline ever changes.
 *
 * Bumping the version is a deliberate step on every commit — see the
 * "Workflow — semver + branche + commity" section in CLAUDE.md for the
 * rules.
 */

declare const __APP_VERSION__: string;

export const APP_VERSION: string =
    typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
