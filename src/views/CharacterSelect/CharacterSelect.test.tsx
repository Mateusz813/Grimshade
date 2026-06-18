import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CharacterSelect view — post-login character picker (max 7 alts per
 * account). Lists every character with HP/MP bars + class avatar +
 * delete + select. Fetches via characterApi + supabase session.
 *
 * Coverage:
 *   - Spinner mounts while characters load.
 *   - Logged-out users get bounced to /login.
 *   - Loaded list renders one card per character.
 *   - Empty list renders the "Nie masz jeszcze żadnych postaci" copy.
 *   - Select button calls switchToCharacter + navigates to /.
 *   - Delete button surfaces a confirm flow + commit deletes the row.
 *   - Create-new button visible while count < 7; hidden at 7.
 *   - Logout button calls supabase signOut + navigates to /login.
 */

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
        getCharacters: vi.fn(),
        deleteCharacter: vi.fn(),
    },
}));

vi.mock('../../api/v1/authApi', () => ({
    authApi: {
        verifyCurrentPassword: vi.fn(),
    },
}));

vi.mock('../../stores/characterScope', () => ({
    switchToCharacter: vi.fn(async () => undefined),
    deleteCharacterData: vi.fn(async () => undefined),
    saveCurrentCharacterStores: vi.fn(async () => undefined),
    peekCharacterStore: vi.fn(() => null),
}));

import CharacterSelect from './CharacterSelect';
import { characterApi } from '../../api/v1/characterApi';
import { authApi } from '../../api/v1/authApi';
import { switchToCharacter, deleteCharacterData } from '../../stores/characterScope';
import { supabase } from '../../lib/supabase';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderCharacterSelect = () =>
    render(
        <MemoryRouter>
            <CharacterSelect />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(characterApi.getCharacters).mockReset();
    vi.mocked(characterApi.deleteCharacter).mockReset();
    vi.mocked(authApi.verifyCurrentPassword).mockReset();
    vi.mocked(authApi.verifyCurrentPassword).mockResolvedValue(true);
    vi.mocked(switchToCharacter).mockClear();
    vi.mocked(deleteCharacterData).mockClear();
    vi.mocked(supabase.auth.getSession).mockReset();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
    } as never);
    vi.mocked(supabase.auth.signOut).mockReset();
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
    vi.mocked(characterApi.getCharacters).mockResolvedValue([]);
});

afterEach(() => {
    cleanup();
});

describe('CharacterSelect — loading + auth gate', () => {
    it('renders the loading-state spinner first', () => {
        const { container } = renderCharacterSelect();
        expect(container.querySelector('.char-select--loading')).not.toBeNull();
    });

    it('redirects to /login when no session is present', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: null },
            error: null,
        } as never);
        renderCharacterSelect();
        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith('/login');
        });
    });
});

describe('CharacterSelect — list rendering', () => {
    it('renders one card per character once data resolves', async () => {
        vi.mocked(characterApi.getCharacters).mockResolvedValue([
            makeChar({ id: 'a', name: 'Alpha' }),
            makeChar({ id: 'b', name: 'Bravo', class: 'Mage' }),
        ]);

        const { container } = renderCharacterSelect();
        await waitFor(() => {
            const cards = container.querySelectorAll('.char-select__card');
            expect(cards.length).toBe(2);
        });
        expect(container.textContent).toContain('Alpha');
        expect(container.textContent).toContain('Bravo');
    });

    it('renders the empty-state copy when no characters exist', async () => {
        vi.mocked(characterApi.getCharacters).mockResolvedValue([]);
        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__empty')).not.toBeNull();
        });
        expect(container.textContent).toContain('Nie masz jeszcze żadnych postaci');
    });

    it('renders an error message when fetching fails', async () => {
        vi.mocked(characterApi.getCharacters).mockRejectedValueOnce(new Error('boom'));
        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.textContent).toContain('Nie można załadować postaci');
        });
    });
});

describe('CharacterSelect — actions', () => {
    it('calls switchToCharacter + navigates to / on Wybierz click', async () => {
        const char = makeChar({ id: 'a', name: 'Alpha' });
        vi.mocked(characterApi.getCharacters).mockResolvedValue([char]);
        const { container } = renderCharacterSelect();

        await waitFor(() => {
            expect(container.querySelector('.char-select__select-btn')).not.toBeNull();
        });
        const btn = container.querySelector('.char-select__select-btn') as HTMLButtonElement;
        fireEvent.click(btn);

        await waitFor(() => {
            expect(switchToCharacter).toHaveBeenCalledWith('a');
            expect(navigateMock).toHaveBeenCalledWith('/');
        });
    });

    it('opens the password modal on trash click and commits after the CORRECT password', async () => {
        const char = makeChar({ id: 'a', name: 'Alpha' });
        vi.mocked(characterApi.getCharacters).mockResolvedValue([char]);
        vi.mocked(characterApi.deleteCharacter).mockResolvedValue(undefined as never);
        vi.mocked(authApi.verifyCurrentPassword).mockResolvedValue(true);

        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__delete-btn')).not.toBeNull();
        });

        // Trash click opens the password modal (not an inline confirm).
        fireEvent.click(container.querySelector('.char-select__delete-btn') as HTMLButtonElement);
        expect(container.querySelector('.char-select__modal')).not.toBeNull();
        // Nothing deleted yet — password not entered.
        expect(characterApi.deleteCharacter).not.toHaveBeenCalled();

        // Type the current password + confirm.
        const input = container.querySelector('.char-select__modal-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'hunter2' } });
        fireEvent.click(container.querySelector('.char-select__modal-delete') as HTMLButtonElement);

        await waitFor(() => {
            expect(authApi.verifyCurrentPassword).toHaveBeenCalledWith('hunter2');
            expect(characterApi.deleteCharacter).toHaveBeenCalledWith('a');
            expect(deleteCharacterData).toHaveBeenCalledWith('a');
        });
        // After delete the card + modal disappear.
        await waitFor(() => {
            expect(container.querySelectorAll('.char-select__card').length).toBe(0);
            expect(container.querySelector('.char-select__modal')).toBeNull();
        });
    });

    it('does NOT delete + shows an error when the password is WRONG', async () => {
        const char = makeChar({ id: 'a', name: 'Alpha' });
        vi.mocked(characterApi.getCharacters).mockResolvedValue([char]);
        vi.mocked(authApi.verifyCurrentPassword).mockResolvedValue(false);

        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__delete-btn')).not.toBeNull();
        });

        fireEvent.click(container.querySelector('.char-select__delete-btn') as HTMLButtonElement);
        const input = container.querySelector('.char-select__modal-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'wrong-password' } });
        fireEvent.click(container.querySelector('.char-select__modal-delete') as HTMLButtonElement);

        await waitFor(() => {
            expect(authApi.verifyCurrentPassword).toHaveBeenCalledWith('wrong-password');
            expect(container.querySelector('.char-select__modal-error')).not.toBeNull();
        });
        // Character NOT deleted, modal still open, card still present.
        expect(characterApi.deleteCharacter).not.toHaveBeenCalled();
        expect(deleteCharacterData).not.toHaveBeenCalled();
        expect(container.querySelectorAll('.char-select__card').length).toBe(1);
    });

    it('cancels the delete confirm when Anuluj is clicked', async () => {
        const char = makeChar({ id: 'a', name: 'Alpha' });
        vi.mocked(characterApi.getCharacters).mockResolvedValue([char]);

        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__delete-btn')).not.toBeNull();
        });

        fireEvent.click(container.querySelector('.char-select__delete-btn') as HTMLButtonElement);
        expect(container.querySelector('.char-select__modal')).not.toBeNull();
        const cancelBtn = container.querySelector('.char-select__modal-cancel') as HTMLButtonElement;
        fireEvent.click(cancelBtn);

        // Modal closes, nothing verified or deleted.
        expect(container.querySelector('.char-select__modal')).toBeNull();
        expect(authApi.verifyCurrentPassword).not.toHaveBeenCalled();
        expect(characterApi.deleteCharacter).not.toHaveBeenCalled();
    });
});

describe('CharacterSelect — create + logout buttons', () => {
    it('shows the create-new CTA when count < 7', async () => {
        vi.mocked(characterApi.getCharacters).mockResolvedValue([makeChar()]);
        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__create-btn')).not.toBeNull();
        });
        expect(container.querySelector('.char-select__create-btn')!.textContent).toContain('1/7');
    });

    it('hides the create-new CTA when count === 7 (max alts)', async () => {
        vi.mocked(characterApi.getCharacters).mockResolvedValue(
            Array.from({ length: 7 }, (_, i) => makeChar({ id: `c${i}`, name: `Hero ${i}` })),
        );
        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelectorAll('.char-select__card').length).toBe(7);
        });
        expect(container.querySelector('.char-select__create-btn')).toBeNull();
    });

    it('navigates to /create-character when the create CTA is clicked', async () => {
        vi.mocked(characterApi.getCharacters).mockResolvedValue([]);
        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__create-btn')).not.toBeNull();
        });
        fireEvent.click(container.querySelector('.char-select__create-btn') as HTMLButtonElement);
        expect(navigateMock).toHaveBeenCalledWith('/create-character');
    });

    it('logs out + navigates to /login on Wyloguj click', async () => {
        vi.mocked(characterApi.getCharacters).mockResolvedValue([]);
        const { container } = renderCharacterSelect();
        await waitFor(() => {
            expect(container.querySelector('.char-select__logout-btn')).not.toBeNull();
        });
        fireEvent.click(container.querySelector('.char-select__logout-btn') as HTMLButtonElement);
        await waitFor(() => {
            expect(supabase.auth.signOut).toHaveBeenCalled();
            expect(navigateMock).toHaveBeenCalledWith('/login');
        });
    });
});

// TODO: Cover the post-select "fetch fresh char from supabase" branch where
//       a second getCharacters call retrieves the up-to-date row. The current
//       happy-path test asserts switchToCharacter + navigate but doesn't
//       check that setCharacter received the *fresh* copy. Would need a
//       chained mockResolvedValueOnce dance + characterStore inspection.
// TODO: Render side-effect of getEffectiveMaxStats() — multiple peek*
//       helpers walk localStorage; we mock peekCharacterStore -> null which
//       short-circuits all of them. Wider coverage of the elixir + transform
//       bonus paths lives in the source-level system tests already.
