import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * ForgotPassword view — single email input + supabase
 * resetPasswordForEmail call. On success the form swaps for a success
 * message; on error the message renders inline.
 *
 * Coverage:
 *   • Smoke render: root + email field + submit + back-to-login link.
 *   • Submit calls supabase.auth.resetPasswordForEmail with the email.
 *   • Successful send swaps the form for the success copy.
 *   • Server error renders inline.
 *   • Bad email flagged by zod before the API is even called.
 */

import ForgotPassword from './ForgotPassword';
import { supabase } from '../../../lib/supabase';

// Global setup mocks signInWithPassword + signOut only. Patch the missing
// method onto the same supabase.auth object so the component import
// resolves it.
const resetSpy = vi.fn();
vi.mocked(supabase.auth as unknown as { resetPasswordForEmail: typeof resetSpy }).resetPasswordForEmail = resetSpy;

const renderForgot = () =>
    render(
        <MemoryRouter>
            <ForgotPassword />
        </MemoryRouter>,
    );

beforeEach(() => {
    resetSpy.mockReset();
    resetSpy.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
    cleanup();
});

describe('ForgotPassword — smoke', () => {
    it('renders the .forgot-password root + email input + back-link', () => {
        const { container } = renderForgot();
        expect(container.querySelector('.forgot-password')).not.toBeNull();
        const input = container.querySelector('.forgot-password__input') as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.type).toBe('email');
        const link = container.querySelector('.forgot-password__links a') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('/login');
    });

    it('renders the page title', () => {
        const { container } = renderForgot();
        expect(container.querySelector('.forgot-password__title')?.textContent).toContain('Reset hasła');
    });

    it('renders the submit button', () => {
        const { container } = renderForgot();
        const btn = container.querySelector('.forgot-password__button');
        expect(btn).not.toBeNull();
        expect(btn?.textContent).toContain('Wyślij link');
    });
});

describe('ForgotPassword — submission', () => {
    it('calls supabase.auth.resetPasswordForEmail with the typed email', async () => {
        const { container } = renderForgot();
        const input = container.querySelector('.forgot-password__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'user@example.com' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(resetSpy).toHaveBeenCalledWith('user@example.com');
        });
    });

    it('swaps the form for a success message after a successful send', async () => {
        const { container } = renderForgot();
        const input = container.querySelector('.forgot-password__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'user@example.com' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.querySelector('.forgot-password__success')).not.toBeNull();
        });
        // Form is gone after success.
        expect(container.querySelector('.forgot-password__form')).toBeNull();
    });

    it('renders a server error inline when supabase fails', async () => {
        resetSpy.mockResolvedValueOnce({ data: null, error: { message: 'rate-limited' } });

        const { container } = renderForgot();
        const input = container.querySelector('.forgot-password__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'user@example.com' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('rate-limited');
        });
        // Form still mounted — no swap to success.
        expect(container.querySelector('.forgot-password__form')).not.toBeNull();
        expect(container.querySelector('.forgot-password__success')).toBeNull();
    });
});

describe('ForgotPassword — validation', () => {
    it('flags malformed email and does not call the API', async () => {
        const { container } = renderForgot();
        const input = container.querySelector('.forgot-password__input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'no-at-sign' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Nieprawidłowy email');
        });
        expect(resetSpy).not.toHaveBeenCalled();
    });
});

// TODO: Verify the disabled-while-submitting label ('Wysyłanie…') — same
//       microtask-flake concern as Login/Register.
