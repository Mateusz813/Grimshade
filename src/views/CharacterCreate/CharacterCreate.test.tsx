import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CharacterCreate view — class picker + name field + create flow.
 * 7 class buttons, animated detail panel on the right (framer-motion
 * AnimatePresence), submit calls characterApi.createCharacter + grants
 * starter weapon + navigates to /.
 *
 * Coverage:
 *   - Smoke: root + name input + class grid mount.
 *   - Class detail panel hidden until a class is picked.
 *   - Clicking a class makes the detail panel mount with the right text.
 *   - Submit blocked while no class is selected.
 *   - zod name validation: too short / illegal chars.
 *   - Successful submit calls characterApi.createCharacter + navigates.
 *   - Hitting the 7-character cap surfaces an error.
 *   - Back button navigates to /character-select.
 */

vi.mock('framer-motion', async () => {
    const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
    return {
        ...actual,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: new Proxy({}, {
            get: () => (props: Record<string, unknown>) => {
                const { children, ...rest } = props as { children?: React.ReactNode };
                return <div {...(rest as Record<string, unknown>)}>{children}</div>;
            },
        }),
    };
});

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../api/v1/characterApi', () => ({
    characterApi: {
        createCharacter: vi.fn(),
    },
}));

vi.mock('../../stores/characterScope', () => ({
    switchToCharacter: vi.fn(async () => undefined),
}));

vi.mock('../../api/v1/axiosInstance', () => ({
    default: {
        get: vi.fn(async () => ({ data: [] })),
        post: vi.fn(async () => ({ data: [] })),
    },
}));

// Backend-authoritative branch mocks. Default OFF so the existing client-path
// tests exercise the untouched CLASS_BASE_STATS payload + starter grants; a
// dedicated describe flips `backendFlag.on`.
const backendFlag = vi.hoisted(() => ({ on: false }));
const syncFromBackendMock = vi.hoisted(() => vi.fn());

vi.mock('../../config/backendMode', () => ({
    isBackendMode: () => backendFlag.on,
    isBackendConfigured: () => backendFlag.on,
    getBackendBaseUrl: () => (backendFlag.on ? 'http://localhost:8088' : ''),
    setBackendMode: (v: boolean) => { backendFlag.on = v; },
}));
vi.mock('../../api/backend/syncState', () => ({
    syncFromBackend: syncFromBackendMock,
    syncIfBackend: vi.fn().mockResolvedValue(undefined),
}));

import CharacterCreate from './CharacterCreate';
import { characterApi } from '../../api/v1/characterApi';
import { supabase } from '../../lib/supabase';
import api from '../../api/v1/axiosInstance';
import { switchToCharacter } from '../../stores/characterScope';
import { useInventoryStore } from '../../stores/inventoryStore';
import type { ICharacter } from '../../api/v1/characterApi';

const renderCreate = () =>
    render(
        <MemoryRouter>
            <CharacterCreate />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(characterApi.createCharacter).mockReset();
    vi.mocked(characterApi.createCharacter).mockResolvedValue({
        id: 'new-1',
        user_id: 'user-1',
        name: 'Hero1',
        class: 'Knight',
        level: 1,
        xp: 0,
        hp: 120, max_hp: 120, mp: 30, max_mp: 30,
        attack: 10, defense: 5, attack_speed: 1.5,
        crit_chance: 0.03, crit_damage: 2.0, magic_level: 0,
        hp_regen: 0, mp_regen: 0,
        gold: 0, stat_points: 0, highest_level: 1,
        equipment: {},
        created_at: '', updated_at: '',
    } as ICharacter);
    vi.mocked(supabase.auth.getSession).mockReset();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
    } as never);
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    backendFlag.on = false;
    syncFromBackendMock.mockReset().mockResolvedValue(undefined);
    vi.mocked(switchToCharacter).mockClear();
});

afterEach(() => {
    cleanup();
});

describe('CharacterCreate — smoke', () => {
    it('renders the .character-create root + form', () => {
        const { container } = renderCreate();
        expect(container.querySelector('.character-create')).not.toBeNull();
        expect(container.querySelector('.character-create__form')).not.toBeNull();
        expect(container.querySelector('.character-create__input')).not.toBeNull();
    });

    it('renders 7 class buttons (one per class)', () => {
        const { container } = renderCreate();
        const buttons = container.querySelectorAll('.character-create__class-btn');
        expect(buttons.length).toBe(7);
    });

    it('renders the back button + title', () => {
        const { container } = renderCreate();
        expect(container.querySelector('.character-create__back-btn')).not.toBeNull();
        expect(container.querySelector('.character-create__title')?.textContent).toContain('Stwórz postać');
    });
});

describe('CharacterCreate — class picker', () => {
    it('renders the "wybierz klasę" placeholder when no class is selected', () => {
        const { container } = renderCreate();
        expect(container.querySelector('.character-create__detail-empty')).not.toBeNull();
        expect(container.textContent).toContain('Wybierz klasę');
    });

    it('shows the class detail panel after clicking a class', () => {
        const { container } = renderCreate();
        const classBtns = container.querySelectorAll('.character-create__class-btn');
        // Knight is index 0 in classes.json — first button.
        fireEvent.click(classBtns[0]);
        expect(container.querySelector('.character-create__detail-inner')).not.toBeNull();
        expect(container.querySelector('.character-create__detail--active')).not.toBeNull();
    });

    it('renders starting weapon copy in the detail panel', () => {
        const { container } = renderCreate();
        const classBtns = container.querySelectorAll('.character-create__class-btn');
        fireEvent.click(classBtns[0]); // Knight
        expect(container.textContent).toContain('Startowa broń');
        // Knight gets "Sword of Beginnings".
        expect(container.textContent).toContain('Sword of Beginnings');
    });

    it('marks the active class with the --selected modifier', () => {
        const { container } = renderCreate();
        const classBtns = container.querySelectorAll('.character-create__class-btn');
        fireEvent.click(classBtns[2]); // Cleric (index 2 in classes.json)
        const selected = container.querySelectorAll('.character-create__class-btn--selected');
        expect(selected.length).toBe(1);
    });
});

describe('CharacterCreate — submit', () => {
    it('keeps the submit button disabled until a class is picked', () => {
        const { container } = renderCreate();
        const submit = container.querySelector('.character-create__submit') as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        fireEvent.click(container.querySelector('.character-create__class-btn') as HTMLButtonElement);
        expect(submit.disabled).toBe(false);
    });

    it('calls characterApi.createCharacter with the typed name + picked class', async () => {
        const { container } = renderCreate();
        fireEvent.change(container.querySelector('.character-create__input') as HTMLInputElement, {
            target: { value: 'HeroOne' },
        });
        // Click first class (Knight).
        const classBtns = container.querySelectorAll('.character-create__class-btn');
        fireEvent.click(classBtns[0]);
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(characterApi.createCharacter).toHaveBeenCalled();
        });
        const call = vi.mocked(characterApi.createCharacter).mock.calls[0];
        expect(call[0]).toBe('user-1');
        expect(call[1].name).toBe('HeroOne');
        expect(call[1].class).toBe('Knight');
    });

    it('navigates to / after a successful create', async () => {
        const { container } = renderCreate();
        fireEvent.change(container.querySelector('.character-create__input') as HTMLInputElement, {
            target: { value: 'HeroOne' },
        });
        fireEvent.click(container.querySelectorAll('.character-create__class-btn')[0]);
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith('/');
        });
    });

    it('shows the 7-character limit error when count is already 7', async () => {
        vi.mocked(api.get).mockResolvedValueOnce({
            data: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}` })),
        } as never);

        const { container } = renderCreate();
        fireEvent.change(container.querySelector('.character-create__input') as HTMLInputElement, {
            target: { value: 'HeroOne' },
        });
        fireEvent.click(container.querySelectorAll('.character-create__class-btn')[0]);
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Osiągnięto limit 7 postaci');
        });
        expect(characterApi.createCharacter).not.toHaveBeenCalled();
    });
});

describe('CharacterCreate — validation', () => {
    it('rejects names shorter than 3 chars', async () => {
        const { container } = renderCreate();
        fireEvent.change(container.querySelector('.character-create__input') as HTMLInputElement, {
            target: { value: 'ab' },
        });
        fireEvent.click(container.querySelectorAll('.character-create__class-btn')[0]);
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Min. 3 znaki');
        });
        expect(characterApi.createCharacter).not.toHaveBeenCalled();
    });

    it('rejects names containing special characters', async () => {
        const { container } = renderCreate();
        fireEvent.change(container.querySelector('.character-create__input') as HTMLInputElement, {
            target: { value: 'Hero!' },
        });
        fireEvent.click(container.querySelectorAll('.character-create__class-btn')[0]);
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Tylko litery, cyfry i max jedna spacja');
        });
    });
});

describe('CharacterCreate — backend-authoritative branch', () => {
    const createAndSubmit = (container: HTMLElement) => {
        fireEvent.change(container.querySelector('.character-create__input') as HTMLInputElement, {
            target: { value: 'HeroOne' },
        });
        fireEvent.click(container.querySelectorAll('.character-create__class-btn')[0]); // Knight
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    };

    it('creates with ONLY name+class (no base-stats payload) and hydrates via syncFromBackend', async () => {
        backendFlag.on = true;
        const { container } = renderCreate();
        createAndSubmit(container);

        await waitFor(() => {
            expect(characterApi.createCharacter).toHaveBeenCalled();
        });
        const call = vi.mocked(characterApi.createCharacter).mock.calls[0];
        expect(call[1]).toEqual({ name: 'HeroOne', class: 'Knight' });
        // No client base-stats leaking into the backend payload.
        expect(call[1]).not.toHaveProperty('hp');
        expect(call[1]).not.toHaveProperty('attack');
        expect(call[1]).not.toHaveProperty('gold');

        await waitFor(() => {
            expect(syncFromBackendMock).toHaveBeenCalledWith('new-1');
            expect(switchToCharacter).toHaveBeenCalledWith('new-1');
            expect(navigateMock).toHaveBeenCalledWith('/');
        });
    });

    it('SKIPS the local starter-loadout grants (server seeds them)', async () => {
        backendFlag.on = true;
        const addItemSpy = vi.fn().mockReturnValue(true);
        const equipItemSpy = vi.fn();
        const addConsumableSpy = vi.fn();
        useInventoryStore.setState({
            addItem: addItemSpy,
            equipItem: equipItemSpy,
            addConsumable: addConsumableSpy,
        });

        const { container } = renderCreate();
        createAndSubmit(container);

        await waitFor(() => {
            expect(syncFromBackendMock).toHaveBeenCalledWith('new-1');
        });
        expect(addItemSpy).not.toHaveBeenCalled();
        expect(equipItemSpy).not.toHaveBeenCalled();
        expect(addConsumableSpy).not.toHaveBeenCalled();
    });

    it('surfaces the server error message when create fails (e.g. 422 cap)', async () => {
        backendFlag.on = true;
        vi.mocked(characterApi.createCharacter).mockRejectedValueOnce({
            response: { data: { message: 'Osiągnięto limit 7 postaci.' } },
        });

        const { container } = renderCreate();
        createAndSubmit(container);

        await waitFor(() => {
            expect(container.textContent).toContain('Osiągnięto limit 7 postaci');
        });
        expect(navigateMock).not.toHaveBeenCalledWith('/');
    });

    it('with the flag OFF the old client path runs (base-stats payload sent, no syncFromBackend)', async () => {
        backendFlag.on = false;
        const { container } = renderCreate();
        createAndSubmit(container);

        await waitFor(() => {
            expect(characterApi.createCharacter).toHaveBeenCalled();
        });
        const call = vi.mocked(characterApi.createCharacter).mock.calls[0];
        // Client path forwards the full CLASS_BASE_STATS payload.
        expect(call[1]).toHaveProperty('hp');
        expect(call[1]).toHaveProperty('attack_speed');
        expect(syncFromBackendMock).not.toHaveBeenCalled();
    });
});

describe('CharacterCreate — back button', () => {
    it('navigates to /character-select when back is clicked', () => {
        const { container } = renderCreate();
        fireEvent.click(container.querySelector('.character-create__back-btn') as HTMLButtonElement);
        expect(navigateMock).toHaveBeenCalledWith('/character-select');
    });
});

// TODO: Cover the inventory-store side effects (starter weapon added +
//       equipped to mainHand). Asserting on useInventoryStore.getState()
//       after a successful create works but requires loading items.json
//       which the buildItem call needs — easier handled by the
//       inventoryStore tests. The view-level happy path here already
//       asserts characterApi.createCharacter was hit with the right class
//       which is the contract that triggers the gear chain.
// TODO: Auth missing-session branch (redirect to /login when session is
//       null). Easy to add but the global supabase mock already returns a
//       null session in some isolation contexts; current test fixtures
//       use a populated session to keep the happy path clean.
