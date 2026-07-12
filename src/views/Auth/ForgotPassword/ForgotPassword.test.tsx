import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


import ForgotPassword from './ForgotPassword';
import { supabase } from '../../../lib/supabase';

const resetSpy = vi.fn();
(supabase.auth as unknown as { resetPasswordForEmail: typeof resetSpy }).resetPasswordForEmail = resetSpy;

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

