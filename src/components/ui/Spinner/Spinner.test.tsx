import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import Spinner from './Spinner';

/**
 * Spinner smoke tests — pure presentational component.
 *
 * Behaviour:
 *   - default label "Ładowanie..." rendered under the ring
 *   - `silent` suppresses the label
 *   - `size` mutates the BEM modifier class (sm/md/lg)
 *   - root has role="status" and aria-live="polite"
 */

afterEach(() => {
    cleanup();
});

describe('Spinner — smoke', () => {
    it('renders the default Ładowanie... label and status role', () => {
        const { container } = render(<Spinner />);
        expect(screen.getByText('Ładowanie...')).toBeTruthy();
        expect(screen.getByRole('status')).toBeTruthy();
        // Default size class is `--md`.
        expect(container.querySelector('.spinner--md')).toBeTruthy();
    });

    it('renders a custom label when one is provided', () => {
        render(<Spinner label="Buduję arenę…" />);
        expect(screen.getByText('Buduję arenę…')).toBeTruthy();
    });

    it('hides the label when silent is true', () => {
        render(<Spinner label="hidden text" silent />);
        expect(screen.queryByText('hidden text')).toBeNull();
    });

    it('applies the requested size modifier class', () => {
        const { container } = render(<Spinner size="lg" />);
        expect(container.querySelector('.spinner--lg')).toBeTruthy();
        expect(container.querySelector('.spinner--md')).toBeNull();
    });

    it('exposes aria-live=polite so screen readers announce updates', () => {
        const { container } = render(<Spinner />);
        const root = container.querySelector('.spinner');
        expect(root?.getAttribute('aria-live')).toBe('polite');
    });
});
