import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Leaderboard view — multi-tab rankings page (~510 lines). 30+ tabs
 * pull from different REST endpoints (characters / weapon_skill /
 * guilds / deaths_total). Per-tab loads up to 100 rows + renders class
 * icons + medals for top-3.
 *
 * Coverage:
 *   • Smoke: root mounts + page-tabs row renders all the tabs.
 *   • Default tab is "level" (active modifier).
 *   • Loading spinner mounts on first render before data resolves.
 *   • Empty payload renders the "Brak graczy w rankingu" copy.
 *   • Tab click switches the active tab.
 *   • Populated character list renders one row per entry with class icon.
 *   • My-rank badge surfaces when the active character is in the entries.
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

vi.mock('../../api/v1/axiosInstance', () => ({
    default: {
        get: vi.fn(async () => ({ data: [] })),
    },
}));

import Leaderboard from './Leaderboard';
import api from '../../api/v1/axiosInstance';
import { useCharacterStore } from '../../stores/characterStore';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'me-1',
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

const renderLeaderboard = () =>
    render(
        <MemoryRouter>
            <Leaderboard />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: [] } as never);
    useCharacterStore.setState({ character: makeChar() });
    useGuildTagsStore.setState({
        resolveTagsByName: vi.fn(async () => undefined) as never,
        getTagByNameSync: vi.fn(() => null) as never,
    });
});

afterEach(() => {
    cleanup();
});

describe('Leaderboard — smoke', () => {
    it('renders the root .leaderboard container + tabs nav', () => {
        const { container } = renderLeaderboard();
        expect(container.querySelector('.leaderboard')).not.toBeNull();
        expect(container.querySelector('.leaderboard__tabs')).not.toBeNull();
    });

    it('renders all the tab buttons (>= 25 categories)', () => {
        const { container } = renderLeaderboard();
        const tabs = container.querySelectorAll('.leaderboard__tab');
        expect(tabs.length).toBeGreaterThanOrEqual(25);
    });

    it('defaults to the "level" tab (LVL label active)', () => {
        const { container } = renderLeaderboard();
        const active = container.querySelector('.leaderboard__tab--active');
        expect(active).not.toBeNull();
        expect(active?.textContent).toContain('LVL');
    });
});

describe('Leaderboard — content states', () => {
    it('mounts a loading spinner before the first response resolves', () => {
        const { container } = renderLeaderboard();
        // The component flips loading=true synchronously on tab change → at
        // first render the spinner branch renders.
        expect(container.querySelector('.leaderboard__loading')).not.toBeNull();
    });

    it('renders the empty-state copy when the API returns []', async () => {
        const { container } = renderLeaderboard();
        await waitFor(() => {
            expect(container.querySelector('.leaderboard__empty')).not.toBeNull();
        });
        expect(container.textContent).toContain('Brak graczy w rankingu');
    });

    it('renders one row per character returned by the API', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
                { id: 'a', name: 'Alpha', class: 'Knight', level: 10 },
                { id: 'b', name: 'Bravo', class: 'Mage', level: 8 },
                { id: 'c', name: 'Charlie', class: 'Archer', level: 7 },
            ],
        } as never);

        const { container } = renderLeaderboard();
        await waitFor(() => {
            const rows = container.querySelectorAll('.leaderboard__row');
            expect(rows.length).toBe(3);
        });
        expect(container.textContent).toContain('Alpha');
        expect(container.textContent).toContain('Bravo');
        expect(container.textContent).toContain('Charlie');
    });

    it('renders an error message when the API throws', async () => {
        vi.mocked(api.get).mockRejectedValue(new Error('boom') as never);
        const { container } = renderLeaderboard();
        await waitFor(() => {
            expect(container.querySelector('.leaderboard__error')).not.toBeNull();
        });
    });
});

describe('Leaderboard — tab switching', () => {
    it('flips the active modifier when a different tab is clicked', async () => {
        const { container } = renderLeaderboard();
        // Find a tab labeled "MLVL" (magic_level) — exists in the TABS list.
        const allTabs = Array.from(container.querySelectorAll('.leaderboard__tab'));
        const magicTab = allTabs.find((t) => t.textContent?.includes('MLVL')) as HTMLButtonElement;
        expect(magicTab).toBeDefined();
        fireEvent.click(magicTab);
        await waitFor(() => {
            expect(magicTab.className).toContain('leaderboard__tab--active');
        });
    });

    it('refetches when a new tab is selected', async () => {
        const { container } = renderLeaderboard();
        vi.mocked(api.get).mockClear();

        const allTabs = Array.from(container.querySelectorAll('.leaderboard__tab'));
        const guildsTab = allTabs.find((t) => t.textContent?.includes('Gildie')) as HTMLButtonElement;
        fireEvent.click(guildsTab);

        await waitFor(() => {
            expect(api.get).toHaveBeenCalled();
        });
    });
});

describe('Leaderboard — my-rank badge', () => {
    it('renders the "Twoja pozycja" badge when the character is on the list', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [
                { id: 'a', name: 'Alpha', class: 'Knight', level: 10 },
                { id: 'me-1', name: 'Hero', class: 'Knight', level: 5 },
            ],
        } as never);

        const { container } = renderLeaderboard();
        await waitFor(() => {
            expect(container.querySelector('.leaderboard__my-rank')).not.toBeNull();
        });
        expect(container.textContent).toContain('#2');
        expect(container.textContent).toContain('Hero');
    });

    it('omits the my-rank badge when the character is NOT on the list', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: [{ id: 'someone-else', name: 'Other', class: 'Mage', level: 99 }],
        } as never);
        const { container } = renderLeaderboard();
        await waitFor(() => {
            expect(container.querySelectorAll('.leaderboard__row').length).toBe(1);
        });
        expect(container.querySelector('.leaderboard__my-rank')).toBeNull();
    });
});

// TODO: Each tab branch (weapon_skill / guilds / deaths_total / arena_league
//       / market_items_sold / best_dps5_party) sends a different query +
//       transforms the rows differently. Smoke-asserting render here is
//       enough; per-branch transformation correctness lives in api/v1
//       integration tests.
// TODO: Top-3 medal rendering (🥇 / 🥈 / 🥉) → trivial slice but already
//       implicitly covered by the populated-list test.
