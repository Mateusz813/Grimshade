import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Register view — email/password sign-up via Supabase. Three fields
 * (email + password + confirmPassword) and a refine() rule that ensures
 * the two passwords match.
 *
 * Coverage:
 *   - Smoke render: root, 3 inputs, submit button, "back to login" link.
 *   - Form submit calls supabase.auth.signUp with email + password.
 *   - Successful signup navigates to `/`.
 *   - Server error renders as a root `.register__error`.
 *   - zod refine() flags a mismatch between the two passwords.
 */

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import Register from './Register';
import { supabase } from '../../../lib/supabase';

// The global mock in tests/vitest.setup.ts only stubs signInWithPassword.
// signUp / resetPasswordForEmail aren't in that stub so we add them per
// describe / per test as needed using vi.spyOn.
const signUpSpy = vi.fn();
(supabase.auth as unknown as { signUp: typeof signUpSpy }).signUp = signUpSpy;

const renderRegister = () =>
    render(
        <MemoryRouter>
            <Register />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    signUpSpy.mockReset();
    signUpSpy.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
    cleanup();
});

describe('Register — smoke', () => {
    it('renders the .register root with three inputs', () => {
        const { container } = renderRegister();
        expect(container.querySelector('.register')).not.toBeNull();
        const inputs = container.querySelectorAll('.register__input');
        expect(inputs.length).toBe(3);
    });

    it('renders submit button + back-to-login link', () => {
        const { container } = renderRegister();
        expect(container.querySelector('.register__button')).not.toBeNull();
        const link = container.querySelector('.register__links a') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('/login');
    });

    it('renders the page title', () => {
        const { container } = renderRegister();
        expect(container.querySelector('.register__title')?.textContent).toContain('Rejestracja');
    });
});

describe('Register — submission', () => {
    it('calls supabase.auth.signUp with email + password on submit', async () => {
        const { container } = renderRegister();
        const inputs = container.querySelectorAll('.register__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.change(inputs[2], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(signUpSpy).toHaveBeenCalledWith({
                email: 'user@example.com',
                password: 'secret123',
            });
        });
    });

    it('navigates to / after a successful signup', async () => {
        const { container } = renderRegister();
        const inputs = container.querySelectorAll('.register__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.change(inputs[2], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith('/');
        });
    });

    it('shows a server error from supabase as a root error', async () => {
        signUpSpy.mockResolvedValueOnce({
            data: null,
            error: { message: 'User already registered' },
        });

        const { container } = renderRegister();
        const inputs = container.querySelectorAll('.register__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.change(inputs[2], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('User already registered');
        });
        expect(navigateMock).not.toHaveBeenCalled();
    });
});

describe('Register — validation', () => {
    it('flags mismatched password + confirmPassword with a refine error', async () => {
        const { container } = renderRegister();
        const inputs = container.querySelectorAll('.register__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.change(inputs[2], { target: { value: 'differs999' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Hasła muszą być takie same');
        });
        expect(signUpSpy).not.toHaveBeenCalled();
    });

    it('flags malformed email', async () => {
        const { container } = renderRegister();
        const inputs = container.querySelectorAll('.register__input');
        fireEvent.change(inputs[0], { target: { value: 'no-at-sign' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.change(inputs[2], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Nieprawidłowy email');
        });
        expect(signUpSpy).not.toHaveBeenCalled();
    });
});

// TODO: Verify the disabled-while-submitting button label flip ("Rejestracja…")
//       — same brittleness as Login.test.tsx because react-hook-form's
//       isSubmitting state lives in a microtask cycle.
