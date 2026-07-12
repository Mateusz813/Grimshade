import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { CombatHudHost } from './CombatHudHost';
import { useCombatHudStore } from '../../../stores/combatHudStore';

beforeEach(() => {
    useCombatHudStore.setState({ active: false, compact: false });
});

afterEach(() => {
    cleanup();
});

describe('CombatHudHost — store side effects', () => {
    it('sets active=true on mount when active prop is true', () => {
        render(<CombatHudHost active={true}>X</CombatHudHost>);
        expect(useCombatHudStore.getState().active).toBe(true);
    });

    it('sets active=false on mount when active prop is false', () => {
        useCombatHudStore.setState({ active: true });
        render(<CombatHudHost active={false}>X</CombatHudHost>);
        expect(useCombatHudStore.getState().active).toBe(false);
    });

    it('sets compact only when both active AND compact are true', () => {
        render(<CombatHudHost active={true} compact={true}>X</CombatHudHost>);
        expect(useCombatHudStore.getState().compact).toBe(true);
    });

    it('forces compact=false when active is false even if compact prop is true', () => {
        render(<CombatHudHost active={false} compact={true}>X</CombatHudHost>);
        expect(useCombatHudStore.getState().compact).toBe(false);
    });

    it('resets active + compact to false on unmount', () => {
        const { unmount } = render(
            <CombatHudHost active={true} compact={true}>X</CombatHudHost>,
        );
        expect(useCombatHudStore.getState().active).toBe(true);
        expect(useCombatHudStore.getState().compact).toBe(true);
        unmount();
        expect(useCombatHudStore.getState().active).toBe(false);
        expect(useCombatHudStore.getState().compact).toBe(false);
    });
});

describe('CombatHudHost — render', () => {
    it('renders children content', () => {
        render(
            <CombatHudHost active={true}>
                <span data-testid="child">child content</span>
            </CombatHudHost>,
        );
        expect(screen.getByTestId('child')).toBeTruthy();
    });

    it('applies the accent color as --combat-accent CSS var when provided', () => {
        const { container } = render(
            <CombatHudHost active={true} accent="#deadbe">x</CombatHudHost>,
        );
        const root = container.querySelector('.combat-ui__hud-root') as HTMLElement;
        expect(root.style.getPropertyValue('--combat-accent')).toBe('#deadbe');
    });

    it('does not set the --combat-accent var when accent is null/undefined', () => {
        const { container } = render(
            <CombatHudHost active={true}>x</CombatHudHost>,
        );
        const root = container.querySelector('.combat-ui__hud-root') as HTMLElement;
        expect(root.style.getPropertyValue('--combat-accent')).toBe('');
    });
});
