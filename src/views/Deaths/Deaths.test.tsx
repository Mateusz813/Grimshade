import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Deaths view — paginated graveyard feed (~490 lines). Loads up to
 * 1000 most-recent rows via deathsApi.listRecentDeaths, filters by
 * source kind (all / raid / boss / dungeon / transform / monster), and
 * paginates 100/page.
 *
 * Coverage:
 *   • Smoke: root + filter row mount.
 *   • Spinner mounts before data resolves.
 *   • Empty payload renders the "Brak zapisanych śmierci" copy.
 *   • Populated payload renders one <li> per record.
 *   • Filter click switches the active filter chip.
 *   • Counts per filter render the row totals.
 *   • Pagination row appears when items > 100.
 */

vi.mock('../../api/v1/deathsApi', () => ({
    deathsApi: {
        listRecentDeaths: vi.fn(async () => []),
    },
}));

import Deaths from './Deaths';
import { deathsApi } from '../../api/v1/deathsApi';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import type { IDeathRecord } from '../../api/v1/deathsApi';

const makeDeath = (overrides: Partial<IDeathRecord> = {}): IDeathRecord => ({
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    character_id: 'c-1',
    character_name: 'Hero',
    character_class: 'Knight',
    character_level: 5,
    source: 'monster',
    source_name: 'Goblin',
    source_level: 3,
    died_at: new Date().toISOString(),
    result: 'killed',
    ...overrides,
});

const renderDeaths = () =>
    render(
        <MemoryRouter>
            <Deaths />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.mocked(deathsApi.listRecentDeaths).mockReset();
    vi.mocked(deathsApi.listRecentDeaths).mockResolvedValue([]);
    useGuildTagsStore.setState({
        resolveTagsByName: vi.fn(async () => undefined) as never,
        getTagByNameSync: vi.fn(() => null) as never,
    });
});

afterEach(() => {
    cleanup();
});

describe('Deaths — smoke', () => {
    it('renders the .deaths root', async () => {
        const { container } = renderDeaths();
        expect(container.querySelector('.deaths')).not.toBeNull();
        // Filters row always renders.
        await waitFor(() => {
            expect(container.querySelector('.deaths__filters')).not.toBeNull();
        });
    });

    it('renders all 6 filter chips (all + 5 sources)', async () => {
        const { container } = renderDeaths();
        await waitFor(() => {
            const chips = container.querySelectorAll('.deaths__filter');
            expect(chips.length).toBe(6);
        });
    });

    it('starts on the "Wszystkie" filter as active', async () => {
        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelector('.deaths__filter--active')).not.toBeNull();
        });
        const active = container.querySelector('.deaths__filter--active')!;
        expect(active.textContent).toContain('Wszystkie');
    });
});

describe('Deaths — load states', () => {
    it('renders the loading state before the API resolves', () => {
        const { container } = renderDeaths();
        // Loading branch renders a Spinner inside .deaths__empty.
        expect(container.querySelector('.deaths__empty')).not.toBeNull();
    });

    it('renders the "Brak zapisanych śmierci" empty copy after load', async () => {
        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.textContent).toContain('Brak zapisanych śmierci');
        });
    });

    it('renders one row per death after a populated load', async () => {
        vi.mocked(deathsApi.listRecentDeaths).mockResolvedValueOnce([
            makeDeath({ id: 'd1', source_name: 'Goblin' }),
            makeDeath({ id: 'd2', source: 'boss', source_name: 'Lich King' }),
            makeDeath({ id: 'd3', source: 'dungeon', source_name: 'Crypt' }),
        ]);

        const { container } = renderDeaths();
        await waitFor(() => {
            const rows = container.querySelectorAll('.deaths__item');
            expect(rows.length).toBe(3);
        });
        expect(container.textContent).toContain('Goblin');
        expect(container.textContent).toContain('Lich King');
        expect(container.textContent).toContain('Crypt');
    });
});

describe('Deaths — filtering', () => {
    beforeEach(() => {
        vi.mocked(deathsApi.listRecentDeaths).mockResolvedValue([
            makeDeath({ id: 'm1', source: 'monster', source_name: 'Goblin' }),
            makeDeath({ id: 'b1', source: 'boss', source_name: 'Lich' }),
            makeDeath({ id: 'd1', source: 'dungeon', source_name: 'Crypt' }),
        ]);
    });

    it('flips the active modifier when another filter is clicked', async () => {
        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelectorAll('.deaths__item').length).toBe(3);
        });

        const bossFilter = Array.from(container.querySelectorAll('.deaths__filter'))
            .find((b) => b.textContent?.includes('Boss')) as HTMLButtonElement;
        fireEvent.click(bossFilter);
        expect(bossFilter.className).toContain('deaths__filter--active');
    });

    it('narrows the list to records of the selected source', async () => {
        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelectorAll('.deaths__item').length).toBe(3);
        });

        const dungeonFilter = Array.from(container.querySelectorAll('.deaths__filter'))
            .find((b) => b.textContent?.includes('Dungeon')) as HTMLButtonElement;
        fireEvent.click(dungeonFilter);

        await waitFor(() => {
            const visible = container.querySelectorAll('.deaths__item');
            // Only the dungeon record (Crypt) should remain visible.
            expect(visible.length).toBe(1);
        });
        expect(container.textContent).toContain('Crypt');
        expect(container.textContent).not.toContain('Goblin');
    });

    it('renders a per-filter count next to each chip', async () => {
        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelectorAll('.deaths__item').length).toBe(3);
        });
        // Each chip shows its count in `.deaths__filter-count`.
        const counts = Array.from(container.querySelectorAll('.deaths__filter-count'))
            .map((c) => c.textContent);
        // "all" should show 3.
        expect(counts).toContain('3');
        // Each source filter shows 1.
        expect(counts.filter((c) => c === '1').length).toBeGreaterThanOrEqual(3);
    });
});

describe('Deaths — pagination', () => {
    it('does not render the pager when records fit on one page', async () => {
        vi.mocked(deathsApi.listRecentDeaths).mockResolvedValueOnce(
            Array.from({ length: 5 }, (_, i) => makeDeath({ id: `d${i}` })),
        );

        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelectorAll('.deaths__item').length).toBe(5);
        });
        expect(container.querySelector('.deaths__pager')).toBeNull();
    });

    it('renders the pager when records exceed PAGE_SIZE (100)', async () => {
        vi.mocked(deathsApi.listRecentDeaths).mockResolvedValueOnce(
            Array.from({ length: 150 }, (_, i) => makeDeath({ id: `d${i}` })),
        );

        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelector('.deaths__pager')).not.toBeNull();
        });
        expect(container.textContent).toContain('Strona 1 / 2');
    });

    it('moves to page 2 on Next click', async () => {
        vi.mocked(deathsApi.listRecentDeaths).mockResolvedValueOnce(
            Array.from({ length: 150 }, (_, i) => makeDeath({ id: `d${i}` })),
        );

        const { container } = renderDeaths();
        await waitFor(() => {
            expect(container.querySelector('.deaths__pager')).not.toBeNull();
        });
        const nextBtn = Array.from(container.querySelectorAll('.deaths__pager-btn'))
            .find((b) => b.textContent?.includes('Następna')) as HTMLButtonElement;
        fireEvent.click(nextBtn);
        await waitFor(() => {
            expect(container.textContent).toContain('Strona 2 / 2');
        });
    });
});

// TODO: Cover the inferResult() legacy-suffix path — rows with the old
//       "(uciekłeś z gry)" suffix should render with the "przegnał" verb
//       even when `result` is missing. Easy to set up; skipped to keep
//       the suite focused on render contract.
// TODO: Image resolution (resolveRowBackground / resolvePortrait) uses
//       JSON lookups + import.meta.glob — kept implicit. Covered well
//       enough by the populated-list smoke test above.
