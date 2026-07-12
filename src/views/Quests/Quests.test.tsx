import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


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

import Quests from './Quests';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useQuestStore } from '../../stores/questStore';
import { useTaskStore } from '../../stores/taskStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import { getTodayKey } from '../../systems/dailyQuestSystem';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 50,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 50,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderQuests = () =>
    render(
        <MemoryRouter>
            <Quests />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 1000,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useQuestStore.setState({
        activeQuests: [],
        completedQuestIds: [],
    } as never);
    useTaskStore.setState({
        activeTask: null,
        activeTasks: [],
        completedTasks: [],
    } as never);
    useDailyQuestStore.setState({
        lastRefreshDate: getTodayKey(),
        activeQuests: [],
        todayQuestDefs: [],
    });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} } as never);
    useTransformStore.setState({ completedTransforms: [] });
    useSettingsStore.setState({ taskFilterLvlFrom: '' });
});

afterEach(() => {
    cleanup();
});

describe('Quests — smoke', () => {
    it('renders the root .quests container', () => {
        const { container } = renderQuests();
        expect(container.querySelector('.quests')).not.toBeNull();
    });

    it('lands on the home (hub) tab by default', () => {
        const { container } = renderQuests();
        expect(container.querySelector('.quests__hub')).not.toBeNull();
    });

    it('renders 3 hub tiles (Taski / Questy / Dzienne misje)', () => {
        const { container } = renderQuests();
        const tiles = container.querySelectorAll('.quests__hub-tile');
        expect(tiles.length).toBe(3);
        const labels = Array.from(tiles).map((t) => t.getAttribute('aria-label'));
        expect(labels).toEqual(['Taski', 'Questy', 'Dzienne misje']);
    });
});

describe('Quests — hub tile navigation', () => {
    it('switches to the Tasks sub-view when the Taski tile is clicked', () => {
        const { container } = renderQuests();
        const tasksTile = container.querySelector('.quests__hub-tile--tasks') as HTMLButtonElement;
        fireEvent.click(tasksTile);
        expect(container.querySelector('.quests__hub')).toBeNull();
        expect(container.querySelector('.tasks__list')).not.toBeNull();
    });

    it('switches to the Quests sub-view when the Questy tile is clicked', () => {
        const { container } = renderQuests();
        const questsTile = container.querySelector('.quests__hub-tile--quests') as HTMLButtonElement;
        fireEvent.click(questsTile);
        expect(container.querySelector('.quests__hub')).toBeNull();
        expect(container.querySelector('.quests__filters')).not.toBeNull();
    });

    it('switches to the Daily sub-view when the Dzienne misje tile is clicked', () => {
        const { container } = renderQuests();
        const dailyTile = container.querySelector('.quests__hub-tile--daily') as HTMLButtonElement;
        fireEvent.click(dailyTile);
        expect(container.querySelector('.quests__hub')).toBeNull();
        expect(container.querySelector('.quests__daily-list')).not.toBeNull();
    });
});

describe('Quests — claimable dot on hub tiles', () => {
    it('marks the Tasks tile as claimable when a task is complete', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1',
                monsterId: 'rabbit',
                monsterLevel: 1,
                monsterName: 'Krolik',
                killCount: 10,
                rewardGold: 100,
                rewardXp: 50,
                progress: 10,
                startedAt: '2026-05-22T00:00:00.000Z',
            }],
        } as never);
        const { container } = renderQuests();
        const tasksTile = container.querySelector('.quests__hub-tile--tasks');
        expect(tasksTile?.className).toContain('quests__hub-tile--claimable');
    });

    it('marks the Daily tile as claimable when a daily quest is completed but unclaimed', () => {
        useDailyQuestStore.setState({
            lastRefreshDate: getTodayKey(),
            activeQuests: [{ questId: 'dq1', progress: 50, completed: true, claimed: false }],
        } as never);
        const { container } = renderQuests();
        const dailyTile = container.querySelector('.quests__hub-tile--daily');
        expect(dailyTile?.className).toContain('quests__hub-tile--claimable');
    });
});

describe('Quests — Daily sub-view (unlocked)', () => {
    it('renders the empty-list message when todayQuestDefs is empty', () => {
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--daily') as HTMLButtonElement);
        const empties = container.querySelectorAll('.quests__empty');
        const hasEmpty = Array.from(empties).some(
            (n) => n.textContent?.includes('Brak questow'),
        );
        expect(hasEmpty).toBe(true);
    });

    it('renders one quest card per todayQuestDef when active', () => {
        useDailyQuestStore.setState({
            lastRefreshDate: getTodayKey(),
            todayQuestDefs: [
                {
                    id: 'dq_kill_50',
                    name_pl: 'Zabij 50 potworow',
                    name_en: 'Kill 50 monsters',
                    description_pl: 'Zabij dowolne 50 potworow',
                    minLevel: 25,
                    goal: { type: 'kill_any', count: 50 },
                    rewards: { gold: 1000, xp: 500 },
                },
            ],
            activeQuests: [
                { questId: 'dq_kill_50', progress: 25, completed: false, claimed: false },
            ],
        });
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--daily') as HTMLButtonElement);
        const cards = container.querySelectorAll('.quests__daily-quest');
        expect(cards.length).toBe(1);
        expect(container.textContent).toContain('Zabij 50 potworow');
    });
});

describe('Quests — Daily sub-view (locked)', () => {
    it('renders the locked card when character level < 25', () => {
        useCharacterStore.setState({ character: makeChar({ level: 10 }) });
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--daily') as HTMLButtonElement);
        expect(container.querySelector('.quests__daily-locked')).not.toBeNull();
        expect(container.querySelector('.quests__daily-list')).toBeNull();
    });
});

describe('Quests — Tasks sub-view', () => {
    it('renders the filter chips strip + level filter input', () => {
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--tasks') as HTMLButtonElement);
        const controls = container.querySelector('.quests__sub-controls');
        expect(controls).not.toBeNull();
        expect(container.querySelector('.quests__lvl-filter')).not.toBeNull();
    });

    it('toggles the available-only chip when clicked', () => {
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--tasks') as HTMLButtonElement);
        const availChip = Array.from(container.querySelectorAll('.quests__filter-chip')).find(
            (b) => b.textContent?.includes('Dostępne'),
        ) as HTMLButtonElement;
        expect(availChip.className).not.toContain('quests__filter-chip--on');
        fireEvent.click(availChip);
        expect(availChip.className).toContain('quests__filter-chip--on');
    });

    it('renders active task rows when an active task exists', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1',
                monsterId: 'rabbit',
                monsterLevel: 1,
                monsterName: 'Krolik',
                killCount: 10,
                rewardGold: 100,
                rewardXp: 50,
                progress: 3,
                startedAt: '2026-05-22T00:00:00.000Z',
            }],
        } as never);
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--tasks') as HTMLButtonElement);
        expect(container.querySelector('.tasks__active-box')).not.toBeNull();
        expect(container.textContent).toContain('Krolik');
    });
});

describe('Quests — Quests sub-view', () => {
    it('renders the filter chip strip with the 4 category buttons', () => {
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--quests') as HTMLButtonElement);
        const filterBtns = container.querySelectorAll('.quests__filter-btn');
        expect(filterBtns.length).toBe(4);
    });

    it('marks "Wszystkie" as the default active filter', () => {
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--quests') as HTMLButtonElement);
        const active = container.querySelector('.quests__filter-btn--active');
        expect(active?.textContent).toContain('Wszystkie');
    });

    it('switches the active filter when "Aktywne" is clicked', () => {
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--quests') as HTMLButtonElement);
        const aktywne = Array.from(container.querySelectorAll('.quests__filter-btn')).find(
            (b) => b.textContent?.includes('Aktywne'),
        ) as HTMLButtonElement;
        fireEvent.click(aktywne);
        expect(aktywne.className).toContain('quests__filter-btn--active');
    });
});

describe('Quests — hydrated-null level filter regression', () => {
    it('renders the Tasks sub-view without crashing when taskFilterLvlFrom is null', () => {
        useSettingsStore.setState({ taskFilterLvlFrom: null as unknown as string });
        const { container } = renderQuests();
        fireEvent.click(container.querySelector('.quests__hub-tile--tasks') as HTMLButtonElement);
        expect(container.querySelector('.tasks__list')).not.toBeNull();
        const lvlInput = container.querySelector('.quests__lvl-filter') as HTMLInputElement | null;
        expect(lvlInput).not.toBeNull();
        expect(lvlInput?.value).toBe('');
    });
});

describe('Quests — edge cases', () => {
    it('still renders the root and 3 hub tiles when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderQuests();
        expect(container.querySelector('.quests')).not.toBeNull();
        expect(container.querySelectorAll('.quests__hub-tile').length).toBe(3);
    });

    it('does not render any claim/abandon modals on initial mount', () => {
        const { container } = renderQuests();
        expect(container.querySelector('.quests__claim-modal')).toBeNull();
        expect(container.querySelector('.quests__abandon-modal')).toBeNull();
    });
});

