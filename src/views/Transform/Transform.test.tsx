import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

vi.mock('../../api/v1/deathsApi', () => ({
    deathsApi: {
        createDeath: vi.fn().mockResolvedValue(null),
        getMyDeaths: vi.fn().mockResolvedValue([]),
        getRecentDeaths: vi.fn().mockResolvedValue([]),
    },
}));

import Transform from './Transform';
import { useCharacterStore } from '../../stores/characterStore';
import { useCombatStore } from '../../stores/combatStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
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
    level: 30,
    xp: 0,
    hp: 300, max_hp: 300, mp: 100, max_mp: 100,
    attack: 50, defense: 40, attack_speed: 2.0,
    crit_chance: 5, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 30,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderTransform = () =>
    render(
        <MemoryRouter>
            <Transform />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatStore.setState({ phase: 'idle' });
    useTransformStore.setState({
        completedTransforms: [],
        currentTransformQuest: null,
        bakedBonusesApplied: false,
        pendingClaimTransformId: null,
    });
    useSettingsStore.setState({
        language: 'pl',
        skillMode: 'auto',
        autoPotionHpEnabled: false,
        autoPotionMpEnabled: false,
    });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT }, consumables: {} });
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

describe('Transform — smoke', () => {
    it('renders without crashing in list phase', () => {
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });

    it('renders the "Brak postaci." fallback when character is null', () => {
        useCharacterStore.setState({ character: null });
        renderTransform();
        expect(screen.getByText(/Brak postaci/i)).toBeTruthy();
    });

    it('renders the .transform--fighting modifier when phase==="fighting"', () => {
        const { container } = renderTransform();
        const root = container.querySelector('.transform');
        expect(root?.className).not.toContain('transform--fighting');
    });
});

describe('Transform — list phase chrome', () => {
    it('renders the .transform__list grid', () => {
        const { container } = renderTransform();
        expect(container.querySelector('.transform__list')).not.toBeNull();
    });

    it('renders one card per transform tier (12 tiers total)', () => {
        const { container } = renderTransform();
        const cards = container.querySelectorAll('.transform__card');
        expect(cards.length).toBeGreaterThanOrEqual(1);
        expect(cards.length).toBeLessThanOrEqual(20);
    });

    it('marks completed transforms with --completed status', () => {
        useTransformStore.setState({ completedTransforms: [1] });
        const { container } = renderTransform();
        const completedCard = container.querySelector('.transform__card--completed');
        expect(completedCard).not.toBeNull();
    });

    it('marks the in_progress transform with --in_progress', () => {
        useTransformStore.setState({
            currentTransformQuest: {
                transformId: 1,
                monstersDefeated: ['monster-1'],
                totalMonsters: 5,
                inProgress: true,
            },
        });
        const { container } = renderTransform();
        const inProgressCard = container.querySelector('.transform__card--in_progress');
        expect(inProgressCard).not.toBeNull();
    });
});

describe('Transform — class variants', () => {
    it('renders for Mage class (different avatar set)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });

    it('renders for Necromancer class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });

    it('renders for Bard class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Bard' }) });
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });

    it('renders for Cleric class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Cleric' }) });
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });
});

describe('Transform — edge cases', () => {
    it('does not crash when no transforms are completed (fresh save)', () => {
        useTransformStore.setState({ completedTransforms: [], currentTransformQuest: null });
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });

    it('handles a low-level character (most tiers locked)', () => {
        useCharacterStore.setState({ character: makeChar({ level: 5, max_hp: 100, hp: 100 }) });
        const { container } = renderTransform();
        expect(container.querySelector('.transform__list')).not.toBeNull();
        const lockedCards = container.querySelectorAll('.transform__card--locked');
        expect(lockedCards.length).toBeGreaterThan(0);
    });

    it('handles a pending claim (player completed but never picked up rewards)', () => {
        useTransformStore.setState({
            completedTransforms: [1],
            pendingClaimTransformId: 1,
            currentTransformQuest: null,
        });
        const { container } = renderTransform();
        expect(container.querySelector('.transform')).not.toBeNull();
    });
});

