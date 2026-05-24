import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import OfflineRewardModal from './OfflineRewardModal';

/**
 * OfflineRewardModal — wrapped in framer-motion's AnimatePresence.
 * When `show` is false the modal unmounts entirely. Click on the
 * overlay or the Odbierz button fires onClose.
 */

afterEach(() => {
    cleanup();
});

describe('OfflineRewardModal — visibility', () => {
    it('does not render content when show is false', () => {
        const { container } = render(
            <OfflineRewardModal
                show={false}
                skillName="Sword Fighting"
                earnedXp={1000}
                timeElapsed={60}
                onClose={() => undefined}
            />,
        );
        expect(container.querySelector('.offline-reward-modal')).toBeNull();
    });

    it('renders modal content when show is true', () => {
        render(
            <OfflineRewardModal
                show
                skillName="Sword Fighting"
                earnedXp={1234}
                timeElapsed={3600}
                onClose={() => undefined}
            />,
        );
        expect(screen.getByText('Trening offline!')).toBeTruthy();
        expect(screen.getByText('Sword Fighting')).toBeTruthy();
        // XP value with PL locale formatting (space/dot grouping).
        const xpSpan = document.querySelector('.offline-reward-modal__xp');
        expect(xpSpan?.textContent).toMatch(/\+1[\s.,]?234 XP/);
    });
});

describe('OfflineRewardModal — formatTime', () => {
    it('formats sub-minute durations in seconds', () => {
        render(
            <OfflineRewardModal
                show
                skillName="x"
                earnedXp={1}
                timeElapsed={42}
                onClose={() => undefined}
            />,
        );
        // The duration is wrapped in <strong>, so we grep the surrounding text.
        expect(screen.getByText('42s')).toBeTruthy();
    });

    it('formats sub-hour durations in minutes and seconds', () => {
        render(
            <OfflineRewardModal
                show
                skillName="x"
                earnedXp={1}
                timeElapsed={125}
                onClose={() => undefined}
            />,
        );
        expect(screen.getByText('2m 5s')).toBeTruthy();
    });

    it('formats multi-hour durations as h+m', () => {
        render(
            <OfflineRewardModal
                show
                skillName="x"
                earnedXp={1}
                timeElapsed={3 * 3600 + 15 * 60}
                onClose={() => undefined}
            />,
        );
        expect(screen.getByText('3h 15m')).toBeTruthy();
    });
});

describe('OfflineRewardModal — interactions', () => {
    it('fires onClose when the Odbierz button is clicked', () => {
        const onClose = vi.fn();
        render(
            <OfflineRewardModal
                show
                skillName="x"
                earnedXp={1}
                timeElapsed={60}
                onClose={onClose}
            />,
        );
        fireEvent.click(screen.getByText('Odbierz'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires onClose when the backdrop overlay is clicked', () => {
        const onClose = vi.fn();
        const { container } = render(
            <OfflineRewardModal
                show
                skillName="x"
                earnedXp={1}
                timeElapsed={60}
                onClose={onClose}
            />,
        );
        const overlay = container.querySelector('.offline-reward-modal__overlay');
        expect(overlay).toBeTruthy();
        fireEvent.click(overlay!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
