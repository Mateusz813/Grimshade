import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * PartyWidget — fixed shield button + popover roster. Hidden without a
 * character / party and on characterless routes. Popover lists each
 * member with HP/MP/damage.
 *
 * getCharacterAvatar + getEffectiveChar are stubbed so we keep the
 * dependency surface flat — both return predictable values.
 */

vi.mock('../../../data/classAvatars', () => ({
    getCharacterAvatar: () => '/avatar.png',
}));

vi.mock('../../../systems/combatEngine', () => ({
    getEffectiveChar: (c: { max_hp: number; max_mp: number }) => ({
        max_hp: c.max_hp,
        max_mp: c.max_mp,
    }),
}));

import PartyWidget from './PartyWidget';
import { useCharacterStore } from '../../../stores/characterStore';
import { usePartyStore } from '../../../stores/partyStore';
import { usePartyDamageStore } from '../../../stores/partyDamageStore';
import { usePartyPresenceStore } from '../../../stores/partyPresenceStore';
import { useTransformStore } from '../../../stores/transformStore';
import type { ICharacter } from '../../../api/v1/characterApi';
import type { IPartyInfo } from '../../../systems/partySystem';

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

const makeParty = (): IPartyInfo => ({
    id: 'party-1',
    leaderId: 'char-1',
    name: 'My Crew',
    members: [
        { id: 'char-1', name: 'Hero', class: 'Knight', level: 5, hp: 100, maxHp: 100, isOnline: true },
        { id: 'char-2', name: 'Buddy', class: 'Mage', level: 6, hp: 80, maxHp: 100, isOnline: true },
    ],
    createdAt: '',
});

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <PartyWidget />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    usePartyStore.setState({ party: makeParty() });
    usePartyDamageStore.setState({ damage: {} });
    usePartyPresenceStore.setState({ byMember: {} });
    useTransformStore.setState({ completedTransforms: [] });
});

afterEach(() => {
    cleanup();
});

describe('PartyWidget — visibility', () => {
    it('renders nothing without a character', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderAt('/');
        expect(container.querySelector('.party-widget__btn')).toBeNull();
    });

    it('renders nothing without an active party', () => {
        usePartyStore.setState({ party: null });
        const { container } = renderAt('/');
        expect(container.querySelector('.party-widget__btn')).toBeNull();
    });

    it('renders nothing on /login (characterless route)', () => {
        const { container } = renderAt('/login');
        expect(container.querySelector('.party-widget__btn')).toBeNull();
    });

    it('renders the shield button with member count when in a party', () => {
        renderAt('/');
        const btn = document.querySelector('.party-widget__btn');
        expect(btn).toBeTruthy();
        // Member count chip shows "2" for the two-member party.
        expect(screen.getByText('2')).toBeTruthy();
    });
});

describe('PartyWidget — popover', () => {
    it('opens popover on shield button click', () => {
        renderAt('/');
        // Popover hidden until clicked.
        expect(document.querySelector('.party-widget__popover')).toBeNull();
        fireEvent.click(document.querySelector('.party-widget__btn')!);
        expect(document.querySelector('.party-widget__popover')).toBeTruthy();
    });

    it('lists every party member with name and level', () => {
        renderAt('/');
        fireEvent.click(document.querySelector('.party-widget__btn')!);
        expect(screen.getByText('Hero')).toBeTruthy();
        expect(screen.getByText('Buddy')).toBeTruthy();
        expect(screen.getByText('Lv 5')).toBeTruthy();
        expect(screen.getByText('Lv 6')).toBeTruthy();
    });

    it('shows total damage in the popover header', () => {
        usePartyDamageStore.setState({
            damage: { 'char-1': 1500, 'char-2': 2300 },
        });
        renderAt('/');
        fireEvent.click(document.querySelector('.party-widget__btn')!);
        // 3800 -> "3.8k" via formatDmg.
        expect(screen.getByText(/3\.8k dmg/)).toBeTruthy();
    });

    it('renders party name in the title bar (My Crew)', () => {
        renderAt('/');
        fireEvent.click(document.querySelector('.party-widget__btn')!);
        expect(screen.getByText('My Crew')).toBeTruthy();
    });

    it('renders ? for ally HP/MP when no presence snapshot exists', () => {
        renderAt('/');
        fireEvent.click(document.querySelector('.party-widget__btn')!);
        // Ally row HP label falls back to "?" until presence broadcasts.
        const allyLabels = document.querySelectorAll('.party-widget__bar-label');
        // Two members × 2 bars = 4 labels. The remote ally's 2 should be "?".
        const fallbackCount = Array.from(allyLabels).filter((l) => l.textContent === '?').length;
        expect(fallbackCount).toBe(2);
    });

    it('uses presence snapshot for ally HP/MP when available', () => {
        usePartyPresenceStore.setState({
            byMember: {
                'char-2': {
                    id: 'char-2',
                    hp: 75, maxHp: 100,
                    mp: 40, maxMp: 50,
                    transformTier: 0,
                    receivedAt: Date.now(),
                },
            },
        });
        renderAt('/');
        fireEvent.click(document.querySelector('.party-widget__btn')!);
        expect(screen.getByText('75/100')).toBeTruthy();
        expect(screen.getByText('40/50')).toBeTruthy();
    });
});
