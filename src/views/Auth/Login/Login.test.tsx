import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Login view — email/password sign in via Supabase. Small component
 * (~80 lines), pure form + a single supabase.auth.signInWithPassword
 * call.
 *
 * Coverage:
 *   - Smoke render of the `.login` root + email/password fields.
 *   - Form submit hits supabase.auth.signInWithPassword with typed values.
 *   - Server error renders as `.login__error` text.
 *   - Successful login navigates to `/`.
 *   - zod validation surfaces inline errors on bad email / short password.
 *   - Register / Forgot links present.
 */

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

import Login from './Login';
import { supabase } from '../../../lib/supabase';

const renderLogin = () =>
    render(
        <MemoryRouter>
            <Login />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(supabase.auth.signInWithPassword).mockReset();
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: null, error: null } as never);
});

afterEach(() => {
    cleanup();
});

describe('Login — smoke', () => {
    it('renders the .login root and login__card chrome', () => {
        const { container } = renderLogin();
        expect(container.querySelector('.login')).not.toBeNull();
        expect(container.querySelector('.login__card')).not.toBeNull();
    });

    it('renders email + password inputs with autoComplete hints', () => {
        const { container } = renderLogin();
        const inputs = container.querySelectorAll('.login__input');
        expect(inputs.length).toBe(2);
        const email = inputs[0] as HTMLInputElement;
        const pass = inputs[1] as HTMLInputElement;
        expect(email.type).toBe('email');
        expect(email.autocomplete).toBe('email');
        expect(pass.type).toBe('password');
        expect(pass.autocomplete).toBe('current-password');
    });

    it('renders the submit button + register/forgot links', () => {
        const { container } = renderLogin();
        expect(container.querySelector('.login__button')).not.toBeNull();
        const links = container.querySelectorAll('.login__links a');
        expect(links.length).toBe(2);
        const hrefs = Array.from(links).map((a) => (a as HTMLAnchorElement).getAttribute('href'));
        expect(hrefs).toContain('/register');
        expect(hrefs).toContain('/forgot-password');
    });
});

describe('Login — submission', () => {
    it('calls supabase.auth.signInWithPassword with typed credentials', async () => {
        const { container } = renderLogin();
        const inputs = container.querySelectorAll('.login__input');
        const email = inputs[0] as HTMLInputElement;
        const pass = inputs[1] as HTMLInputElement;
        fireEvent.change(email, { target: { value: 'user@example.com' } });
        fireEvent.change(pass, { target: { value: 'secret123' } });

        const form = container.querySelector('form') as HTMLFormElement;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
                email: 'user@example.com',
                password: 'secret123',
            });
        });
    });

    it('navigates to / after a successful login', async () => {
        const { container } = renderLogin();
        const inputs = container.querySelectorAll('.login__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(navigateMock).toHaveBeenCalledWith('/');
        });
    });

    it('displays a server error from supabase as a root error', async () => {
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
            data: null,
            error: { message: 'Invalid credentials' },
        } as never);

        const { container } = renderLogin();
        const inputs = container.querySelectorAll('.login__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Invalid credentials');
        });
        expect(navigateMock).not.toHaveBeenCalled();
    });
});

describe('Login — client-side validation', () => {
    it('shows an email validation error for malformed input', async () => {
        const { container } = renderLogin();
        const inputs = container.querySelectorAll('.login__input');
        fireEvent.change(inputs[0], { target: { value: 'not-an-email' } });
        fireEvent.change(inputs[1], { target: { value: 'secret123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Nieprawidłowy email');
        });
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('shows a min-length error when password is too short', async () => {
        const { container } = renderLogin();
        const inputs = container.querySelectorAll('.login__input');
        fireEvent.change(inputs[0], { target: { value: 'user@example.com' } });
        fireEvent.change(inputs[1], { target: { value: '123' } });
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
            expect(container.textContent).toContain('Min. 6 znaków');
        });
        expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });
});

// TODO: Cover the loading state of the submit button (isSubmitting -> 'Logowanie…').
//       react-hook-form's isSubmitting flag flips during the async promise but
//       happy-dom + microtask timing makes it brittle to assert on.
