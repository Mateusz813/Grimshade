import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commitStateToBackend } from './commit';
import { backendApi } from './backendApi';
import { isBackendMode } from '../../config/backendMode';

vi.mock('../../config/backendMode', () => ({
    isBackendMode: vi.fn(() => true),
}));
vi.mock('./backendApi', () => ({
    backendApi: {
        commitState: vi.fn().mockResolvedValue({}),
    },
}));

const CHAR = 'char-1';
const KEY = `dungeon_rpg_save_char_${CHAR}`;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBackendMode).mockReturnValue(true);
    vi.mocked(backendApi.commitState).mockResolvedValue({});
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
