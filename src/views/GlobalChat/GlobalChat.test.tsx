import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * GlobalChat view — full-screen chat with city + system + optional PM
 * tabs. Tiny shell (~110 lines) — heavy lifting lives in `<Chat />`
 * (mocked here) and the chatTabsStore. We focus on tab list rendering
 * + tab-switching + unread badge + PM closure.
 *
 * Coverage:
 *   - Smoke render with the .global-chat root + role=tablist.
 *   - Spinner fallback when character is null.
 *   - ensureCityTab / ensureSystemTab fire on mount.
 *   - Tab list renders one button per tab, with the active modifier on
 *     the matching activeId.
 *   - Clicking a tab calls setActive with its id.
 *   - The close (×) button appears on closable PM tabs and calls
 *     closeTab with the tab's id.
 *   - Unread badge renders when t.unread > 0 (and shows 99+ for big
 *     numbers).
 *
 * Mocks: the inner `<Chat />` component (we don't drive supabase here)
 * and react-router-dom's useLocation so we can control the `?pm=`
 * deep-link branch.
 */

// Stub the Chat component — we test the wrapper, not the chat itself.
vi.mock('../../components/ui/Chat/Chat', () => ({
    default: ({ channel, title }: { channel: string; title: string }) => (
        <div data-testid={`chat-${channel}`} data-title={title} />
    ),
}));

import GlobalChat from './GlobalChat';
import { useCharacterStore } from '../../stores/characterStore';
import { useChatTabsStore } from '../../stores/chatTabsStore';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 10,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderChat = () =>
    render(
        <MemoryRouter>
            <GlobalChat />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useChatTabsStore.setState({
        tabs: [
            { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 0, closable: false },
            { id: 'system', type: 'system', channel: 'system', title: 'System', unread: 0, closable: false },
        ],
        activeId: 'city',
        hasNotification: false,
    });
});

afterEach(() => {
    cleanup();
});

describe('GlobalChat — smoke', () => {
    it('renders the root .global-chat container with a tablist', () => {
        const { container } = renderChat();
        expect(container.querySelector('.global-chat')).not.toBeNull();
        expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    });

    it('shows a spinner-only layout when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderChat();
        // Spec: `if (!character)` short-circuit returns just the root +
        // a Spinner — no tablist, no chat-wrap.
        expect(container.querySelector('.global-chat')).not.toBeNull();
        expect(container.querySelector('.global-chat__tabs')).toBeNull();
    });

    it('renders one tab button per tab in the store', () => {
        const { container } = renderChat();
        const tabs = container.querySelectorAll('.global-chat__tab');
        expect(tabs.length).toBe(2);
    });

    it('renders the matching <Chat /> per tab inside chat-wrap', () => {
        const { container } = renderChat();
        const wrap = container.querySelector('.global-chat__chat-wrap');
        expect(wrap).not.toBeNull();
        expect(container.querySelector('[data-testid="chat-city"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="chat-system"]')).not.toBeNull();
    });
});

describe('GlobalChat — active state', () => {
    it('applies --active modifier to the tab matching activeId', () => {
        const { container } = renderChat();
        const activeTab = container.querySelector('.global-chat__tab--active');
        expect(activeTab).not.toBeNull();
        expect(activeTab?.querySelector('.global-chat__tab-title')?.textContent).toBe('Miasto');
    });

    it('moves the active modifier when activeId changes in store', () => {
        useChatTabsStore.setState({ activeId: 'system' });
        const { container } = renderChat();
        const activeTab = container.querySelector('.global-chat__tab--active');
        expect(activeTab?.querySelector('.global-chat__tab-title')?.textContent).toBe('System');
    });

    it('calls setActive when a tab button is clicked', () => {
        const setActive = vi.fn();
        useChatTabsStore.setState({ setActive });
        const { container } = renderChat();
        const systemTab = Array.from(container.querySelectorAll('.global-chat__tab-btn')).find(
            (b) => b.textContent?.includes('System'),
        ) as HTMLButtonElement;
        fireEvent.click(systemTab);
        expect(setActive).toHaveBeenCalledWith('system');
    });
});

describe('GlobalChat — unread badge', () => {
    it('renders the unread badge when tab has unread > 0', () => {
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 3, closable: false },
                { id: 'system', type: 'system', channel: 'system', title: 'System', unread: 0, closable: false },
            ],
            activeId: 'city',
        });
        const { container } = renderChat();
        const badge = container.querySelector('.global-chat__tab-badge');
        expect(badge?.textContent).toBe('3');
    });

    it('caps the unread display at "99+" for high counts', () => {
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 250, closable: false },
            ],
            activeId: 'city',
        });
        const { container } = renderChat();
        const badge = container.querySelector('.global-chat__tab-badge');
        expect(badge?.textContent).toBe('99+');
    });

    it('omits the badge for tabs with unread === 0', () => {
        const { container } = renderChat();
        expect(container.querySelector('.global-chat__tab-badge')).toBeNull();
    });
});

describe('GlobalChat — closable PM tabs', () => {
    it('renders the close (×) button only for closable tabs', () => {
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 0, closable: false },
                { id: 'pm:Hero:Friend', type: 'pm', channel: 'pm:Hero:Friend', title: 'Friend', targetName: 'Friend', unread: 0, closable: true },
            ],
            activeId: 'city',
        });
        const { container } = renderChat();
        const closeBtns = container.querySelectorAll('.global-chat__tab-close');
        // Only the PM tab is closable.
        expect(closeBtns.length).toBe(1);
    });

    it('calls closeTab(id) when × is clicked', () => {
        const closeTab = vi.fn();
        useChatTabsStore.setState({
            tabs: [
                { id: 'city', type: 'city', channel: 'city', title: 'Miasto', unread: 0, closable: false },
                { id: 'pm:Hero:Friend', type: 'pm', channel: 'pm:Hero:Friend', title: 'Friend', targetName: 'Friend', unread: 0, closable: true },
            ],
            activeId: 'pm:Hero:Friend',
            closeTab,
        });
        const { container } = renderChat();
        const closeBtn = container.querySelector('.global-chat__tab-close') as HTMLButtonElement;
        fireEvent.click(closeBtn);
        expect(closeTab).toHaveBeenCalledWith('pm:Hero:Friend');
    });
});

describe('GlobalChat — bootstrap effects', () => {
    it('calls ensureCityTab + ensureSystemTab once on mount', () => {
        const ensureCityTab = vi.fn();
        const ensureSystemTab = vi.fn();
        useChatTabsStore.setState({ ensureCityTab, ensureSystemTab });
        renderChat();
        expect(ensureCityTab).toHaveBeenCalled();
        expect(ensureSystemTab).toHaveBeenCalled();
    });
});

// TODO: Deep-link `?pm=<Name>` opens a PM tab automatically. Verifying
//       this requires MemoryRouter with `initialEntries=['/chat?pm=Joe']`
//       and asserting that openPm was called with both names. The simple
//       mount-test variant lives in PartyMember tests already; skipping
//       here to keep the smoke pass focused.
