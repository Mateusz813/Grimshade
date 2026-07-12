import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';


vi.mock('../../../api/v1/authApi', () => ({
    authApi: {
        verifyCurrentPassword: vi.fn().mockResolvedValue(true),
        updatePassword: vi.fn().mockResolvedValue(undefined),
    },
}));

import ChangePasswordModal from './ChangePasswordModal';
import { authApi } from '../../../api/v1/authApi';

const renderModal = (onClose = vi.fn()) => {
    render(<ChangePasswordModal onClose={onClose} />);
    return { onClose };
};

const fields = () => {
    const inputs = document.querySelectorAll('.change-password__input');
    return {
        current: inputs[0] as HTMLInputElement,
        password: inputs[1] as HTMLInputElement,
        confirm: inputs[2] as HTMLInputElement,
        form: document.querySelector('.change-password__form') as HTMLFormElement,
    };
};

const fill = (current: string, pass: string, confirm: string) => {
    const f = fields();
    fireEvent.change(f.current, { target: { value: current } });
    fireEvent.change(f.password, { target: { value: pass } });
    fireEvent.change(f.confirm, { target: { value: confirm } });
    fireEvent.submit(f.form);
};

beforeEach(() => {
    vi.mocked(authApi.verifyCurrentPassword).mockReset().mockResolvedValue(true);
    vi.mocked(authApi.updatePassword).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
});

describe('ChangePasswordModal — smoke', () => {
    it('renders the title + three password inputs + buttons', () => {
        renderModal();
        expect(document.querySelector('.change-password__title')?.textContent).toContain('Zmiana hasła');
        const inputs = document.querySelectorAll('.change-password__input');
        expect(inputs.length).toBe(3);
        expect((inputs[0] as HTMLInputElement).autocomplete).toBe('current-password');
        expect((inputs[1] as HTMLInputElement).autocomplete).toBe('new-password');
        const btns = document.querySelectorAll('.change-password__btn');
        expect(btns.length).toBe(2);
    });
});

describe('ChangePasswordModal — validation', () => {
    it('shows "Min. 6 znaków" for a too-short new password', async () => {
        renderModal();
        fill('oldpass', '123', '123');
        await waitFor(() => {
            expect(document.body.textContent).toContain('Min. 6 znaków');
        });
        expect(authApi.verifyCurrentPassword).not.toHaveBeenCalled();
        expect(authApi.updatePassword).not.toHaveBeenCalled();
    });

    it('shows "Hasła muszą być takie same" when new passwords differ', async () => {
        renderModal();
        fill('oldpass', 'abcdef', 'abcdeg');
        await waitFor(() => {
            expect(document.body.textContent).toContain('Hasła muszą być takie same');
        });
        expect(authApi.updatePassword).not.toHaveBeenCalled();
    });
});

describe('ChangePasswordModal — current-password gate', () => {
    it('rejects a wrong current password with an inline error + no update', async () => {
        vi.mocked(authApi.verifyCurrentPassword).mockResolvedValueOnce(false);
        renderModal();
        fill('wrongOld', 'newSecret123', 'newSecret123');
        await waitFor(() => {
            expect(document.body.textContent).toContain('Nieprawidłowe obecne hasło');
        });
        expect(authApi.verifyCurrentPassword).toHaveBeenCalledWith('wrongOld');
        expect(authApi.updatePassword).not.toHaveBeenCalled();
        expect(document.querySelector('.change-password__toast')).toBeNull();
    });
});

describe('ChangePasswordModal — submission', () => {
    it('verifies current password then updates with the new one', async () => {
        renderModal();
        fill('oldpass', 'newSecret123', 'newSecret123');
        await waitFor(() => {
            expect(authApi.verifyCurrentPassword).toHaveBeenCalledWith('oldpass');
            expect(authApi.updatePassword).toHaveBeenCalledWith('newSecret123');
        });
    });

    it('shows the success toast after a successful change', async () => {
        renderModal();
        fill('oldpass', 'newSecret123', 'newSecret123');
        await waitFor(() => {
            expect(document.querySelector('.change-password__toast')?.textContent)
                .toContain('Hasło zmienione pomyślnie');
        });
        expect(document.querySelector('.change-password__form')).toBeNull();
    });

    it('surfaces a server error from update as a root error + no toast', async () => {
        vi.mocked(authApi.updatePassword).mockRejectedValueOnce(
            new Error('Password should be at least 6 characters'),
        );
        renderModal();
        fill('oldpass', 'validpass', 'validpass');
        await waitFor(() => {
            expect(document.querySelector('.change-password__error--root')?.textContent)
                .toContain('Password should be at least 6 characters');
        });
        expect(document.querySelector('.change-password__toast')).toBeNull();
    });
});

describe('ChangePasswordModal — close paths', () => {
    it('calls onClose on Cancel', () => {
        const { onClose } = renderModal();
        const cancel = Array.from(document.querySelectorAll('.change-password__btn'))
            .find((b) => b.textContent?.includes('Anuluj')) as HTMLButtonElement;
        fireEvent.click(cancel);
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose on backdrop click', () => {
        const { onClose } = renderModal();
        const backdrop = document.querySelector('.change-password__backdrop') as HTMLElement;
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose on Escape', () => {
        const { onClose } = renderModal();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
