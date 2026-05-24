import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import PartyDeathChoice from './PartyDeathChoice';

/**
 * PartyDeathChoice — controlled mid-fight popup. Pure presentational + two
 * action callbacks. Tests cover open/closed gating, button wiring, and the
 * disabled state when there are no alive allies.
 */

afterEach(() => {
    cleanup();
});

describe('PartyDeathChoice — visibility', () => {
    it('returns null when open is false', () => {
        const { container } = render(
            <PartyDeathChoice
                open={false}
                aliveAllies={2}
                onReturnToTown={() => undefined}
                onWaitForResurrection={() => undefined}
            />,
        );
        expect(container.querySelector('.party-death-choice')).toBeNull();
    });

    it('renders the popup when open is true', () => {
        render(
            <PartyDeathChoice
                open
                aliveAllies={3}
                onReturnToTown={() => undefined}
                onWaitForResurrection={() => undefined}
            />,
        );
        expect(screen.getByText('Padłeś!')).toBeTruthy();
        // Alive ally count is interpolated into the subtitle.
        expect(screen.getByText(/3 sojusznik/)).toBeTruthy();
    });
});

describe('PartyDeathChoice — actions', () => {
    it('fires onReturnToTown when Powrót do miasta is clicked', () => {
        const onReturnToTown = vi.fn();
        render(
            <PartyDeathChoice
                open
                aliveAllies={2}
                onReturnToTown={onReturnToTown}
                onWaitForResurrection={() => undefined}
            />,
        );
        fireEvent.click(screen.getByText(/Powrót do miasta/));
        expect(onReturnToTown).toHaveBeenCalledTimes(1);
    });

    it('fires onWaitForResurrection when Czekaj is clicked', () => {
        const onWaitForResurrection = vi.fn();
        render(
            <PartyDeathChoice
                open
                aliveAllies={2}
                onReturnToTown={() => undefined}
                onWaitForResurrection={onWaitForResurrection}
            />,
        );
        fireEvent.click(screen.getByText(/Czekaj na wskrzeszenie/));
        expect(onWaitForResurrection).toHaveBeenCalledTimes(1);
    });

    it('disables the wait button when no allies are alive', () => {
        const onWaitForResurrection = vi.fn();
        render(
            <PartyDeathChoice
                open
                aliveAllies={0}
                onReturnToTown={() => undefined}
                onWaitForResurrection={onWaitForResurrection}
            />,
        );
        const waitBtn = screen.getByText(/Czekaj na wskrzeszenie/) as HTMLButtonElement;
        expect(waitBtn.disabled).toBe(true);
        fireEvent.click(waitBtn);
        expect(onWaitForResurrection).not.toHaveBeenCalled();
    });

    it('handles ally count pluralisation for 1 ally', () => {
        render(
            <PartyDeathChoice
                open
                aliveAllies={1}
                onReturnToTown={() => undefined}
                onWaitForResurrection={() => undefined}
            />,
        );
        // "1 sojusznik" (no suffix on 1).
        expect(screen.getByText(/1 sojusznik\b/)).toBeTruthy();
    });
});
