import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * CombatActionBar — bottom action bar with 4 skill slots + 1 exit button.
 * Skills accept null for empty placeholders. Exit can be either 'hunt-popup'
 * (opens dialog) or 'flee' (immediate flee).
 *
 * isImageUrl stubbed so we can predictably exercise the icon-URL branch.
 */
vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        isImageUrl: (icon: string) => icon.startsWith('/') || icon.startsWith('http'),
    };
});

import CombatActionBar from './CombatActionBar';
import type { ICombatSkillSlot } from './types';

afterEach(() => {
    cleanup();
});

const makeSkill = (overrides: Partial<ICombatSkillSlot> = {}): ICombatSkillSlot => ({
    id: 'skill-1',
    icon: '⚡',
    name: 'Lightning',
    mpCost: 10,
    cooldownProgress: 1,
    disabled: false,
    onClick: vi.fn(),
    ...overrides,
});

describe('CombatActionBar — smoke', () => {
    it('renders empty placeholder buttons when skill slot is null', () => {
        const { container } = render(
            <CombatActionBar skills={[null, null, null, null]} exit={{ kind: 'flee', onFlee: vi.fn() }} />,
        );
        const empties = container.querySelectorAll('.combat-ui__action-btn--empty');
        expect(empties.length).toBe(4);
    });

    it('pads skills array to length 4', () => {
        const { container } = render(
            <CombatActionBar skills={[makeSkill()]} exit={{ kind: 'flee', onFlee: vi.fn() }} />,
        );
        // 1 real skill + 3 empties + 1 exit.
        expect(container.querySelectorAll('.combat-ui__action-btn--empty').length).toBe(3);
        expect(container.querySelectorAll('.combat-ui__action-btn--skill').length).toBe(1);
    });

    it('renders the exit button with flee aria-label when kind=flee', () => {
        render(
            <CombatActionBar skills={[]} exit={{ kind: 'flee', onFlee: vi.fn() }} />,
        );
        expect(screen.getByLabelText('Ucieknij')).toBeTruthy();
    });

    it('renders the exit button with exit aria-label when kind=hunt-popup', () => {
        render(
            <CombatActionBar skills={[]} exit={{ kind: 'hunt-popup', onOpenDialog: vi.fn() }} />,
        );
        expect(screen.getByLabelText('Wyjdź')).toBeTruthy();
    });
});

describe('CombatActionBar — skill rendering', () => {
    it('renders emoji icon as text when not a URL', () => {
        render(
            <CombatActionBar
                skills={[makeSkill({ icon: '⚡' })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        expect(screen.getByText('⚡')).toBeTruthy();
    });

    it('renders <img> when icon is a URL', () => {
        const { container } = render(
            <CombatActionBar
                skills={[makeSkill({ icon: '/skill.png' })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        const img = container.querySelector('.combat-ui__action-skill-img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/skill.png');
    });

    it('shows MP cost badge when mpCost > 0', () => {
        render(
            <CombatActionBar
                skills={[makeSkill({ mpCost: 25 })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        expect(screen.getByText('25')).toBeTruthy();
    });

    it('hides MP badge when mpCost = 0', () => {
        const { container } = render(
            <CombatActionBar
                skills={[makeSkill({ mpCost: 0 })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        expect(container.querySelector('.combat-ui__action-mp')).toBeNull();
    });

    it('renders cooldown overlay + remaining text when cooldownProgress < 1', () => {
        const { container } = render(
            <CombatActionBar
                skills={[makeSkill({ cooldownProgress: 0.5, cooldownRemainingMs: 2400 })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        expect(container.querySelector('.combat-ui__action-btn--cooldown')).toBeTruthy();
        expect(container.querySelector('.combat-ui__action-cd')).toBeTruthy();
        // ≥ 1s rounds up to ceil.
        expect(screen.getByText('3s')).toBeTruthy();
    });

    it('renders sub-second cooldown with single decimal precision', () => {
        render(
            <CombatActionBar
                skills={[makeSkill({ cooldownProgress: 0.9, cooldownRemainingMs: 420 })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        expect(screen.getByText('0.4s')).toBeTruthy();
    });

    it('applies disabled modifier class', () => {
        const { container } = render(
            <CombatActionBar
                skills={[makeSkill({ disabled: true })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        expect(container.querySelector('.combat-ui__action-btn--disabled')).toBeTruthy();
        expect((container.querySelector('.combat-ui__action-btn--skill') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('CombatActionBar — interactions', () => {
    it('fires the skill onClick when clicked', () => {
        const onClick = vi.fn();
        const { container } = render(
            <CombatActionBar
                skills={[makeSkill({ onClick })]}
                exit={{ kind: 'flee', onFlee: vi.fn() }}
            />,
        );
        fireEvent.click(container.querySelector('.combat-ui__action-btn--skill')!);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('fires onFlee when exit button is clicked in flee mode', () => {
        const onFlee = vi.fn();
        render(
            <CombatActionBar skills={[]} exit={{ kind: 'flee', onFlee }} />,
        );
        fireEvent.click(screen.getByLabelText('Ucieknij'));
        expect(onFlee).toHaveBeenCalledTimes(1);
    });

    it('fires onOpenDialog when exit button is clicked in hunt-popup mode', () => {
        const onOpenDialog = vi.fn();
        render(
            <CombatActionBar skills={[]} exit={{ kind: 'hunt-popup', onOpenDialog }} />,
        );
        fireEvent.click(screen.getByLabelText('Wyjdź'));
        expect(onOpenDialog).toHaveBeenCalledTimes(1);
    });
});
