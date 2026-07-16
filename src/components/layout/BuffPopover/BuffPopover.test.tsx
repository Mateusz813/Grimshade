import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';


vi.mock('../../ui/TinyIcon/TinyIcon', () => ({
    default: ({ icon }: { icon: string }) => (
        <span data-testid="tiny-icon">{icon}</span>
    ),
}));

vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        getElixirImage: (id: string) => `/elixir-${id}.png`,
        isImageUrl: () => false,
    };
});

import BuffPopover from './BuffPopover';
import { useBuffStore, type IActiveBuff } from '../../../stores/buffStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatStore } from '../../../stores/combatStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import type { ICharacter } from '../../../api/v1/characterApi';

const makeChar = (id = 'char-1'): ICharacter => ({
    id,
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
} as ICharacter);

const makeBuff = (overrides: Partial<IActiveBuff> = {}): IActiveBuff => ({
    id: `buff-${Math.random().toString(36).slice(2, 6)}`,
    characterId: 'char-1',
    name: 'Tarcza',
    icon: 'shield',
    effect: 'shield',
    expiresAt: Date.now() + 60_000,
    timerMode: 'realtime',
    remainingMs: 0,
    ...overrides,
});

const Harness = ({ onClose = () => undefined }: { onClose?: () => void }) => {
    const anchorRef = useRef<HTMLButtonElement>(null);
    return (
        <div>
            <button ref={anchorRef} data-testid="anchor">anchor</button>
            <BuffPopover anchorRef={anchorRef} onClose={onClose} />
        </div>
    );
};

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
    useCombatStore.setState({ phase: 'idle' });
    useInventoryStore.setState({ consumables: {} });
});

afterEach(() => {
    cleanup();
});

describe('BuffPopover — smoke', () => {
    it('renders nothing when there is no character (returns null)', () => {
        useCharacterStore.setState({ character: null });
        const { container } = render(<Harness />);
        expect(container.querySelector('.buff-popover')).toBeNull();
    });

    it('renders empty-state copy when no buffs / consumables', () => {
        render(<Harness />);
        expect(screen.getByText('Brak aktywnych buffów.')).toBeTruthy();
        expect(screen.getByRole('dialog', { name: 'Aktywne buffy' })).toBeTruthy();
    });
});

describe('BuffPopover — buff list', () => {
    it('lists active realtime buffs for the current character', () => {
        useBuffStore.setState({
            allBuffs: [
                makeBuff({ name: 'Tarcza Many', icon: 'shield', effect: 'mana_shield', expiresAt: Date.now() + 30_000 }),
                makeBuff({ name: 'Berserk', icon: 'crossed-swords', effect: 'berserk', expiresAt: Date.now() + 12_000 }),
            ],
        });
        render(<Harness />);
        expect(screen.getByText('Tarcza Many')).toBeTruthy();
        expect(screen.getByText('Berserk')).toBeTruthy();
        expect(screen.queryByText('Brak aktywnych buffów.')).toBeNull();
    });

    it('hides buffs that belong to a different character', () => {
        useBuffStore.setState({
            allBuffs: [
                makeBuff({ characterId: 'other-char', name: 'NotMine' }),
            ],
        });
        render(<Harness />);
        expect(screen.queryByText('NotMine')).toBeNull();
        expect(screen.getByText('Brak aktywnych buffów.')).toBeTruthy();
    });

    it('renders death-protection counters with the ×N suffix', () => {
        useInventoryStore.setState({
            consumables: { amulet_of_loss: 2, death_protection: 1 },
        });
        render(<Harness />);
        expect(screen.getByText('Eliksir ochrony')).toBeTruthy();
        expect(screen.getByText('×1')).toBeTruthy();
        expect(screen.getByText('Amulet of Loss')).toBeTruthy();
        expect(screen.getByText('×2')).toBeTruthy();
    });

    it('renders charge-based buffs with charges/maxCharges fraction', () => {
        useBuffStore.setState({
            allBuffs: [
                makeBuff({ name: 'Krok Cienia', icon: 'ghost', effect: 'shadow_step', charges: 2, maxCharges: 3 }),
            ],
        });
        render(<Harness />);
        expect(screen.getByText('Krok Cienia')).toBeTruthy();
        expect(screen.getByText('×2 / 3')).toBeTruthy();
    });

    it('renders a realtime XP boost buff without a paused indicator', () => {
        useCombatStore.setState({ phase: 'idle' });
        useBuffStore.setState({
            allBuffs: [
                makeBuff({
                    name: 'XP Boost',
                    icon: 'sparkles',
                    effect: 'xp_boost',
                    timerMode: 'realtime',
                    remainingMs: 0,
                    expiresAt: Date.now() + 120_000,
                }),
            ],
        });
        render(<Harness />);
        const row = screen.getByText('XP Boost').closest('.buff-popover__row');
        expect(row).toBeTruthy();
        expect(row?.className.includes('buff-popover__row--paused')).toBe(false);
        expect((row as Element).querySelector('svg.game-icon[data-icon="pause-button"]')).toBeNull();
    });
});

describe('BuffPopover — close interactions', () => {
    it('calls onClose when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose on outside pointer down (not on anchor / popover)', () => {
        const onClose = vi.fn();
        const { container } = render(<Harness onClose={onClose} />);
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        const evt = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(evt, 'target', { value: outside });
        document.dispatchEvent(evt);
        expect(onClose).toHaveBeenCalled();
        void container;
    });

    it('does NOT close when click target is inside the popover', () => {
        const onClose = vi.fn();
        useBuffStore.setState({ allBuffs: [makeBuff({ name: 'X', effect: 'x' })] });
        const { container } = render(<Harness onClose={onClose} />);
        const popover = container.querySelector('.buff-popover')!;
        const evt = new Event('pointerdown', { bubbles: true });
        Object.defineProperty(evt, 'target', { value: popover });
        document.dispatchEvent(evt);
        expect(onClose).not.toHaveBeenCalled();
    });
});
