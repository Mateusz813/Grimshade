import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


vi.mock('../AvatarMenu/AvatarMenu', () => ({
    __esModule: true,
    default: () => <div data-testid="avatar-menu-stub" />,
}));

vi.mock('../BuffPopover/BuffPopover', () => ({
    __esModule: true,
    default: () => <div data-testid="buff-popover-stub" />,
}));

vi.mock('./TaskBadge', () => ({
    __esModule: true,
    default: ({ claimableCount }: { claimableCount?: number }) => (
        <div data-testid="task-badge-stub" data-claimable={claimableCount ?? 0} />
    ),
}));

vi.mock('../../../data/classAvatars', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../data/classAvatars')>();
    return {
        ...actual,
        getCharacterAvatar: () => '/test-avatar.png',
    };
});

vi.mock('../../../systems/combatEngine', () => ({
    getEffectiveChar: (ch: { max_hp: number; max_mp: number }) => ({
        max_hp: ch.max_hp,
        max_mp: ch.max_mp,
    }),
}));

vi.mock('../../../hooks/useTransformAccent', () => ({
    useTransformAccent: () => ({ accent: '#e53935', accentRgb: '229, 57, 53' }),
}));

import TopHeader from './TopHeader';
import { useCharacterStore } from '../../../stores/characterStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import { EMPTY_EQUIPMENT } from '../../../systems/itemSystem';
import { useBuffStore } from '../../../stores/buffStore';
import { useTransformStore } from '../../../stores/transformStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore } from '../../../stores/questStore';
import { useDailyQuestStore } from '../../../stores/dailyQuestStore';
import type { ICharacter } from '../../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 80, max_hp: 100, mp: 20, max_mp: 40,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 1234, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderHeader = () =>
    render(
        <MemoryRouter>
            <TopHeader />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useInventoryStore.setState({
        gold: 1234,
        consumables: {},
        equipment: { ...EMPTY_EQUIPMENT },
    });
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
    useTransformStore.setState({ completedTransforms: [] });
    useConnectivityStore.setState({ mode: 'online' });
    useTaskStore.setState({ activeTasks: [], completedTasks: [], activeTask: null });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useDailyQuestStore.setState({ activeQuests: [], lastRefreshDate: null, todayQuestDefs: [] });
});

afterEach(() => {
    cleanup();
});

describe('TopHeader — smoke', () => {
    it('returns null when there is no character', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderHeader();
        expect(container.querySelector('.top-header')).toBeNull();
    });

    it('renders core chrome: avatar button, gold pill, task badge stub', () => {
        renderHeader();
        expect(screen.getByLabelText('Menu postaci')).toBeTruthy();
        expect(screen.getByLabelText(/Złoto: /)).toBeTruthy();
        expect(screen.getByTestId('task-badge-stub')).toBeTruthy();
    });

    it('renders the offline status dot when play mode is offline', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        renderHeader();
        expect(screen.getByLabelText('Tryb offline')).toBeTruthy();
    });

    it('renders the online status dot when play mode is online', () => {
        useConnectivityStore.setState({ mode: 'online' });
        renderHeader();
        expect(screen.getByLabelText('Tryb online')).toBeTruthy();
    });
});

describe('TopHeader — HP/MP bars', () => {
    it('renders HP/MP pulse button with correct aria percentages', () => {
        useCharacterStore.setState({ character: makeChar({ hp: 80, max_hp: 100, mp: 20, max_mp: 40 }) });
        renderHeader();
        const pulseBtn = screen.getByLabelText('HP 80% · MP 50%');
        expect(pulseBtn).toBeTruthy();
    });

    it('opens the pulse popover with exact HP/MP values when clicked', () => {
        useCharacterStore.setState({ character: makeChar({ hp: 80, max_hp: 100, mp: 20, max_mp: 40 }) });
        renderHeader();
        const pulseBtn = screen.getByLabelText('HP 80% · MP 50%');
        fireEvent.click(pulseBtn);
        expect(screen.getByRole('dialog', { name: 'Stan HP i MP' })).toBeTruthy();
        expect(screen.getByText('80/100')).toBeTruthy();
        expect(screen.getByText('20/40')).toBeTruthy();
    });
});

describe('TopHeader — avatar popover', () => {
    it('does NOT render AvatarMenu by default', () => {
        renderHeader();
        expect(screen.queryByTestId('avatar-menu-stub')).toBeNull();
    });

    it('renders AvatarMenu stub when avatar button is clicked', () => {
        renderHeader();
        fireEvent.click(screen.getByLabelText('Menu postaci'));
        expect(screen.getByTestId('avatar-menu-stub')).toBeTruthy();
    });
});

describe('TopHeader — buff chip', () => {
    it('does NOT render the buff chip when player has no buffs', () => {
        renderHeader();
        expect(screen.queryByLabelText('Aktywne buffy')).toBeNull();
    });

    it('renders the buff chip with count when buffs are active', () => {
        useBuffStore.setState({
            allBuffs: [
                {
                    id: 'b1',
                    characterId: 'char-1',
                    name: 'Tarcza',
                    icon: 'shield',
                    effect: 'shield',
                    expiresAt: Date.now() + 60_000,
                    timerMode: 'realtime',
                    remainingMs: 0,
                },
            ],
            combatSpeedMult: 1,
        });
        renderHeader();
        const buffBtn = screen.getByLabelText('Aktywne buffy');
        expect(buffBtn).toBeTruthy();
        expect(buffBtn.textContent).toContain('1');
    });

    it('counts AOL + death-protection consumables in the buff chip', () => {
        useInventoryStore.setState({
            gold: 0,
            consumables: { amulet_of_loss: 3, death_protection: 1 },
            equipment: { ...EMPTY_EQUIPMENT },
        });
        renderHeader();
        const buffBtn = screen.getByLabelText('Aktywne buffy');
        expect(buffBtn.textContent).toContain('2');
    });

    it('opens BuffPopover stub when buff chip is clicked', () => {
        useBuffStore.setState({
            allBuffs: [
                {
                    id: 'b1',
                    characterId: 'char-1',
                    name: 'X',
                    icon: 'sparkles',
                    effect: 'x',
                    expiresAt: Date.now() + 60_000,
                    timerMode: 'realtime',
                    remainingMs: 0,
                },
            ],
            combatSpeedMult: 1,
        });
        renderHeader();
        fireEvent.click(screen.getByLabelText('Aktywne buffy'));
        expect(screen.getByTestId('buff-popover-stub')).toBeTruthy();
    });
});

describe('TopHeader — gold pill', () => {
    it('shows gold compact string in the pill', () => {
        useInventoryStore.setState({
            gold: 1234,
            consumables: {},
            equipment: { ...EMPTY_EQUIPMENT },
        });
        renderHeader();
        const goldBtn = screen.getByLabelText('Złoto: 1234');
        expect(goldBtn).toBeTruthy();
    });

    it('opens the gold breakdown popover when clicked', () => {
        renderHeader();
        const goldBtn = screen.getByLabelText('Złoto: 1234');
        fireEvent.click(goldBtn);
        expect(screen.getByRole('dialog', { name: 'Pełna wartość złota' })).toBeTruthy();
    });
});
