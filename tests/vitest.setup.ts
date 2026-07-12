
import { afterEach, vi } from 'vitest';

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
            rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
            channel: vi.fn().mockReturnValue({
                on: vi.fn().mockReturnThis(),
                subscribe: vi.fn().mockReturnThis(),
                unsubscribe: vi.fn(),
            }),
        },
    };
});

afterEach(() => {
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.sessionStorage.clear();
    }
    vi.clearAllMocks();
});
