import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import HuntExitDialog from './HuntExitDialog';

afterEach(() => {
    cleanup();
});

describe('HuntExitDialog — smoke', () => {
    it('renders title, body and both action buttons', () => {
        render(
            <HuntExitDialog
                onEndHunt={vi.fn()}
                onLeaveBackground={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Co chcesz zrobić?')).toBeTruthy();
        expect(screen.getByText('Zakończ polowanie')).toBeTruthy();
        expect(screen.getByText('Wróć do miasta')).toBeTruthy();
    });
});

describe('HuntExitDialog — interactions', () => {
    it('fires onEndHunt when "Zakończ polowanie" is clicked', () => {
        const onEndHunt = vi.fn();
        render(
            <HuntExitDialog
                onEndHunt={onEndHunt}
                onLeaveBackground={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByText('Zakończ polowanie'));
        expect(onEndHunt).toHaveBeenCalledTimes(1);
    });

    it('fires onLeaveBackground when "Wróć do miasta" is clicked', () => {
        const onLeaveBackground = vi.fn();
        render(
            <HuntExitDialog
                onEndHunt={vi.fn()}
                onLeaveBackground={onLeaveBackground}
                onClose={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByText('Wróć do miasta'));
        expect(onLeaveBackground).toHaveBeenCalledTimes(1);
    });

    it('fires onClose when × close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <HuntExitDialog
                onEndHunt={vi.fn()}
                onLeaveBackground={vi.fn()}
                onClose={onClose}
            />,
        );
        fireEvent.click(screen.getByLabelText('Zamknij'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires onClose when the backdrop is clicked', () => {
        const onClose = vi.fn();
        const { container } = render(
            <HuntExitDialog
                onEndHunt={vi.fn()}
                onLeaveBackground={vi.fn()}
                onClose={onClose}
            />,
        );
        fireEvent.click(container.querySelector('.combat-ui__modal-bg')!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onClose when the modal body is clicked (stop propagation)', () => {
        const onClose = vi.fn();
        const { container } = render(
            <HuntExitDialog
                onEndHunt={vi.fn()}
                onLeaveBackground={vi.fn()}
                onClose={onClose}
            />,
        );
        fireEvent.click(container.querySelector('.combat-ui__modal')!);
        expect(onClose).not.toHaveBeenCalled();
    });
});
