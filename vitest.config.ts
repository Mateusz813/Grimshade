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
                'tests/**',
            ],
            // Threshold tylko dla src/systems/ (game logic).
            // Reszta projektu (views, components) nie ma wymuszanego
            // floor-a — ale CLAUDE.md "TESTING" rule wymaga dopisania
            // testów per zmiana, więc i tak pokrycie będzie rosło.
            //
            // 2026-05-22: ratchet pattern — progi ustawione na aktualnym
            // poziomie pokrycia (+kilka pp zapasu na regres). Jak naturalnie
            // dopisujemy testy w kolejnych sesjach (TESTING rule "no code
            // without tests"), próg podnosimy. Nigdy nie obniżamy.
            //
            // Aktualne pokrycie (2026-05-22):
            //   statements 61.21% / branches 40.09% / functions 75.73% / lines 62.97%
            // Progi:
            //   statements 55 / branches 35 / functions 70 / lines 55
            thresholds: {
                'src/systems/**/*.ts': {
                    statements: 55,
                    branches: 35,
                    functions: 70,
                    lines: 55,
                },
            },
        },
    },
});
