import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import CombatTopControls from './CombatTopControls';

afterEach(() => {
    cleanup();
});

describe('CombatTopControls — smoke', () => {
    it('renders nothing visible when all props are omitted', () => {
        const { container } = render(<CombatTopControls />);
        // Wrapper still renders but no chip buttons inside.
        expect(container.querySelectorAll('button.combat-ui__chip').length).toBe(0);
    });

    it('renders speed chip with its label', () => {
        render(
            <CombatTopControls speed={{ label: 'x4', onCycle: vi.fn() }} />,
        );
        expect(screen.getByText('x4')).toBeTruthy();
    });

    it('renders auto-skill ON/OFF text based on the on flag', () => {
        const { container, rerender } = render(
            <CombatTopControls autoSkill={{ on: true, onToggle: vi.fn() }} />,
        );
        // Button text is ":sparkles: ON" / ":sparkles: OFF" with leading emoji+space; match
        // the whole text content instead of a child node.
        expect(container.querySelector('button')!.textContent).toMatch(/ON/);
        rerender(<CombatTopControls autoSkill={{ on: false, onToggle: vi.fn() }} />);
        expect(container.querySelector('button')!.textContent).toMatch(/OFF/);
    });

    it('renders extras slot content', () => {
        render(
            <CombatTopControls
                extras={<button type="button" data-testid="extra-btn">Custom</button>}
            />,
        );
        expect(screen.getByTestId('extra-btn')).toBeTruthy();
    });
});

describe('CombatTopControls — interactions', () => {
    it('fires speed.onCycle on click', () => {
        const onCycle = vi.fn();
        render(<CombatTopControls speed={{ label: 'x2', onCycle }} />);
        fireEvent.click(screen.getByText('x2').closest('button')!);
        expect(onCycle).toHaveBeenCalledTimes(1);
    });

    it('fires autoSkill.onToggle on click', () => {
        const onToggle = vi.fn();
        const { container } = render(<CombatTopControls autoSkill={{ on: false, onToggle }} />);
        fireEvent.click(container.querySelector('button')!);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onCycle when speed.disabled is true', () => {
        const onCycle = vi.fn();
        const { container } = render(
            <CombatTopControls speed={{ label: 'x1', onCycle, disabled: true }} />,
        );
        const btn = container.querySelector('button.combat-ui__chip') as HTMLButtonElement;
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(btn);
        expect(onCycle).not.toHaveBeenCalled();
    });

    it('does NOT fire onToggle when autoSkill.disabled is true', () => {
        const onToggle = vi.fn();
        const { container } = render(
            <CombatTopControls autoSkill={{ on: false, onToggle, disabled: true }} />,
        );
        const btn = container.querySelector('button.combat-ui__chip') as HTMLButtonElement;
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(btn);
        expect(onToggle).not.toHaveBeenCalled();
    });

    it('fires autoFight, autoPotion, xpVisible toggles', () => {
        const af = vi.fn();
        const ap = vi.fn();
        const xv = vi.fn();
        render(
            <CombatTopControls
                autoFight={{ on: false, onToggle: af }}
                autoPotion={{ on: false, onToggle: ap }}
                xpVisible={{ on: true, onToggle: xv }}
            />,
        );
        // Each chip carries a unique title attribute -> reliable selector.
        fireEvent.click(screen.getByTitle('Auto walka'));
        fireEvent.click(screen.getByTitle('Auto potion'));
        fireEvent.click(screen.getByTitle('Pokaż pasek XP'));
        expect(af).toHaveBeenCalledTimes(1);
        expect(ap).toHaveBeenCalledTimes(1);
        expect(xv).toHaveBeenCalledTimes(1);
    });
});
