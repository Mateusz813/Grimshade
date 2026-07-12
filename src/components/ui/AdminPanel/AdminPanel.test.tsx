import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';


import { supabase } from '../../../lib/supabase';
import AdminPanel, { ADMIN_EMAIL } from './AdminPanel';

const setSession = (email: string | null) => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
            session: email
                ? { user: { email } } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']
                : null,
        },
        error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
};

beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockReset();
});

afterEach(() => {
    cleanup();
});

describe('AdminPanel — gating', () => {
    it('renders nothing when session is null', async () => {
        setSession(null);
        const { container } = render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(container.querySelector('.admin-panel')).toBeNull();
        });
    });

    it('renders nothing for a non-admin email', async () => {
        setSession('random@user.com');
        const { container } = render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(vi.mocked(supabase.auth.getSession)).toHaveBeenCalled();
        });
        expect(container.querySelector('.admin-panel')).toBeNull();
        expect(document.querySelector('.admin-panel')).toBeNull();
    });

    it('renders the panel when the admin email matches', async () => {
        setSession(ADMIN_EMAIL);
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        expect(screen.getByRole('dialog', { name: 'Panel administratora' })).toBeTruthy();
    });

    it('matches the admin email case-insensitively', async () => {
        setSession(ADMIN_EMAIL.toUpperCase());
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
    });
});

describe('AdminPanel — chrome', () => {
    beforeEach(() => {
        setSession(ADMIN_EMAIL);
    });

    it('exposes a Postać tab as the default view', async () => {
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        expect(screen.getByText(/Punkty statystyk/)).toBeTruthy();
    });

    it('switches to the Inventory tab on click', async () => {
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        fireEvent.click(screen.getByText(/Inv/));
        expect(screen.getByText('Generator przedmiotów')).toBeTruthy();
    });

    it('fires onClose when the X button is clicked', async () => {
        const onClose = vi.fn();
        render(<AdminPanel onClose={onClose} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        fireEvent.click(screen.getByLabelText('Zamknij'));
        expect(onClose).toHaveBeenCalled();
    });

    it('fires onClose when the backdrop is clicked', async () => {
        const onClose = vi.fn();
        render(<AdminPanel onClose={onClose} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel__backdrop')).toBeTruthy();
        });
        fireEvent.click(document.querySelector('.admin-panel__backdrop')!);
        expect(onClose).toHaveBeenCalled();
    });

    it('does NOT close when click is inside the panel body (stopPropagation)', async () => {
        const onClose = vi.fn();
        render(<AdminPanel onClose={onClose} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        fireEvent.click(document.querySelector('.admin-panel')!);
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('AdminPanel — tab navigation', () => {
    beforeEach(() => {
        setSession(ADMIN_EMAIL);
    });

    it('navigates through every primary tab', async () => {
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        const clickTab = (label: string) => {
            const btn = Array.from(
                document.querySelectorAll<HTMLButtonElement>('.admin-panel__tab'),
            ).find((b) => (b.textContent ?? '').trim() === label);
            if (!btn) throw new Error(`Tab "${label}" not found`);
            fireEvent.click(btn);
        };
        const tabs: Array<[label: string, marker: string]> = [
            ['Inv', 'Generator przedmiotów'],
            ['Skille', 'Akcje masowe'],
            ['Tasks', 'Zabijanie potworów (taski + mastery)'],
            ['Questy', 'Questy fabularne'],
            ['Walki', 'Bossy'],
            ['Społ.', 'Arena'],
            ['System', 'Tryb gry'],
            ['Reset', 'Strefa wybuchu'],
        ];
        for (const [label, marker] of tabs) {
            clickTab(label);
            expect(screen.getByText(marker)).toBeTruthy();
        }
    });
});
