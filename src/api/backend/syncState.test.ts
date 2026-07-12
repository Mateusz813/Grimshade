import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    stateMock: vi.fn(),
    applyBlobMock: vi.fn(),
    setCharacterMock: vi.fn(),
    backendFlag: { on: true },
}));
const { stateMock, applyBlobMock, setCharacterMock, backendFlag } = h;
vi.mock('./backendApi', () => ({ backendApi: { state: h.stateMock } }));
vi.mock('../../stores/characterScope', () => ({ applyBlobToStores: h.applyBlobMock }));
vi.mock('../../stores/characterStore', () => ({
    useCharacterStore: { getState: () => ({ setCharacter: h.setCharacterMock }) },
}));
vi.mock('../../config/backendMode', () => ({ isBackendMode: () => h.backendFlag.on }));

import { syncFromBackend, syncIfBackend } from './syncState';

beforeEach(() => {
    vi.clearAllMocks();
    backendFlag.on = true;
});

describe('syncFromBackend', () => {
    it('hydratuje characterStore + store\'y z GET /state', async () => {
        stateMock.mockResolvedValue({ character: { id: 'c1', level: 5 }, state: { inventory: { gold: 1 } } });
        await syncFromBackend('c1');
        expect(stateMock).toHaveBeenCalledWith('c1');
        expect(setCharacterMock).toHaveBeenCalledWith({ id: 'c1', level: 5 });
        expect(applyBlobMock).toHaveBeenCalledWith({ inventory: { gold: 1 } }, 'c1');
    });

    it('pomija setCharacter gdy brak character w odpowiedzi', async () => {
        stateMock.mockResolvedValue({ state: { x: 1 } });
        await syncFromBackend('c1');
        expect(setCharacterMock).not.toHaveBeenCalled();
        expect(applyBlobMock).toHaveBeenCalledWith({ x: 1 }, 'c1');
    });

    it('pomija applyBlobToStores gdy state nie jest obiektem', async () => {
        stateMock.mockResolvedValue({ character: { id: 'c1' }, state: null });
        await syncFromBackend('c1');
        expect(applyBlobMock).not.toHaveBeenCalled();
    });
});

describe('syncIfBackend', () => {
    it('no-op bez charId', async () => {
        await syncIfBackend(null);
        expect(stateMock).not.toHaveBeenCalled();
    });

    it('no-op poza trybem backendu', async () => {
        backendFlag.on = false;
        await syncIfBackend('c1');
        expect(stateMock).not.toHaveBeenCalled();
    });

    it('synchronizuje w trybie backendu', async () => {
        stateMock.mockResolvedValue({ character: null, state: {} });
        await syncIfBackend('c1');
        expect(stateMock).toHaveBeenCalledWith('c1');
    });
});
