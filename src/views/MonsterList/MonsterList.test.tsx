import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import MonsterList from './MonsterList';
import { useCharacterStore } from '../../stores/characterStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { usePartyStore } from '../../stores/partyStore';
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

const renderMonsterList = () =>
    render(
        <MemoryRouter>
            <MonsterList />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    useCharacterStore.setState({ character: makeChar() });
    useMasteryStore.setState({
        masteries: {},
        masteryKills: {},
        getMasteryBonuses: () => ({ strongBonus: 0, epicBonus: 0, legendaryBonus: 0, bossBonus: 0 }),
    } as never);
    useTaskStore.setState({ activeTasks: [] });
    useQuestStore.setState({ activeQuests: [] });
    usePartyStore.setState({ party: null });
});

afterEach(() => {
    cleanup();
});

describe('MonsterList — smoke', () => {
    it('renders the .combat .monster-list root', () => {
        const { container } = renderMonsterList();
        expect(container.querySelector('.combat.monster-list')).not.toBeNull();
    });

    it('renders the filter bar with toggles + min-lvl input', () => {
        const { container } = renderMonsterList();
        expect(container.querySelector('.combat__filter-bar')).not.toBeNull();
        const toggles = container.querySelectorAll('.combat__filter-toggle');
        expect(toggles.length).toBe(3);
        expect(container.querySelector('.combat__filter-input')).not.toBeNull();
    });

    it('renders monster cards', () => {
        const { container } = renderMonsterList();
        const cards = container.querySelectorAll('.combat__mcard');
        expect(cards.length).toBeGreaterThan(0);
    });
});

describe('MonsterList — filters', () => {
    it('flips the active modifier on the "Tylko dostępne" toggle', () => {
        const { container } = renderMonsterList();
        const toggleLabel = Array.from(container.querySelectorAll('.combat__filter-toggle'))
            .find((b) => b.textContent?.includes('dostępne')) as HTMLLabelElement;
        const input = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
        fireEvent.click(input);
        expect(toggleLabel.className).toContain('combat__filter-toggle--active');
    });

    it('renders the clear-filters button only when at least one filter is on', () => {
        const { container } = renderMonsterList();
        expect(container.querySelector('.combat__filter-clear')).toBeNull();

        const toggleLabel = Array.from(container.querySelectorAll('.combat__filter-toggle'))
            .find((b) => b.textContent?.includes('dostępne')) as HTMLLabelElement;
        const input = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
        fireEvent.click(input);
        expect(container.querySelector('.combat__filter-clear')).not.toBeNull();
    });

    it('clears all filters when the clear button is clicked', () => {
        const { container } = renderMonsterList();
        const toggleLabel = Array.from(container.querySelectorAll('.combat__filter-toggle'))
            .find((b) => b.textContent?.includes('dostępne')) as HTMLLabelElement;
        const input = toggleLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
        fireEvent.click(input);

        fireEvent.click(container.querySelector('.combat__filter-clear') as HTMLButtonElement);
        expect(toggleLabel.className).not.toContain('combat__filter-toggle--active');
        expect(container.querySelector('.combat__filter-clear')).toBeNull();
    });

    it('reduces visible cards when min-level filter is set high', () => {
        const { container } = renderMonsterList();
        const initialCount = container.querySelectorAll('.combat__mcard').length;
        const minLvlInput = container.querySelector('.combat__filter-input input[type="number"]') as HTMLInputElement;
        fireEvent.change(minLvlInput, { target: { value: '999' } });
        const filteredCount = container.querySelectorAll('.combat__mcard').length;
        expect(filteredCount).toBeLessThan(initialCount);
    });
});

describe('MonsterList — fight + drop actions', () => {
    it('opens the drop info modal when :package: is clicked on an unlocked monster', () => {
        const { container } = renderMonsterList();
        const dropBtn = container.querySelector('.combat__mcard-action--info:not(:disabled)') as HTMLButtonElement;
        expect(dropBtn).not.toBeNull();
        fireEvent.click(dropBtn);
        expect(container.querySelector('.combat__drop-modal')).not.toBeNull();
    });

    it('closes the drop info modal when the backdrop is clicked', () => {
        const { container } = renderMonsterList();
        const dropBtn = container.querySelector('.combat__mcard-action--info:not(:disabled)') as HTMLButtonElement;
        fireEvent.click(dropBtn);
        expect(container.querySelector('.combat__drop-modal')).not.toBeNull();

        const closeBtn = container.querySelector('.combat__drop-modal-close') as HTMLButtonElement;
        fireEvent.click(closeBtn);
        expect(container.querySelector('.combat__drop-modal')).toBeNull();
    });

    it('navigates to /combat on fight button click for unlocked monster', () => {
        const { container } = renderMonsterList();
        const fightBtn = container.querySelector('.combat__mcard-action--fight:not(:disabled)') as HTMLButtonElement;
        expect(fightBtn).not.toBeNull();
        fireEvent.click(fightBtn);
        expect(navigateMock).toHaveBeenCalledWith('/combat');
    });
});

describe('MonsterList — fullscreen preview', () => {
    it('opens the fullscreen sprite preview when the sprite button is clicked', () => {
        const { container } = renderMonsterList();
        const spriteBtn = container.querySelector('.combat__mcard-sprite') as HTMLButtonElement;
        fireEvent.click(spriteBtn);
        expect(container.querySelector('.monster-list__fullscreen-backdrop')).not.toBeNull();
    });

    it('closes the fullscreen preview when its close button is clicked', () => {
        const { container } = renderMonsterList();
        const spriteBtn = container.querySelector('.combat__mcard-sprite') as HTMLButtonElement;
        fireEvent.click(spriteBtn);
        const closeBtn = container.querySelector('.monster-list__fullscreen-close') as HTMLButtonElement;
        fireEvent.click(closeBtn);
        expect(container.querySelector('.monster-list__fullscreen-backdrop')).toBeNull();
    });
});

describe('MonsterList — party member gating', () => {
    it('disables fight buttons when in a party but not the leader', () => {
        usePartyStore.setState({
            party: {
                id: 'p1', name: 'p', description: '', isPublic: true, password: null,
                leaderId: 'someone-else', createdAt: new Date().toISOString(),
                members: [
                    { id: 'someone-else', name: 'Boss', class: 'Knight', level: 5, hp: 1, maxHp: 1, isOnline: true },
                    { id: 'char-1', name: 'Hero', class: 'Knight', level: 5, hp: 1, maxHp: 1, isOnline: true },
                ],
            } as never,
        });
        const { container } = renderMonsterList();
        const fightBtns = container.querySelectorAll('.combat__mcard-action--fight');
        const enabled = Array.from(fightBtns).filter((b) => !(b as HTMLButtonElement).disabled);
        expect(enabled.length).toBe(0);
    });

    it('keeps fight buttons enabled when player IS the leader', () => {
        usePartyStore.setState({
            party: {
                id: 'p1', name: 'p', description: '', isPublic: true, password: null,
                leaderId: 'char-1', createdAt: new Date().toISOString(),
                members: [
                    { id: 'char-1', name: 'Hero', class: 'Knight', level: 5, hp: 1, maxHp: 1, isOnline: true },
                ],
            } as never,
        });
        const { container } = renderMonsterList();
        const fightBtns = container.querySelectorAll('.combat__mcard-action--fight');
        const enabled = Array.from(fightBtns).filter((b) => !(b as HTMLButtonElement).disabled);
        expect(enabled.length).toBeGreaterThan(0);
    });
});

describe('MonsterList — edge cases', () => {
    it('renders without crashing when no monster matches the filter', () => {
        const { container } = renderMonsterList();
        const minLvlInput = container.querySelector('.combat__filter-input input[type="number"]') as HTMLInputElement;
        fireEvent.change(minLvlInput, { target: { value: '9999' } });
        expect(container.querySelector('.combat__hub-empty')).not.toBeNull();
        expect(container.textContent).toContain('Żaden potwór nie pasuje');
    });

    it('renders without crashing when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderMonsterList();
        expect(container.querySelector('.combat.monster-list')).not.toBeNull();
    });
});

