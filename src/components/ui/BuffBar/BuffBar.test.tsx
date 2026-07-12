import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


vi.mock('../TinyIcon/TinyIcon', () => ({
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

import BuffBar from './BuffBar';
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

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <BuffBar />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
    useCombatStore.setState({ phase: 'idle' });
    useInventoryStore.setState({ consumables: {} });
});

afterEach(() => {
    cleanup();
});

describe('BuffBar — visibility', () => {
    it('renders nothing on characterless routes (/login)', () => {
        useBuffStore.setState({
            allBuffs: [makeBuff()],
        });
        const { container } = renderAt('/login');
        expect(container.querySelector('.buff-bar')).toBeNull();
    });

    it('renders nothing when no buffs and no consumable protections', () => {
        const { container } = renderAt('/inventory');
        expect(container.querySelector('.buff-bar')).toBeNull();
    });

    it('renders when at least one active buff exists', () => {
        useBuffStore.setState({ allBuffs: [makeBuff({ name: 'Boost' })] });
        renderAt('/inventory');
        expect(screen.getByText('Boost')).toBeTruthy();
    });

    it('renders death-protection pill with ×N counter', () => {
        useInventoryStore.setState({ consumables: { death_protection: 2 } });
        renderAt('/inventory');
        expect(screen.getByText('Ochrona')).toBeTruthy();
        expect(screen.getByText('×2')).toBeTruthy();
    });

    it('renders amulet-of-loss pill with ×N counter', () => {
        useInventoryStore.setState({ consumables: { amulet_of_loss: 3 } });
        renderAt('/inventory');
        expect(screen.getByText('AOL')).toBeTruthy();
        expect(screen.getByText('×3')).toBeTruthy();
    });
});

describe('BuffBar — collapse toggle', () => {
    it('collapses pill list to a single counter when toggle clicked', () => {
        useBuffStore.setState({
            allBuffs: [
                makeBuff({ name: 'A' }),
                makeBuff({ name: 'B' }),
            ],
        });
        renderAt('/inventory');
        expect(screen.getByText('A')).toBeTruthy();
        const toggle = document.querySelector('.buff-bar__toggle') as HTMLButtonElement;
        expect(toggle.querySelector('svg.ui-icon')?.getAttribute('data-icon')).toBe('x');
        fireEvent.click(toggle);
        expect(screen.queryByText('A')).toBeNull();
        expect(toggle.querySelector('svg.game-icon')?.getAttribute('data-icon')).toBe('sparkles');
        expect(toggle.textContent).toContain('2');
    });
});

describe('BuffBar — charge / paused variants', () => {
    it('renders charge-based buffs with charges/maxCharges fraction', () => {
        useBuffStore.setState({
            allBuffs: [
                makeBuff({
                    name: 'Krok Cienia',
                    effect: 'shadow_step',
                    charges: 2,
                    maxCharges: 3,
                }),
            ],
        });
        renderAt('/inventory');
        expect(screen.getByText('Krok Cienia')).toBeTruthy();
        expect(screen.getByText('×2 / 3')).toBeTruthy();
    });

    it('marks pausable combat-only buffs as paused when out of combat', () => {
        useCombatStore.setState({ phase: 'idle' });
        useBuffStore.setState({
            allBuffs: [
                makeBuff({
                    name: 'XP Boost',
                    effect: 'xp_boost',
                    timerMode: 'pausable',
                    remainingMs: 120_000,
                    expiresAt: Number.POSITIVE_INFINITY,
                }),
            ],
        });
        renderAt('/inventory');
        const pill = screen.getByText('XP Boost').closest('.buff-bar__pill');
        expect(pill?.className.includes('buff-bar__pill--paused')).toBe(true);
        expect((pill as Element)?.querySelector('svg.game-icon[data-icon="pause-button"]')).toBeTruthy();
    });
});
