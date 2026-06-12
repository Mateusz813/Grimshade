import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * ItemIcon tests — renders an item tile with rarity-tinted frame, optional
 * upgrade badge, item level, quantity, enhancement glow tier, and a tooltip
 * that toggles on hover / click.
 *
 * `isImageUrl` is stubbed so we don't depend on Vite-resolved asset URLs:
 *   - strings starting with "/" or "http" -> render as <img>
 *   - anything else -> render the emoji span
 */
vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        isImageUrl: (icon: string) => icon.startsWith('/') || icon.startsWith('http'),
    };
});

import ItemIcon from './ItemIcon';

afterEach(() => {
    cleanup();
});

describe('ItemIcon — smoke', () => {
    it('renders an emoji item tile by default', () => {
        const { container } = render(
            <ItemIcon icon="crossed-swords" rarity="common" />,
        );
        expect(container.querySelector('.item-icon')).toBeTruthy();
        // The emoji glyph renders as an inline <svg> (via <GameIcon>), not text.
        expect(
            container.querySelector('.item-icon__emoji svg.game-icon')?.getAttribute('data-icon'),
        ).toBe('crossed-swords');
        // No image element when icon is not a URL (it's an svg, not an img).
        expect(container.querySelector('img')).toBeNull();
    });

    it('renders an <img> when the icon string is a URL', () => {
        const { container } = render(
            <ItemIcon icon="/items/sword.png" rarity="rare" />,
        );
        const img = container.querySelector('img');
        expect(img).toBeTruthy();
        expect(img?.getAttribute('src')).toBe('/items/sword.png');
        expect(container.querySelector('.item-icon__emoji')).toBeNull();
    });

    it('applies the size modifier class (md by default, sm/lg overrides)', () => {
        const { container, rerender } = render(
            <ItemIcon icon="crossed-swords" rarity="common" />,
        );
        expect(container.querySelector('.item-icon--md')).toBeTruthy();

        rerender(<ItemIcon icon="crossed-swords" rarity="common" size="lg" />);
        expect(container.querySelector('.item-icon--lg')).toBeTruthy();
    });

    it('renders selected modifier when selected prop is true', () => {
        const { container } = render(
            <ItemIcon icon="crossed-swords" rarity="common" selected />,
        );
        expect(container.querySelector('.item-icon--selected')).toBeTruthy();
    });
});

describe('ItemIcon — badges & overlays', () => {
    it('renders the +N upgrade badge when upgradeLevel > 0', () => {
        render(<ItemIcon icon="crossed-swords" rarity="rare" upgradeLevel={7} />);
        expect(screen.getByText('+7')).toBeTruthy();
    });

    it('does NOT render the upgrade badge when upgradeLevel is 0', () => {
        const { container } = render(
            <ItemIcon icon="crossed-swords" rarity="rare" upgradeLevel={0} />,
        );
        expect(container.querySelector('.item-icon__upgrade')).toBeNull();
    });

    it('renders item level pill when itemLevel > 0', () => {
        render(<ItemIcon icon="crossed-swords" rarity="rare" itemLevel={42} />);
        expect(screen.getByText('Lv42')).toBeTruthy();
    });

    it('renders quantity overlay only when quantity > 1', () => {
        const { container, rerender } = render(
            <ItemIcon icon="test-tube" rarity="common" quantity={1} />,
        );
        expect(container.querySelector('.item-icon__quantity')).toBeNull();

        rerender(<ItemIcon icon="test-tube" rarity="common" quantity={25} />);
        expect(screen.getByText('x25')).toBeTruthy();
    });

    it('applies enhancement glow tier class at +5 (red) and +20 (goldblack)', () => {
        const { container, rerender } = render(
            <ItemIcon icon="crossed-swords" rarity="rare" upgradeLevel={5} />,
        );
        expect(container.querySelector('.item-icon--enhanced-red')).toBeTruthy();

        rerender(<ItemIcon icon="crossed-swords" rarity="rare" upgradeLevel={20} />);
        expect(container.querySelector('.item-icon--enhanced-goldblack')).toBeTruthy();
    });
});

describe('ItemIcon — interactions', () => {
    it('fires the onClick callback when the tile is clicked', () => {
        const onClick = vi.fn();
        const { container } = render(
            <ItemIcon icon="crossed-swords" rarity="common" onClick={onClick} />,
        );
        fireEvent.click(container.querySelector('.item-icon')!);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('shows tooltip text on hover when tooltip + showTooltip are set', () => {
        const { container } = render(
            <ItemIcon icon="crossed-swords" rarity="legendary" tooltip="Excalibur" />,
        );
        // Tooltip hidden by default.
        expect(container.querySelector('.item-icon__tooltip')).toBeNull();
        fireEvent.mouseEnter(container.querySelector('.item-icon')!);
        expect(screen.getByText('Excalibur')).toBeTruthy();
    });

    it('does not show tooltip when showTooltip is false', () => {
        const { container } = render(
            <ItemIcon icon="crossed-swords" rarity="legendary" tooltip="hidden" showTooltip={false} />,
        );
        fireEvent.mouseEnter(container.querySelector('.item-icon')!);
        expect(container.querySelector('.item-icon__tooltip')).toBeNull();
    });
});
