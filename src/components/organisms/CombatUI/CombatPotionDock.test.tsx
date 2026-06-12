import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * CombatPotionDock — floating 4-slot potion column (HP / %HP / MP / %MP).
 * Empty / undefined slots render as transparent placeholders so the column
 * height stays locked.
 *
 * isImageUrl stubbed for deterministic emoji-vs-img branching.
 */
vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        isImageUrl: (icon: string) => icon.startsWith('/') || icon.startsWith('http'),
    };
});

import CombatPotionDock from './CombatPotionDock';
import type { ICombatPotionSlot } from './types';

afterEach(() => {
    cleanup();
});

const makePot = (overrides: Partial<ICombatPotionSlot> = {}): ICombatPotionSlot => ({
    kind: 'hp',
    count: 5,
    cooldownProgress: 1,
    disabled: false,
    onClick: vi.fn(),
    ...overrides,
});

describe('CombatPotionDock — smoke', () => {
    it('renders 4 buttons even when all slots are undefined', () => {
        const { container } = render(<CombatPotionDock />);
        expect(container.querySelectorAll('.combat-ui__pot-dock-btn').length).toBe(4);
        expect(container.querySelectorAll('.combat-ui__pot-dock-btn--empty').length).toBe(4);
    });

    it('renders all 4 potion slots when provided', () => {
        const { container } = render(
            <CombatPotionDock
                hpPotion={makePot({ kind: 'hp' })}
                pctHpPotion={makePot({ kind: 'pct-hp' })}
                mpPotion={makePot({ kind: 'mp' })}
                pctMpPotion={makePot({ kind: 'pct-mp' })}
            />,
        );
        expect(container.querySelectorAll('.combat-ui__pot-dock-btn--hp').length).toBe(1);
        expect(container.querySelectorAll('.combat-ui__pot-dock-btn--pct-hp').length).toBe(1);
        expect(container.querySelectorAll('.combat-ui__pot-dock-btn--mp').length).toBe(1);
        expect(container.querySelectorAll('.combat-ui__pot-dock-btn--pct-mp').length).toBe(1);
    });

    it('shows count badge as "xN"', () => {
        render(<CombatPotionDock hpPotion={makePot({ count: 7 })} />);
        expect(screen.getByText('x7')).toBeTruthy();
    });

    it('uses fallback emoji glyph when no icon URL is provided', () => {
        render(<CombatPotionDock hpPotion={makePot({ kind: 'hp', icon: undefined })} />);
        // HP fallback is 'red-heart'.
        expect(screen.getByText('red-heart')).toBeTruthy();
    });

    it('uses custom icon URL when provided', () => {
        const { container } = render(
            <CombatPotionDock hpPotion={makePot({ icon: '/potion.png' })} />,
        );
        const img = container.querySelector('.combat-ui__pot-dock-icon img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/potion.png');
    });

    it('applies disabled modifier and disabled attr when disabled', () => {
        const { container } = render(
            <CombatPotionDock hpPotion={makePot({ disabled: true })} />,
        );
        const btn = container.querySelector('.combat-ui__pot-dock-btn--hp') as HTMLButtonElement;
        expect(container.querySelector('.combat-ui__pot-dock-btn--disabled')).toBeTruthy();
        expect(btn.disabled).toBe(true);
    });

    it('renders cooldown overlay + remaining time when cooldownProgress < 1', () => {
        const { container } = render(
            <CombatPotionDock
                hpPotion={makePot({ cooldownProgress: 0.5, cooldownRemainingMs: 1800 })}
            />,
        );
        expect(container.querySelector('.combat-ui__pot-dock-btn--cooldown')).toBeTruthy();
        expect(container.querySelector('.combat-ui__pot-dock-cd')).toBeTruthy();
        expect(screen.getByText('2s')).toBeTruthy();
    });
});

describe('CombatPotionDock — interactions', () => {
    it('fires onClick of the matching slot', () => {
        const onClick = vi.fn();
        const { container } = render(
            <CombatPotionDock hpPotion={makePot({ onClick })} />,
        );
        fireEvent.click(container.querySelector('.combat-ui__pot-dock-btn--hp')!);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('empty placeholder buttons are not focusable (tabIndex=-1)', () => {
        const { container } = render(<CombatPotionDock />);
        const empties = container.querySelectorAll<HTMLButtonElement>('.combat-ui__pot-dock-btn--empty');
        empties.forEach((b) => expect(b.tabIndex).toBe(-1));
    });
});
