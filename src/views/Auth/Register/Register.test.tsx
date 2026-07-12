import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


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

