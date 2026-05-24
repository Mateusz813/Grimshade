/**
 * Global vitest setup — loaded BEFORE every test file (via
 * `setupFiles` w vitest.config.ts).
 *
 * Co tu robimy:
 * - Mockujemy Supabase client globalnie — testy unit/integration nie
 *   powinny dzwonić do prawdziwej DB. E2E tests (Playwright) używają
 *   pravdziwego Supabase (local via docker), te tu są izolowane.
 * - Mockujemy `import.meta.env` zmienne których kod używa (zwykle
 *   VITE_SUPABASE_URL etc.).
 * - Tylko jeden mock żeby się nie rozjeżdżał między testami.
 */

import { afterEach, vi } from 'vitest';

// ── Supabase mock ────────────────────────────────────────────────────
// Wszystkie metody to no-opy zwracające `{ data: null, error: null }`.
// Konkretne testy mogą override-ować przez `vi.mocked(supabase.from)...`.
vi.mock('../src/lib/supabase', () => {
    const chain = () => ({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        then: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    return {
        supabase: {
            auth: {
                getSession: vi.fn().mockResolvedValue({
                    data: { session: null },
                    error: null,
                }),
                onAuthStateChange: vi.fn().mockReturnValue({
                    data: { subscription: { unsubscribe: vi.fn() } },
                }),
                signInWithPassword: vi.fn().mockResolvedValue({ data: null, error: null }),
                signOut: vi.fn().mockResolvedValue({ error: null }),
            },
            from: vi.fn(chain),
            channel: vi.fn().mockReturnValue({
                on: vi.fn().mockReturnThis(),
                subscribe: vi.fn().mockReturnThis(),
                unsubscribe: vi.fn(),
            }),
        },
    };
});

// ── localStorage mock — happy-dom ma własny, ale resetujemy między
//    testami żeby state nie wyciekał ─────────────────────────────────
afterEach(() => {
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }
    vi.clearAllMocks();
});
