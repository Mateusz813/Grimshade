import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../ui/Sprite/MonsterSprite', () => ({
    MonsterSprite: (props: { level: number; sprite?: string; name?: string }) => (
        <span data-testid="monster-sprite" data-level={props.level}>{props.sprite ?? '?'}</span>
    ),
    BossSprite: (props: { level: number; sprite?: string; name?: string }) => (
        <span data-testid="boss-sprite" data-level={props.level}>{props.sprite ?? '?'}</span>
    ),
}));

vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        isImageUrl: (icon: string) => icon.startsWith('/') || icon.startsWith('http'),
    };
});

import EnemyCard from './EnemyCard';
import type { ICombatEnemy } from './types';

afterEach(() => {
    cleanup();
});

const makeEnemy = (overrides: Partial<ICombatEnemy> = {}): ICombatEnemy => ({
    id: 'enemy-1',
    name: 'Goblin',
    level: 5,
    sprite: 'ogre',
    currentHp: 50,
    maxHp: 100,
    rarity: 'normal',
    isDead: false,
    isTargetedByPlayer: false,
    ...overrides,
});

describe('EnemyCard — empty slot', () => {
    it('renders an aria-hidden placeholder when enemy is null', () => {
        const { container } = render(<EnemyCard enemy={null} />);
        const el = container.querySelector('.combat-ui__enemy--empty');
        expect(el).toBeTruthy();
        expect(el?.getAttribute('aria-hidden')).toBe('true');
    });
});

describe('EnemyCard — smoke', () => {
    it('renders enemy name and monster sprite', () => {
        render(<EnemyCard enemy={makeEnemy()} />);
        expect(screen.getByText('Goblin')).toBeTruthy();
        expect(screen.getByTestId('monster-sprite')).toBeTruthy();
    });

    it('uses BossSprite when kind = boss', () => {
        render(<EnemyCard enemy={makeEnemy({ kind: 'boss' })} />);
        expect(screen.getByTestId('boss-sprite')).toBeTruthy();
    });

    it('renders a custom imageUrl when provided', () => {
        const { container } = render(
            <EnemyCard enemy={makeEnemy({ imageUrl: '/transform.png' })} />,
        );
        const img = container.querySelector('.combat-ui__enemy-sprite img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/transform.png');
        expect(screen.queryByTestId('monster-sprite')).toBeNull();
    });

    it('applies rarity modifier class', () => {
        const { container } = render(<EnemyCard enemy={makeEnemy({ rarity: 'epic' })} />);
        expect(container.querySelector('.combat-ui__enemy--epic')).toBeTruthy();
    });

    it('renders rarity banner for strong/epic/legendary/boss', () => {
        render(<EnemyCard enemy={makeEnemy({ rarity: 'strong' })} />);
        expect(screen.getByText('STRONG')).toBeTruthy();
    });

    it('does not render rarity banner for normal mobs', () => {
        const { container } = render(<EnemyCard enemy={makeEnemy({ rarity: 'normal' })} />);
        expect(container.querySelector('.combat-ui__enemy-rarity')).toBeNull();
    });

    it('marks card dead with skull when isDead = true and disables button', () => {
        const { container } = render(<EnemyCard enemy={makeEnemy({ isDead: true })} />);
        expect(container.querySelector('.combat-ui__enemy--dead')).toBeTruthy();
        const btn = container.querySelector('button.combat-ui__enemy') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(
            container.querySelector('.combat-ui__enemy-skull svg.game-icon[data-icon="skull"]'),
        ).toBeTruthy();
    });

    it('renders target indicator and targeted modifier when isTargetedByPlayer', () => {
        const { container } = render(<EnemyCard enemy={makeEnemy({ isTargetedByPlayer: true })} />);
        expect(container.querySelector('.combat-ui__enemy--targeted')).toBeTruthy();
        expect(container.querySelector('.combat-ui__enemy-target')).toBeTruthy();
    });
});

describe('EnemyCard — interactions', () => {
    it('fires onTarget with the enemy when the tile is clicked', () => {
        const onTarget = vi.fn();
        const enemy = makeEnemy();
        const { container } = render(<EnemyCard enemy={enemy} onTarget={onTarget} />);
        fireEvent.click(container.querySelector('button.combat-ui__enemy')!);
        expect(onTarget).toHaveBeenCalledTimes(1);
        expect(onTarget).toHaveBeenCalledWith(enemy);
    });

    it('does not invoke onTarget when no callback provided (no crash)', () => {
        const { container } = render(<EnemyCard enemy={makeEnemy()} />);
        fireEvent.click(container.querySelector('button.combat-ui__enemy')!);
    });
});

describe('EnemyCard — status overlays', () => {
    it('renders stun badge when stunMs > 0', () => {
        const { container } = render(
            <EnemyCard enemy={makeEnemy({ statusOverlay: { stunMs: 1500 } })} />,
        );
        expect(container.querySelector('.combat-ui__status-badge--stun')).toBeTruthy();
        expect(
            container.querySelector('.combat-ui__status-badge--stun svg.game-icon[data-icon="dizzy"]'),
        ).toBeTruthy();
    });

    it('renders paralyze badge', () => {
        const { container } = render(
            <EnemyCard enemy={makeEnemy({ statusOverlay: { paralyzeMs: 2000 } })} />,
        );
        expect(container.querySelector('.combat-ui__status-badge--paral')).toBeTruthy();
        expect(
            container.querySelector('.combat-ui__status-badge--paral svg.game-icon[data-icon="locked"]'),
        ).toBeTruthy();
    });

    it('renders markAmp badge with ×N multiplier label', () => {
        render(
            <EnemyCard
                enemy={makeEnemy({ statusOverlay: { markAmpMs: 3000, markAmpMult: 6 } })}
            />,
        );
        expect(screen.getByText(/×6/)).toBeTruthy();
    });

    it('renders darkRitual badge with pct label', () => {
        render(
            <EnemyCard
                enemy={makeEnemy({ statusOverlay: { darkRitualMs: 4700, darkRitualPct: 25 } })}
            />,
        );
        expect(screen.getByText(/25%/)).toBeTruthy();
    });

    it('does not render status stack when all timers are 0/missing', () => {
        const { container } = render(<EnemyCard enemy={makeEnemy({ statusOverlay: {} })} />);
        expect(container.querySelector('.combat-ui__status-stack')).toBeNull();
    });
});

describe('EnemyCard — floats & hit pulse', () => {
    it('renders floating damage numbers', () => {
        const { container } = render(
            <EnemyCard
                enemy={makeEnemy({
                    floats: [{ id: 1, value: 123, kind: 'damage' }],
                })}
            />,
        );
        expect(container.querySelectorAll('.combat-ui__float').length).toBe(1);
        expect(screen.getByText('123')).toBeTruthy();
    });

    it('shows DEATH ATTACK label without CRIT chip', () => {
        const { container } = render(
            <EnemyCard
                enemy={makeEnemy({
                    floats: [{ id: 1, value: 9999, kind: 'damage', isCrit: true, label: 'DEATH ATTACK' }],
                })}
            />,
        );
        expect(screen.getByText('DEATH ATTACK')).toBeTruthy();
        expect(container.querySelector('.combat-ui__float--death')).toBeTruthy();
        expect(container.querySelector('.combat-ui__float-crit')).toBeNull();
    });

    it('renders hit pulse with left/right strike parity', () => {
        const { container, rerender } = render(
            <EnemyCard enemy={makeEnemy({ hitPulse: 1 })} />,
        );
        expect(container.querySelector('.combat-ui__enemy-hit-pulse--strike-l')).toBeTruthy();
        rerender(<EnemyCard enemy={makeEnemy({ hitPulse: 2 })} />);
        expect(container.querySelector('.combat-ui__enemy-hit-pulse--strike-r')).toBeTruthy();
    });

    it('renders skill animation overlay with the css class', () => {
        const { container } = render(
            <EnemyCard
                enemy={makeEnemy({
                    skillAnim: { id: 7, emoji: 'fire', cssClass: 'skill-anim--fire' },
                })}
            />,
        );
        expect(container.querySelector('.skill-anim-overlay.skill-anim--fire')).toBeTruthy();
    });
});
