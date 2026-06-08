/// <reference types="vitest/config" />
/**
 * Vitest config — dedicated, not merged with vite.config.ts.
 *
 * Decision log (2026-05-21):
 * - `environment: 'happy-dom'` — szybsze niż jsdom (~2×), wystarczy dla
 *   większości component / store tests. Pure-function testy (jak
 *   `levelSystem.test.ts`) działają w nim też bez problemu.
 * - `globals: false` — wymagamy explicit `import { test, expect }`.
 *   Trzymanie jasnych importów ułatwia debugowanie kolizji nazw.
 * - Coverage provider: v8 (built-in, szybszy niż istanbul).
 * - Threshold 70% dla `src/systems/` — game logic to crown jewel +
 *   formuły balansu, MUSI być pokryte. Pozostałe pliki nie mają
 *   wymuszonego progu (opcjonalnie podnoszone gdy zaczynamy je
 *   testować).
 * - Exclude `tests/e2e/**` — Playwright ma własny runner; vitest nie
 *   ma uruchamiać E2E specs.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Vite `define` z głównego configu nie jest wczytywany przez vitest
    // gdy config jest dedykowany — musimy re-deklarować zmienne global-e
    // które kod używa (patrz `src/lib/appVersion.ts`).
    define: {
        __APP_VERSION__: JSON.stringify('test'),
    },
    test: {
        globals: false,
        environment: 'happy-dom',
        include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            // Integration suites live OUTSIDE `src/` because they exercise
            // real cross-store / cross-system collaborations rather than a
            // single module. Picked up by vitest but excluded from
            // coverage (handled below + by the `tests/**` coverage
            // exclude).
            'tests/integration/**/*.{test,spec}.{ts,tsx}',
        ],
        exclude: [
            'node_modules/**',
            'dist/**',
            'tests/e2e/**',
            '.git/**',
        ],
        // Setup file ładuje się przed każdym test file. Tutaj
        // konfigurujemy globalne mocki (np. Supabase client) +
        // jakieś helpery które chcemy mieć dostępne wszędzie.
        setupFiles: ['./tests/vitest.setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.test.{ts,tsx}',
                'src/**/*.spec.{ts,tsx}',
                'src/**/*.d.ts',
                'src/main.tsx',
                'src/vite-env.d.ts',
                'src/assets/**',
                'src/data/**', // czyste JSONy + ich loadery — nic do testowania
                'src/styles/**',
                'src/lib/supabase.ts', // czysty createClient() bootstrap — brak logiki do testu (jak main.tsx)
                // combatEngine.ts — 3000-liniowy orchestrator spinający 12+
                // Zustand store'ów + Realtime. Pokryty przez Playwright E2E
                // (`combatSim` fixture: SKIP/live/death paths) + jego czysta
                // logika DMG/crit/block siedzi w osobnym `combat.ts` (93%
                // covered). Unit-test w izolacji = mockowanie kilkunastu store'ów,
                // niski ROI. Wykluczony z unit-coverage gate jak warstwa views/E2E.
                'src/systems/combatEngine.ts',
                'tests/**',
            ],
            // ── Per-layer HIGH thresholds (2026-06-08) ───────────────────────
            //
            // Progi ustawione WYSOKO na warstwach logiki gdzie unit/integration
            // jest właściwym narzędziem testowym. Floor = aktualnie osiągnięte
            // pokrycie minus ~3-4 pp bufora na v8 run-to-run variance. To
            // RATCHET: nigdy nie obniżamy; dopisując testy (TESTING rule) podnosimy.
            //
            // Glob-keyed threshold w Vitest = agregat plików matchujących glob
            // (nie per-plik). Więc np. `src/stores/**` musi mieć ≥80% statements
            // ŁĄCZNIE — pojedyncze niskie pliki (arenaStore 39%, partyStore 66%
            // — Realtime/multi-context glue pokryte przez E2E `multiContext`
            // fixture) są dopuszczalne dopóki agregat trzyma floor.
            //
            // CO NIE MA wymuszanego unit-floor-a (świadomie — to warstwa E2E):
            //   • src/views/**       — duże interaktywne komponenty (Boss, Dungeon,
            //                          Guild, Raid, Combat, Market) pokryte przez
            //                          Playwright E2E (147 spec files). Unit-test
            //                          całego combat UI = ogromny koszt, niski zysk.
            //   • src/routes/**      — AppRouter + guards = czysta konfiguracja
            //                          routingu, pokryta E2E redirect-flow testami.
            //   • src/App.tsx        — bootstrap, pokryty E2E (login→restore→render).
            //   • src/components/**  — mix; krytyczne (CombatUI, BottomNav,
            //                          BuffPopover, TaskBadge) mają unit testy,
            //                          reszta przez E2E.
            //   • combatEngine.ts    — 3000-liniowy orchestrator; pokryty przez
            //                          E2E `combatSim` fixture (SKIP/live/death) +
            //                          `combat.test.ts` (88% branch na czystej
            //                          logice DMG/crit/block). Unit w izolacji
            //                          wymagałby mockowania 12+ Zustand store'ów.
            //
            // Aktualne osiągnięte pokrycie agregatów (2026-06-08):
            //   systems  72.8 / 57.6 / 83.5 / 74.1
            //   stores   84.5 / 70.3 / 86.9 / 86.4
            //   hooks    85.5 / 69.3 / 91.9 / 87.1
            //   api      ~82.6 / 73 / 86 / 84   (BaseApi + api/v1)
            //   storage  87.0 / 75 / 100 / 86
            //   lib      ~100 / ~75 / 100 / 100 (appVersion + appReady; supabase.ts excluded)
            thresholds: {
                // combatEngine.ts excluded (E2E-covered orchestrator) → ten
                // floor dotyczy czystej logiki systems, która jest ~92%+.
                'src/systems/**/*.ts': {
                    statements: 88,
                    branches: 72,
                    functions: 90,
                    lines: 88,
                },
                'src/stores/**/*.ts': {
                    statements: 80,
                    branches: 66,
                    functions: 82,
                    lines: 82,
                },
                'src/hooks/**/*.ts': {
                    statements: 80,
                    branches: 65,
                    functions: 86,
                    lines: 82,
                },
                'src/api/**/*.ts': {
                    statements: 78,
                    branches: 68,
                    functions: 80,
                    lines: 80,
                },
                'src/storage/**/*.ts': {
                    statements: 82,
                    branches: 70,
                    functions: 92,
                    lines: 82,
                },
                'src/lib/**/*.ts': {
                    statements: 90,
                    branches: 45,
                    functions: 90,
                    lines: 90,
                },
            },
        },
    },
});
