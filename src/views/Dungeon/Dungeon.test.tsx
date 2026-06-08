import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Dungeon view — multi-wave fights inside a tier. 3322 lines, lots of
 * combat-loop machinery. We test the same surface area as Boss: render
 * contract + phase chrome + class variants.
 *
 * Phases: 'list' | 'entering' | 'running' | 'result'. The cinematic
 * `entering` phase is timer-driven and not viable to verify here.
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

vi.mock('../../hooks/useCombatFx', () => ({
    useCombatFx: () => ({
        enemyFloats: {},
        allyFloats: {},
        enemySkill: {},
        allySkill: {},
        allySummonSpawn: {},
        pushEnemyFloat: vi.fn(),
        pushAllyFloat: vi.fn(),
        triggerEnemySkillAnim: vi.fn(),
        triggerAllySkillAnim: vi.fn(),
        triggerAllySummonSpawn: vi.fn(),
        resetFx: vi.fn(),
        resetAllyFx: vi.fn(),
    }),
}));

vi.mock('../../hooks/useSkillAnim', () => ({
    useSkillAnim: () => ({ overlay: null, trigger: vi.fn() }),
}));

vi.mock('../../hooks/useLevelUpRefill', () => ({
    useLevelUpRefill: vi.fn(),
}));

vi.mock('../../api/v1/deathsApi', () => ({
    deathsApi: {
        createDeath: vi.fn().mockResolvedValue(null),
        getMyDeaths: vi.fn().mockResolvedValue([]),
        getRecentDeaths: vi.fn().mockResolvedValue([]),
    },
}));

import Dungeon from './Dungeon';
import { useCharacterStore } from '../../stores/characterStore';
import { useCombatStore } from '../../stores/combatStore';
import { useDungeonStore } from '../../stores/dungeonStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useBuffStore } from '../../stores/buffStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { useDeathStore } from '../../stores/deathStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 25,
    xp: 0,
    hp: 250, max_hp: 250, mp: 80, max_mp: 80,
    attack: 40, defense: 30, attack_speed: 2.0,
    crit_chance: 5, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 25,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderDungeon = () =>
    render(
        <MemoryRouter>
            <Dungeon />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatStore.setState({ phase: 'idle' });
    useDungeonStore.setState({ dailyAttempts: {}, clearedDungeonIds: {}, lastResult: null });
    useTransformStore.setState({ completedTransforms: [] });
    useSettingsStore.setState({
        dungeonFilterAvailableOnly: false,
        dungeonFilterMinLevel: 0,
        dungeonFilterSortDesc: false,
        skillMode: 'auto',
        autoPotionHpEnabled: false,
        autoPotionMpEnabled: false,
    });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT }, consumables: {} });
    usePartyStore.setState({ party: null });
    useTaskStore.setState({ activeTasks: [] });
    useQuestStore.setState({ activeQuests: [] });
    useDailyQuestStore.setState({ activeQuests: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useBuffStore.setState({ allBuffs: [] });
    useNecroSummonStore.setState({ summons: {} });
    useDeathStore.setState({ event: null });
});

afterEach(() => {
    cleanup();
});

describe('Dungeon — smoke', () => {
    it('renders without crashing in list phase', () => {
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon')).not.toBeNull();
    });

    it('renders a Spinner when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderDungeon();
        // Component short-circuits with `<div className="dungeon"><Spinner/></div>`.
        expect(container.querySelector('.dungeon')).not.toBeNull();
        expect(container.querySelector('.spinner')).not.toBeNull();
    });

    it('renders the dungeon panel in list phase', () => {
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon__panel')).not.toBeNull();
    });
});

describe('Dungeon — filter chrome', () => {
    it('renders the filter bar with the three controls', () => {
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon__hub-filters')).not.toBeNull();
        expect(container.querySelector('.dungeon__filter-bar')).not.toBeNull();
        const toggles = container.querySelectorAll('.dungeon__filter-toggle');
        expect(toggles.length).toBeGreaterThanOrEqual(2);
        expect(container.querySelector('.dungeon__filter-input')).not.toBeNull();
    });

    it('reflects dungeonFilterAvailableOnly=true via --active modifier', () => {
        useSettingsStore.setState({ dungeonFilterAvailableOnly: true });
        const { container } = renderDungeon();
        const toggle = container.querySelector('.dungeon__filter-toggle');
        expect(toggle?.className).toContain('dungeon__filter-toggle--active');
    });

    it('reflects dungeonFilterSortDesc=true on the second toggle', () => {
        useSettingsStore.setState({ dungeonFilterSortDesc: true });
        const { container } = renderDungeon();
        const toggles = container.querySelectorAll('.dungeon__filter-toggle');
        expect(toggles[1]?.className).toContain('dungeon__filter-toggle--active');
    });

    it('shows the Wyczyść (clear) button when any filter is active', () => {
        useSettingsStore.setState({ dungeonFilterMinLevel: 5 });
        const { container } = renderDungeon();
        // Clear button only renders when anyFilterActive is true (see source).
        expect(container.querySelector('.dungeon__filter-clear')).not.toBeNull();
    });
});

describe('Dungeon — class variants', () => {
    it('renders for Mage class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon')).not.toBeNull();
    });

    it('renders for Rogue class (dual-wield branch used in combat damage roll)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Rogue' }) });
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon')).not.toBeNull();
    });

    it('renders for Bard class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Bard' }) });
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon')).not.toBeNull();
    });
});

describe('Dungeon — graceful with edge inputs', () => {
    it('does not crash with a level-1 character (lowest tier unlocked)', () => {
        useCharacterStore.setState({ character: makeChar({ level: 1, max_hp: 50, hp: 50 }) });
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon')).not.toBeNull();
    });

    it('does not crash with no consumables / no equipment', () => {
        useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT }, consumables: {} });
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon')).not.toBeNull();
    });

    it('still renders the filter bar even when settings store is missing optional flags', () => {
        // settingsStore still drives the filter values; setting only the
        // required dungeon-filter keys (no auto-potion etc.) must not break
        // the mount.
        useSettingsStore.setState({
            dungeonFilterAvailableOnly: false,
            dungeonFilterMinLevel: 0,
            dungeonFilterSortDesc: false,
        });
        const { container } = renderDungeon();
        expect(container.querySelector('.dungeon__filter-bar')).not.toBeNull();
    });
});

// TODO: phase==='entering' / 'running' / 'result' branches are timer-
//       driven (ENTRY_ANIM_TOTAL_MS = 2000) and require driving the
//       dungeon entry flow, the per-wave combat tick, and the
//       per-monster aggro split. End-to-end happy-path coverage lives in
//       Playwright (tests/e2e/dungeon/). The pure mechanics (waveroll,
//       drop tables, loss penalty) are covered by dungeonSystem.test.ts.
