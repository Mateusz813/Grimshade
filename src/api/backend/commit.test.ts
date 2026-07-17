import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commitStateToBackend, commitStateViaKeepalive } from './commit';
import { backendApi } from './backendApi';
import { isBackendMode } from '../../config/backendMode';
import { getAuthToken } from './authToken';

vi.mock('../../config/backendMode', () => ({
    isBackendMode: vi.fn(() => true),
    getBackendBaseUrl: vi.fn(() => 'http://localhost:8088'),
}));
vi.mock('./backendApi', () => ({
    backendApi: {
        commitState: vi.fn().mockResolvedValue({}),
    },
}));
vi.mock('./authToken', () => ({
    getAuthToken: vi.fn(() => 'jwt-token'),
}));

const CHAR = 'char-1';
const KEY = `dungeon_rpg_save_char_${CHAR}`;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBackendMode).mockReturnValue(true);
    vi.mocked(backendApi.commitState).mockResolvedValue({});
    vi.mocked(getAuthToken).mockReturnValue('jwt-token');
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true } as Response));
    localStorage.clear();
});

describe('commitStateToBackend', () => {
    it('no-op poza trybem backendu', async () => {
        vi.mocked(isBackendMode).mockReturnValue(false);
        localStorage.setItem(KEY, JSON.stringify({ state: { hp: 1 }, updated_at: '' }));
        await commitStateToBackend(CHAR);
        expect(backendApi.commitState).not.toHaveBeenCalled();
    });

    it('no-op gdy brak charId', async () => {
        await commitStateToBackend(null);
        expect(backendApi.commitState).not.toHaveBeenCalled();
    });

    it('no-op gdy brak lokalnego bloba', async () => {
        await commitStateToBackend(CHAR);
        expect(backendApi.commitState).not.toHaveBeenCalled();
    });

    it('wysyła blob (stan) z localStorage autorytatywnym commitem i zwraca true', async () => {
        const state = { inventory: { gold: 363637692 }, _characterStats: { level: 345 } };
        localStorage.setItem(KEY, JSON.stringify({ state, updated_at: '2026-01-01' }));
        await expect(commitStateToBackend(CHAR)).resolves.toBe(true);
        expect(backendApi.commitState).toHaveBeenCalledWith(CHAR, state, undefined);
    });

    it('przekazuje kontekst zdarzenia walki do backendu (event)', async () => {
        const state = { inventory: { gold: 1 } };
        localStorage.setItem(KEY, JSON.stringify({ state, updated_at: '' }));
        const event = { type: 'dungeon' as const, sourceId: 'dungeon_1', outcome: 'won' as const, died: false };
        await commitStateToBackend(CHAR, event);
        expect(backendApi.commitState).toHaveBeenCalledWith(CHAR, state, event);
    });

    it('łyka błąd backendu i zwraca false (localStorage zostaje buforem)', async () => {
        vi.mocked(backendApi.commitState).mockRejectedValueOnce(new Error('offline'));
        localStorage.setItem(KEY, JSON.stringify({ state: { x: 1 }, updated_at: '' }));
        await expect(commitStateToBackend(CHAR)).resolves.toBe(false);
    });

    it('ignoruje uszkodzony blob (nie-JSON)', async () => {
        localStorage.setItem(KEY, 'not-json{');
        await commitStateToBackend(CHAR);
        expect(backendApi.commitState).not.toHaveBeenCalled();
    });
});

describe('commitStateViaKeepalive (zapis przy zamknięciu karty)', () => {
    it('wysyła keepalive PUT z blobem + tokenem (Authorization)', () => {
        const state = { inventory: { gold: 5 } };
        localStorage.setItem(KEY, JSON.stringify({ state, updated_at: '' }));
        commitStateViaKeepalive(CHAR);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
        expect(String(url)).toBe(`http://localhost:8088/api/v1/characters/${CHAR}/state`);
        expect(opts.method).toBe('PUT');
        expect(opts.keepalive).toBe(true);
        expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
        expect(JSON.parse(opts.body as string).state).toEqual(state);
    });

    it('no-op bez tokenu (getAuthToken=null)', () => {
        vi.mocked(getAuthToken).mockReturnValue(null);
        localStorage.setItem(KEY, JSON.stringify({ state: { x: 1 }, updated_at: '' }));
        commitStateViaKeepalive(CHAR);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('no-op poza trybem backendu / bez bloba', () => {
        vi.mocked(isBackendMode).mockReturnValue(false);
        localStorage.setItem(KEY, JSON.stringify({ state: { x: 1 }, updated_at: '' }));
        commitStateViaKeepalive(CHAR);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('commit — widocznosc awarii zapisu', () => {
    it('loguje ODRZUCONY commit ze statusem i rozmiarem zamiast go polykac', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        localStorage.setItem(KEY, JSON.stringify({ state: { hp: 1 }, updated_at: '' }));
        vi.mocked(backendApi.commitState).mockRejectedValue({
            response: { status: 422, data: { message: 'duplikat uuid' } },
        });

        const ok = await commitStateToBackend(CHAR);

        expect(ok).toBe(false);
        expect(warn).toHaveBeenCalled();
        const [msg, payload] = warn.mock.calls[0] as [string, Record<string, unknown>];
        expect(msg).toContain('ODRZUCONY');
        expect(payload.status).toBe(422);
        warn.mockRestore();
    });

    it('przy blobie ponad limit rezygnuje z keepalive i wysyla zwyklym requestem', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const realisticItem = (i: number) => ({
            uuid: `550e8400-e29b-41d4-a716-4466554${String(i).padStart(5, '0')}`,
            itemId: 'mythic_greatsword_of_the_fallen_king_300',
            rarity: 'mythic',
            bonuses: { attack: 120, defense: 40, hp: 300, mp: 80, critChance: 5 },
            itemLevel: 345,
        });
        const huge = {
            inventory: {
                bag: Array.from({ length: 200 }, (_, i) => realisticItem(i)),
                deposit: Array.from({ length: 200 }, (_, i) => realisticItem(1000 + i)),
            },
        };
        localStorage.setItem(KEY, JSON.stringify({ state: huge, updated_at: '' }));

        commitStateViaKeepalive(CHAR);

        const limitWarn = warn.mock.calls.find((c) => String(c[0]).includes('limit keepalive'));
        expect(limitWarn).toBeTruthy();
        expect((limitWarn?.[1] as { bytes: number }).bytes).toBeGreaterThan(60_000);

        const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
        expect(init.keepalive).toBe(false);
        warn.mockRestore();
    });

    it('maly blob nadal leci przez keepalive (gwarancja dostarczenia przy unload)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        localStorage.setItem(KEY, JSON.stringify({ state: { hp: 1 }, updated_at: '' }));

        commitStateViaKeepalive(CHAR);

        expect(warn.mock.calls.find((c) => String(c[0]).includes('limit keepalive'))).toBeFalsy();
        const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
        expect(init.keepalive).toBe(true);
        warn.mockRestore();
    });
});
