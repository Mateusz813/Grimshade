import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('./EnemyCard', () => ({
    default: ({ enemy, onTarget }: { enemy: { id: string; name: string } | null; onTarget?: (e: { id: string; name: string }) => void }) =>
        enemy
            ? (
                <button
                    type="button"
                    data-testid={`enemy-${enemy.id}`}
                    onClick={() => onTarget?.(enemy)}
                >
                    {enemy.name}
                </button>
            )
            : <div data-testid="enemy-empty" />,
}));

vi.mock('./AllyCard', () => ({
    default: ({ ally }: { ally: { id: string; name: string } | null }) =>
        ally
            ? <div data-testid={`ally-${ally.id}`}>{ally.name}</div>
            : <div data-testid="ally-empty" />,
}));

import CombatArena from './CombatArena';
import type { ICombatEnemy, ICombatAlly } from './types';

afterEach(() => {
    cleanup();
});

const makeEnemy = (id: string): ICombatEnemy => ({
    id,
    name: `Enemy ${id}`,
    level: 1,
    sprite: 'ogre',
    currentHp: 100,
    maxHp: 100,
    rarity: 'normal',
    isDead: false,
    isTargetedByPlayer: false,
});

const makeAlly = (id: string): ICombatAlly => ({
    id,
    name: `Ally ${id}`,
    avatarUrl: '/a.png',
    accentColor: '#fff',
    className: 'Knight',
    currentHp: 100,
    maxHp: 100,
    currentMp: 50,
    maxMp: 50,
    isDead: false,
    isPlayer: true,
    aggroCount: 0,
});

describe('CombatArena — smoke', () => {
    it('pads both columns to 4 slots with placeholders', () => {
        render(<CombatArena enemies={[makeEnemy('a')]} allies={[makeAlly('b')]} />);
        expect(screen.getAllByTestId('enemy-empty').length).toBe(3);
        expect(screen.getAllByTestId('ally-empty').length).toBe(3);
        expect(screen.getByTestId('enemy-a')).toBeTruthy();
        expect(screen.getByTestId('ally-b')).toBeTruthy();
    });

    it('truncates input arrays longer than 4', () => {
        const enemies = ['a', 'b', 'c', 'd', 'e', 'f'].map(makeEnemy);
        render(<CombatArena enemies={enemies} allies={[]} />);
        expect(screen.getByTestId('enemy-a')).toBeTruthy();
        expect(screen.getByTestId('enemy-d')).toBeTruthy();
        expect(screen.queryByTestId('enemy-e')).toBeNull();
        expect(screen.queryByTestId('enemy-f')).toBeNull();
    });

    it('applies default arena class without bg variant', () => {
        const { container } = render(<CombatArena enemies={[]} allies={[]} />);
        expect(container.querySelector('.combat-ui__arena')).toBeTruthy();
        expect(container.querySelector('.combat-ui__arena--daily-boss')).toBeNull();
        expect(container.querySelector('.combat-ui__arena--transform')).toBeNull();
    });

    it('applies the daily-boss bg variant modifier', () => {
        const { container } = render(
            <CombatArena enemies={[]} allies={[]} bgVariant="daily-boss" />,
        );
        expect(container.querySelector('.combat-ui__arena--daily-boss')).toBeTruthy();
    });

    it('applies the transform bg variant modifier', () => {
        const { container } = render(
            <CombatArena enemies={[]} allies={[]} bgVariant="transform" />,
        );
        expect(container.querySelector('.combat-ui__arena--transform')).toBeTruthy();
    });

    it('renders overlay when provided', () => {
        const { container } = render(
            <CombatArena
                enemies={[]}
                allies={[]}
                overlay={<div data-testid="overlay-content">FX</div>}
            />,
        );
        expect(container.querySelector('.combat-ui__arena-overlay')).toBeTruthy();
        expect(screen.getByTestId('overlay-content')).toBeTruthy();
    });

    it('does not render overlay element when omitted', () => {
        const { container } = render(<CombatArena enemies={[]} allies={[]} />);
        expect(container.querySelector('.combat-ui__arena-overlay')).toBeNull();
    });
});

describe('CombatArena — interactions', () => {
    it('forwards enemy click to onTargetEnemy', () => {
        const onTargetEnemy = vi.fn();
        const enemy = makeEnemy('clickme');
        render(<CombatArena enemies={[enemy]} allies={[]} onTargetEnemy={onTargetEnemy} />);
        fireEvent.click(screen.getByTestId('enemy-clickme'));
        expect(onTargetEnemy).toHaveBeenCalledWith(enemy);
    });
});
