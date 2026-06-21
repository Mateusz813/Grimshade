import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * AllyCard — one slot in the 4-slot ally column. Renders avatar, HP/MP bars,
 * level/aggro badges, summon stack badges (Necromancer), hit pulse, skill
 * animation overlays, and floating numbers. Empty slot renders as a
 * transparent placeholder.
 *
 * `isImageUrl` stubbed so URL-vs-emoji branching is deterministic without
 * pulling in real Vite-resolved asset modules.
 */
vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        isImageUrl: (icon: string) => icon.startsWith('/') || icon.startsWith('http'),
    };
});

import AllyCard from './AllyCard';
import type { ICombatAlly } from './types';

afterEach(() => {
    cleanup();
});

const makeAlly = (overrides: Partial<ICombatAlly> = {}): ICombatAlly => ({
    id: 'ally-1',
    name: 'Hero',
    avatarUrl: '/avatar.png',
    accentColor: '#e53935',
    className: 'Knight',
    currentHp: 80,
    maxHp: 100,
    currentMp: 20,
    maxMp: 50,
    isDead: false,
    isPlayer: true,
    aggroCount: 0,
    ...overrides,
});

describe('AllyCard — empty slot', () => {
    it('renders a placeholder with aria-hidden when ally is null', () => {
        const { container } = render(<AllyCard ally={null} />);
        const el = container.querySelector('.combat-ui__ally--empty');
        expect(el).toBeTruthy();
        expect(el?.getAttribute('aria-hidden')).toBe('true');
    });
});

describe('AllyCard — smoke', () => {
    it('renders the ally name and avatar image', () => {
        render(<AllyCard ally={makeAlly()} />);
        expect(screen.getByText('Hero')).toBeTruthy();
        const img = document.querySelector('.combat-ui__ally-avatar img') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe('/avatar.png');
    });

    it('applies the player modifier class for the local player', () => {
        const { container } = render(<AllyCard ally={makeAlly({ isPlayer: true })} />);
        expect(container.querySelector('.combat-ui__ally--player')).toBeTruthy();
    });

    it('applies the bot modifier class for non-player allies', () => {
        const { container } = render(<AllyCard ally={makeAlly({ isPlayer: false })} />);
        expect(container.querySelector('.combat-ui__ally--bot')).toBeTruthy();
    });

    it('marks the card as dead with skull overlay when isDead is true', () => {
        const { container } = render(<AllyCard ally={makeAlly({ isDead: true })} />);
        expect(container.querySelector('.combat-ui__ally--dead')).toBeTruthy();
        // Skull renders via <Emoji> as a Twemoji <img> inside the overlay span.
        expect(
            container.querySelector('.combat-ui__ally-skull svg.game-icon[data-icon="skull"]'),
        ).toBeTruthy();
    });

    it('exposes the accent color as a CSS custom property', () => {
        const { container } = render(<AllyCard ally={makeAlly({ accentColor: '#abcdef' })} />);
        const card = container.querySelector('.combat-ui__ally') as HTMLElement;
        expect(card.style.getPropertyValue('--ally-accent')).toBe('#abcdef');
    });
});

describe('AllyCard — badges & overlays', () => {
    it('shows the level badge when level > 0', () => {
        render(<AllyCard ally={makeAlly({ level: 42 })} />);
        expect(screen.getByText('Lv 42')).toBeTruthy();
    });

    it('does not show the level badge when level is 0 or undefined', () => {
        const { container } = render(<AllyCard ally={makeAlly({ level: 0 })} />);
        expect(container.querySelector('.combat-ui__ally-level')).toBeNull();
    });

    it('shows the aggro badge when aggroCount > 0', () => {
        const { container } = render(<AllyCard ally={makeAlly({ aggroCount: 3 })} />);
        expect(container.querySelector('.combat-ui__ally-aggro')).toBeTruthy();
        expect(screen.getByText('×3')).toBeTruthy();
    });

    it('hides the aggro badge when aggroCount is 0', () => {
        const { container } = render(<AllyCard ally={makeAlly({ aggroCount: 0 })} />);
        expect(container.querySelector('.combat-ui__ally-aggro')).toBeNull();
    });

    it('applies the transform tier modifier class', () => {
        const { container } = render(<AllyCard ally={makeAlly({ transformTier: 2 })} />);
        expect(container.querySelector('.combat-ui__ally--t2')).toBeTruthy();
    });

    it('renders shake parity class odd/even based on hitPulse', () => {
        const { container, rerender } = render(<AllyCard ally={makeAlly({ hitPulse: 1 })} />);
        expect(container.querySelector('.combat-ui__ally--shake-b')).toBeTruthy();
        rerender(<AllyCard ally={makeAlly({ hitPulse: 2 })} />);
        expect(container.querySelector('.combat-ui__ally--shake-a')).toBeTruthy();
    });

    it('renders the hit-pulse overlay keyed by hitPulse number', () => {
        const { container } = render(<AllyCard ally={makeAlly({ hitPulse: 5 })} />);
        expect(container.querySelector('.combat-ui__ally-hit-pulse')).toBeTruthy();
    });

    it('does not render shake or hit-pulse when hitPulse is 0', () => {
        const { container } = render(<AllyCard ally={makeAlly({ hitPulse: 0 })} />);
        expect(container.querySelector('.combat-ui__ally-hit-pulse')).toBeNull();
        expect(container.querySelector('.combat-ui__ally--shake-a')).toBeNull();
        expect(container.querySelector('.combat-ui__ally--shake-b')).toBeNull();
    });
});

describe('AllyCard — summon badges', () => {
    it('renders per-type summon badges when summonsByType has counts', () => {
        render(<AllyCard ally={makeAlly({ summonsByType: { skeleton: 2, ghost: 1 } })} />);
        // Each badge renders <Emoji> as a Twemoji <img> followed by ×N text.
        // Locate the badge by its emoji img, then assert the ×N text sibling.
        const skeletonBtn = document
            .querySelector('svg.game-icon[data-icon="skull"]')
            ?.closest('button.combat-ui__ally-summon-badge');
        expect(skeletonBtn?.textContent).toBe('×2');
        const ghostBtn = document
            .querySelector('svg.game-icon[data-icon="ghost"]')
            ?.closest('button.combat-ui__ally-summon-badge');
        expect(ghostBtn?.textContent).toBe('×1');
    });

    it('fires onSummonClick with the type when a badge is clicked', () => {
        const onSummonClick = vi.fn();
        render(
            <AllyCard
                ally={makeAlly({ summonsByType: { demon: 4 }, onSummonClick })}
            />,
        );
        const demonBtn = document
            .querySelector('svg.game-icon[data-icon="smiling-face-with-horns"]')
            ?.closest('button.combat-ui__ally-summon-badge') as HTMLButtonElement;
        fireEvent.click(demonBtn);
        expect(onSummonClick).toHaveBeenCalledWith('demon');
    });

    it('disables badges (no click) when onSummonClick is not provided', () => {
        render(<AllyCard ally={makeAlly({ summonsByType: { lich: 1 } })} />);
        const btn = document
            .querySelector('svg.game-icon[data-icon="crown"]')
            ?.closest('button') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('does not render the summon stack when all counts are zero', () => {
        const { container } = render(
            <AllyCard ally={makeAlly({ summonsByType: { skeleton: 0, ghost: 0, demon: 0, lich: 0 } })} />,
        );
        expect(container.querySelector('.combat-ui__ally-summon-stack')).toBeNull();
    });
});

describe('AllyCard — floats & skill animations', () => {
    it('renders floating damage/heal entries with their values', () => {
        const { container } = render(
            <AllyCard
                ally={makeAlly({
                    floats: [
                        { id: 1, value: 25, kind: 'damage' },
                        { id: 2, value: 12, kind: 'heal' },
                    ],
                })}
            />,
        );
        const floats = container.querySelectorAll('.combat-ui__float');
        expect(floats.length).toBe(2);
        // Heal renders with leading +.
        expect(screen.getByText('+12')).toBeTruthy();
    });

    it('renders the skill animation overlay element when skillAnim is set', () => {
        const { container } = render(
            <AllyCard
                ally={makeAlly({
                    skillAnim: { id: 7, emoji: 'fire', cssClass: 'skill-anim--fire' },
                })}
            />,
        );
        const overlay = container.querySelector('.skill-anim-overlay.skill-anim--fire');
        expect(overlay).toBeTruthy();
        // Non-URL emoji routes through TinyIcon -> <Emoji>, rendering a Twemoji
        // <img> (not text) inside the overlay's .skill-anim-emoji span.
        expect(overlay?.querySelector('svg.game-icon[data-icon="fire"]')).toBeTruthy();
    });

    it('uses <img> for skill animation when emoji is a URL', () => {
        const { container } = render(
            <AllyCard
                ally={makeAlly({
                    skillAnim: { id: 8, emoji: '/anim.png', cssClass: 'skill-anim--ice' },
                })}
            />,
        );
        const img = container.querySelector('.skill-anim-emoji--img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/anim.png');
    });

    it('renders the summon-spawn overlay matching the spawn type', () => {
        const { container } = render(
            <AllyCard
                ally={makeAlly({
                    summonSpawn: { id: 1, type: 'demon' },
                })}
            />,
        );
        expect(container.querySelector('.combat-ui__summon-spawn--demon')).toBeTruthy();
    });
});

describe('AllyCard — bot badge', () => {
    // 2026-06-21: bots no longer carry an icon shortcode in their name; the
    // robot badge is the UI marker that distinguishes an AI bot helper.
    it('renders a robot badge for an AI bot ally', () => {
        const { container } = render(
            <AllyCard ally={makeAlly({ isBot: true, isPlayer: false, name: 'Bot Lecznik' })} />,
        );
        const badge = container.querySelector('.combat-ui__ally-bot-badge svg.game-icon[data-icon="robot"]');
        expect(badge).toBeTruthy();
        // The name renders as plain text (no leftover shortcodes).
        expect(screen.getByText('Bot Lecznik')).toBeTruthy();
    });

    it('does NOT render a robot badge for a human ally', () => {
        const { container } = render(
            <AllyCard ally={makeAlly({ isBot: false, isPlayer: false, name: 'Krasek' })} />,
        );
        expect(container.querySelector('.combat-ui__ally-bot-badge')).toBeNull();
    });
});
