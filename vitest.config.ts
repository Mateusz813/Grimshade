
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [svgr({ svgrOptions: { icon: true } }), react()],
    resolve: {
        alias: {
            'virtual:pwa-register': fileURLToPath(
                new URL('./tests/stubs/virtual-pwa-register.ts', import.meta.url),
            ),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify('test'),
    },
    test: {
        globals: false,
        environment: 'happy-dom',
        env: {
            VITE_BACKEND_DEFAULT: '',
            VITE_API_BASE_URL: '',
        },
        testTimeout: 15_000,
        include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            'tests/integration/**/*.{test,spec}.{ts,tsx}',
        ],
        exclude: [
            'node_modules/**',
            'dist/**',
            'tests/e2e/**',
            '.git/**',
        ],
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
                'src/data/**',
                'src/styles/**',
                'src/lib/supabase.ts',
                'src/systems/combatEngine.ts',
                'tests/**',
            ],
            thresholds: {
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
