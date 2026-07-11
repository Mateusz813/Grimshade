import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import BackendLoader from './BackendLoader';
import { useApiPendingStore } from '../../../stores/apiPendingStore';

describe('BackendLoader', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useApiPendingStore.setState({ pending: 0 });
    });
    afterEach(() => {
        // Unmount between tests — the overlay subscribes to a GLOBAL store, so a
        // leaked instance would react to the next test's pending change too.
        cleanup();
        vi.useRealTimers();
    });

    it('renders nothing while idle', () => {
        render(<BackendLoader />);
        expect(screen.queryByText(/Przetwarzanie/)).toBeNull();
    });

    it('shows the overlay only after the delay while a request is pending', () => {
        render(<BackendLoader />);
        act(() => { useApiPendingStore.setState({ pending: 1 }); });
        // before the delay elapses — still hidden (fast requests never flash it)
        expect(screen.queryByText(/Przetwarzanie/)).toBeNull();
        act(() => { vi.advanceTimersByTime(400); });
        expect(screen.getByText(/Przetwarzanie/)).toBeTruthy();
    });

    it('a request that resolves before the delay never shows the overlay', () => {
        render(<BackendLoader />);
        act(() => { useApiPendingStore.setState({ pending: 1 }); });
        act(() => { vi.advanceTimersByTime(200); });
        act(() => { useApiPendingStore.setState({ pending: 0 }); });
        act(() => { vi.advanceTimersByTime(400); });
        expect(screen.queryByText(/Przetwarzanie/)).toBeNull();
    });

    it('hides again once all requests finish', () => {
        render(<BackendLoader />);
        act(() => { useApiPendingStore.setState({ pending: 1 }); });
        act(() => { vi.advanceTimersByTime(400); });
        expect(screen.getByText(/Przetwarzanie/)).toBeTruthy();
        act(() => { useApiPendingStore.setState({ pending: 0 }); });
        expect(screen.queryByText(/Przetwarzanie/)).toBeNull();
    });
});
