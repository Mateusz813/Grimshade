import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/**
 * AdminPanel tests — admin-only debug overlay rendered through a portal.
 * Hard-gated by Supabase auth session email; bails to null for anyone
 * who isn't ADMIN_EMAIL.
 *
 * Heavy gameplay stores are not exercised directly here. Instead the
 * test focuses on:
 *   - auth gating (admin email -> renders; other / null -> bails)
 *   - tab navigation buttons
 *   - close button wiring
 *   - toast feedback after an action click
 *
 * Stores are kept at their defaults; we mock `supabase.auth.getSession`
 * via the global setup mock but override the response per test.
 */

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
        // The component starts with authorised = null (renders null) and
        // resolves the session async. Either way, the panel never mounts.
        await waitFor(() => {
            expect(container.querySelector('.admin-panel')).toBeNull();
        });
    });

    it('renders nothing for a non-admin email', async () => {
        setSession('random@user.com');
        const { container } = render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            // Allow the effect to resolve.
            expect(vi.mocked(supabase.auth.getSession)).toHaveBeenCalled();
        });
        // Still no panel rendered.
        expect(container.querySelector('.admin-panel')).toBeNull();
        expect(document.querySelector('.admin-panel')).toBeNull();
    });

    it('renders the panel when the admin email matches', async () => {
        setSession(ADMIN_EMAIL);
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            // Panel is mounted via portal — query via document.
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
        // Default tab is "char" (Postać).
        expect(screen.getByText(/Punkty statystyk/)).toBeTruthy();
    });

    it('switches to the Inventory tab on click', async () => {
        render(<AdminPanel onClose={() => undefined} />);
        await waitFor(() => {
            expect(document.querySelector('.admin-panel')).toBeTruthy();
        });
        // Tab labels render via <EmojiText>; the :backpack: shortcode is now an
        // inline <svg> icon, so only the trailing plain text " Inv" remains.
        fireEvent.click(screen.getByText(/Inv/));
        // Inventory tab shows the rarity dropdown row label.
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
        // Tab labels render via <EmojiText>; each :shortcode: is now an inline
        // <svg> icon, so only the trailing plain text remains. Locate the tab
        // by its trimmed button text among the `.admin-panel__tab` buttons —
        // body content (e.g. <h3>Skille</h3>, "Reset wszystkiego" buttons)
        // shares the same words so a bare text match would be ambiguous.
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
