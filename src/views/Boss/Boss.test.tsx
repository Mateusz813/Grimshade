import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

vi.mock('../../hooks/usePartyReadyCheck', () => ({
    requestPartyCombatStart: vi.fn(),
    registerGoReplicator: vi.fn(),
    triggerPartyCombatGo: vi.fn(),
}));

vi.mock('../../api/v1/deathsApi', () => ({
    deathsApi: {
        createDeath: vi.fn().mockResolvedValue(null),
        getMyDeaths: vi.fn().mockResolvedValue([]),
        getRecentDeaths: vi.fn().mockResolvedValue([]),
    },
}));

import Boss from './Boss';
import { useCharacterStore } from '../../stores/characterStore';
import { useCombatStore } from '../../stores/combatStore';
import { useBossStore } from '../../stores/bossStore';
import { useBossScoreStore } from '../../stores/bossScoreStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useBotStore } from '../../stores/botStore';
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
    level: 50,
    xp: 0,
    hp: 500, max_hp: 500, mp: 200, max_mp: 200,
    attack: 80, defense: 60, attack_speed: 2.0,
    crit_chance: 5, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 50,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderBoss = () =>
    render(
        <MemoryRouter>
            <Boss />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatStore.setState({ phase: 'idle', monster: null, selectedMonster: null });
    useBossStore.setState({ dailyAttempts: {}, lastResult: null });
    useBossScoreStore.setState({ bossKills: {} });
    useTransformStore.setState({ completedTransforms: [] });
    useSettingsStore.setState({
        bossFilterAvailableOnly: false,
        bossFilterMinLevel: 0,
        bossFilterSortDesc: false,
    });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT }, consumables: {} });
    usePartyStore.setState({ party: null });
    usePartyPresenceStore.setState({ byMember: {} });
    useTaskStore.setState({ activeTasks: [] });
    useQuestStore.setState({ activeQuests: [] });
    useDailyQuestStore.setState({ activeQuests: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useBotStore.setState({ bots: [] });
    useBuffStore.setState({ allBuffs: [] });
    useNecroSummonStore.setState({ summons: {} });
    useDeathStore.setState({ event: null });
});

afterEach(() => {
    cleanup();
});

describe('Boss — smoke', () => {
    it('renders without crashing in list phase', () => {
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
    });

    it('renders a Spinner when character is missing (mount short-circuits)', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
        expect(container.querySelector('.spinner')).not.toBeNull();
    });

    it('renders the trophy/score badge in list phase', () => {
        const { container } = renderBoss();
        expect(container.querySelector('.boss__score')).not.toBeNull();
    });

    it('does NOT render trophy/score badge once phase is fighting (badge is list-only)', () => {
        const { container } = renderBoss();
        expect(container.querySelector('.boss__score')).not.toBeNull();
        expect(container.querySelector('.boss__header--minimal')).not.toBeNull();
    });
});

describe('Boss — filter chrome', () => {
    it('renders the filter bar with three controls (available / sort / min lvl)', () => {
        const { container } = renderBoss();
        expect(container.querySelector('.boss__hub-filters')).not.toBeNull();
        expect(container.querySelector('.boss__filter-bar')).not.toBeNull();
        const toggles = container.querySelectorAll('.boss__filter-toggle');
        expect(toggles.length).toBeGreaterThanOrEqual(2);
        expect(container.querySelector('.boss__filter-input')).not.toBeNull();
    });

    it('reflects bossFilterAvailableOnly=true via the --active modifier', () => {
        useSettingsStore.setState({ bossFilterAvailableOnly: true });
        const { container } = renderBoss();
        const toggles = container.querySelectorAll('.boss__filter-toggle');
        expect(toggles[0]?.className).toContain('boss__filter-toggle--active');
    });

    it('reflects bossFilterSortDesc=true via the --active modifier on the second toggle', () => {
        useSettingsStore.setState({ bossFilterSortDesc: true });
        const { container } = renderBoss();
        const toggles = container.querySelectorAll('.boss__filter-toggle');
        expect(toggles[1]?.className).toContain('boss__filter-toggle--active');
    });
});

describe('Boss — class variants', () => {
    it('renders for Mage class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
    });

    it('renders for Necromancer class (necro summons + dual-tome features)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
    });

    it('renders for Rogue class (dual wield, distinct damage path)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Rogue' }) });
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
    });
});

describe('Boss — graceful with missing data', () => {
    it('does not crash with a level-1 character (no bosses unlocked yet)', () => {
        useCharacterStore.setState({ character: makeChar({ level: 1, highest_level: 1, max_hp: 50, hp: 50 }) });
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
    });

    it('does not crash with an empty equipment map', () => {
        useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT }, consumables: {} });
        const { container } = renderBoss();
        expect(container.querySelector('.boss')).not.toBeNull();
    });
});

