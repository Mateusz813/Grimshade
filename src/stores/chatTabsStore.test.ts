import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mock for buildPmChannel ──────────────────────────────────────────
// The store calls `buildPmChannel(myName, targetName)` from `friendsApi` to
// derive a deterministic id. We mock it with a tiny lower-cased+sorted impl
// so the assertions stay readable AND deterministic regardless of arg order.

const { buildPmChannelMock } = vi.hoisted(() => ({
    buildPmChannelMock: vi.fn((a: string, b: string) => {
        const [x, y] = [a, b]
            .map((n) => n.trim())
            .sort((p, q) => p.toLowerCase().localeCompare(q.toLowerCase()));
        return `pm_${x}_${y}`;
    }),
}));

vi.mock('../api/v1/friendsApi', () => ({
    buildPmChannel: buildPmChannelMock,
}));

import { useChatTabsStore } from './chatTabsStore';

// ── Reset helper ─────────────────────────────────────────────────────────────
// chatTabsStore uses zustand `persist`, so we need to forcibly reset to the
// canonical initial shape — the persisted state from a previous test (or
// the auto-merge logic) could otherwise leak.

const INITIAL_TABS = [
    {
        id: 'city',
        type: 'city' as const,
        channel: 'city',
        title: '🌆 Miasto',
        unread: 0,
        closable: false,
    },
    {
        id: 'system',
        type: 'system' as const,
        channel: 'system',
        title: '⚠️ System',
        unread: 0,
        closable: false,
    },
];

beforeEach(() => {
    useChatTabsStore.setState({
        tabs: INITIAL_TABS.map((t) => ({ ...t })),
        activeId: 'city',
        hasNotification: false,
    });
    buildPmChannelMock.mockClear();
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('chatTabsStore — initial state', () => {
    it('starts with city + system tabs only', () => {
        const { tabs } = useChatTabsStore.getState();
        expect(tabs.map((t) => t.id)).toEqual(['city', 'system']);
    });

    it('activeId is city by default', () => {
        expect(useChatTabsStore.getState().activeId).toBe('city');
    });

    it('hasNotification is false initially', () => {
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });
});

// ── ensureCityTab ────────────────────────────────────────────────────────────

describe('ensureCityTab', () => {
    it('is a no-op when the city tab is already present', () => {
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().ensureCityTab();
        expect(useChatTabsStore.getState().tabs).toBe(before);
    });

    it('adds the city tab back if it somehow got removed', () => {
        useChatTabsStore.setState({ tabs: [INITIAL_TABS[1]], activeId: 'system' });
        useChatTabsStore.getState().ensureCityTab();
        const ids = useChatTabsStore.getState().tabs.map((t) => t.id);
        expect(ids).toContain('city');
    });
});

// ── ensureSystemTab ──────────────────────────────────────────────────────────

describe('ensureSystemTab', () => {
    it('is a no-op when system tab is already present', () => {
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().ensureSystemTab();
        expect(useChatTabsStore.getState().tabs).toBe(before);
    });

    it('re-adds the system tab when missing', () => {
        useChatTabsStore.setState({ tabs: [INITIAL_TABS[0]], activeId: 'city' });
        useChatTabsStore.getState().ensureSystemTab();
        const ids = useChatTabsStore.getState().tabs.map((t) => t.id);
        expect(ids).toContain('system');
    });
});

// ── openPm ───────────────────────────────────────────────────────────────────

describe('openPm', () => {
    it('creates a new PM tab and focuses it', () => {
        const channel = useChatTabsStore.getState().openPm('Me', 'Alice');
        const s = useChatTabsStore.getState();
        expect(s.activeId).toBe(channel);
        const pm = s.tabs.find((t) => t.id === channel);
        expect(pm).toBeDefined();
        expect(pm?.type).toBe('pm');
        expect(pm?.closable).toBe(true);
        expect(pm?.targetName).toBe('Alice');
        expect(pm?.title).toContain('Alice');
    });

    it('returns the channel id from buildPmChannel', () => {
        const channel = useChatTabsStore.getState().openPm('Me', 'Bob');
        expect(channel).toBe('pm_Bob_Me');
    });

    it('focuses an existing PM tab without duplicating it', () => {
        useChatTabsStore.getState().openPm('Me', 'Alice');
        const beforeLen = useChatTabsStore.getState().tabs.length;
        useChatTabsStore.getState().openPm('Me', 'Alice');
        expect(useChatTabsStore.getState().tabs.length).toBe(beforeLen);
    });

    it('clears unread count when re-opening an existing PM tab', () => {
        const ch = useChatTabsStore.getState().openPm('Me', 'Alice');
        // Switch away so we can accumulate unread on the PM tab.
        useChatTabsStore.getState().setActive('city');
        useChatTabsStore.getState().incrementUnread(ch);
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === ch)?.unread,
        ).toBe(1);
        useChatTabsStore.getState().openPm('Me', 'Alice');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === ch)?.unread,
        ).toBe(0);
    });
});

// ── ensurePmTab ──────────────────────────────────────────────────────────────

describe('ensurePmTab', () => {
    it('adds a background PM tab without stealing focus', () => {
        useChatTabsStore.setState({ activeId: 'city' });
        const ch = useChatTabsStore.getState().ensurePmTab('Me', 'Alice');
        const s = useChatTabsStore.getState();
        expect(s.activeId).toBe('city'); // still on city
        expect(s.tabs.some((t) => t.id === ch)).toBe(true);
    });

    it('is idempotent when called repeatedly for the same PM', () => {
        const ch1 = useChatTabsStore.getState().ensurePmTab('Me', 'Alice');
        const len1 = useChatTabsStore.getState().tabs.length;
        const ch2 = useChatTabsStore.getState().ensurePmTab('Me', 'Alice');
        const len2 = useChatTabsStore.getState().tabs.length;
        expect(ch1).toBe(ch2);
        expect(len1).toBe(len2);
    });
});

// ── syncPartyTab ─────────────────────────────────────────────────────────────

describe('syncPartyTab', () => {
    it('adds a party tab when joining a party', () => {
        useChatTabsStore.getState().syncPartyTab('party-123');
        const partyTab = useChatTabsStore.getState().tabs.find((t) => t.type === 'party');
        expect(partyTab?.id).toBe('party_party-123');
    });

    it('removes the party tab when leaving (null partyId)', () => {
        useChatTabsStore.getState().syncPartyTab('party-123');
        useChatTabsStore.getState().syncPartyTab(null);
        expect(
            useChatTabsStore.getState().tabs.some((t) => t.type === 'party'),
        ).toBe(false);
    });

    it('falls back to city when active tab is the party being removed', () => {
        useChatTabsStore.getState().syncPartyTab('party-123');
        useChatTabsStore.getState().setActive('party_party-123');
        useChatTabsStore.getState().syncPartyTab(null);
        expect(useChatTabsStore.getState().activeId).toBe('city');
    });

    it('swaps to a fresh tab when the party id changes', () => {
        useChatTabsStore.getState().syncPartyTab('party-A');
        useChatTabsStore.getState().syncPartyTab('party-B');
        const tabs = useChatTabsStore.getState().tabs.filter((t) => t.type === 'party');
        expect(tabs.length).toBe(1);
        expect(tabs[0].id).toBe('party_party-B');
    });

    it('is a no-op when partyId stays the same', () => {
        useChatTabsStore.getState().syncPartyTab('party-X');
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().syncPartyTab('party-X');
        expect(useChatTabsStore.getState().tabs).toBe(before);
    });

    it('does nothing when removing a party tab that was never there', () => {
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().syncPartyTab(null);
        expect(useChatTabsStore.getState().tabs).toBe(before);
    });
});

// ── syncGuildTab ─────────────────────────────────────────────────────────────

describe('syncGuildTab', () => {
    it('adds a guild tab when joining a guild', () => {
        useChatTabsStore.getState().syncGuildTab('guild-42');
        const g = useChatTabsStore.getState().tabs.find((t) => t.type === 'guild');
        expect(g?.id).toBe('guild_guild-42');
    });

    it('removes the guild tab on leave (null)', () => {
        useChatTabsStore.getState().syncGuildTab('guild-42');
        useChatTabsStore.getState().syncGuildTab(null);
        expect(useChatTabsStore.getState().tabs.some((t) => t.type === 'guild')).toBe(false);
    });

    it('falls back to city when the active tab is the guild being removed', () => {
        useChatTabsStore.getState().syncGuildTab('guild-42');
        useChatTabsStore.getState().setActive('guild_guild-42');
        useChatTabsStore.getState().syncGuildTab(null);
        expect(useChatTabsStore.getState().activeId).toBe('city');
    });

    it('does nothing when removing a guild tab that was never there', () => {
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().syncGuildTab(null);
        expect(useChatTabsStore.getState().tabs).toBe(before);
    });
});

// ── closeTab ─────────────────────────────────────────────────────────────────

describe('closeTab', () => {
    it('closes a closable (PM) tab', () => {
        const ch = useChatTabsStore.getState().openPm('Me', 'Alice');
        useChatTabsStore.getState().closeTab(ch);
        expect(useChatTabsStore.getState().tabs.some((t) => t.id === ch)).toBe(false);
    });

    it('refuses to close non-closable (city/system) tabs', () => {
        useChatTabsStore.getState().closeTab('city');
        useChatTabsStore.getState().closeTab('system');
        const ids = useChatTabsStore.getState().tabs.map((t) => t.id);
        expect(ids).toContain('city');
        expect(ids).toContain('system');
    });

    it('is a no-op for unknown ids', () => {
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().closeTab('not-a-real-tab-id');
        expect(useChatTabsStore.getState().tabs).toBe(before);
    });

    it('falls back to the city tab when closing the currently active PM tab', () => {
        const ch = useChatTabsStore.getState().openPm('Me', 'Alice');
        useChatTabsStore.getState().setActive(ch);
        useChatTabsStore.getState().closeTab(ch);
        expect(useChatTabsStore.getState().activeId).toBe('city');
    });
});

// ── setActive ────────────────────────────────────────────────────────────────

describe('setActive', () => {
    it('switches the active tab', () => {
        useChatTabsStore.getState().setActive('system');
        expect(useChatTabsStore.getState().activeId).toBe('system');
    });

    it('clears unread on the newly-active tab', () => {
        useChatTabsStore.getState().incrementUnread('system');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === 'system')?.unread,
        ).toBe(1);
        useChatTabsStore.getState().setActive('system');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === 'system')?.unread,
        ).toBe(0);
    });

    it('is a no-op when target id does not exist', () => {
        const before = useChatTabsStore.getState();
        useChatTabsStore.getState().setActive('does-not-exist');
        expect(useChatTabsStore.getState().activeId).toBe(before.activeId);
    });
});

// ── incrementUnread ──────────────────────────────────────────────────────────

describe('incrementUnread', () => {
    it('increments unread for an inactive tab', () => {
        useChatTabsStore.setState({ activeId: 'city' });
        useChatTabsStore.getState().incrementUnread('system');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === 'system')?.unread,
        ).toBe(1);
    });

    it('does nothing when the target tab is currently active', () => {
        useChatTabsStore.setState({ activeId: 'city' });
        useChatTabsStore.getState().incrementUnread('city');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === 'city')?.unread,
        ).toBe(0);
    });

    it('accumulates across multiple calls', () => {
        useChatTabsStore.setState({ activeId: 'city' });
        useChatTabsStore.getState().incrementUnread('system');
        useChatTabsStore.getState().incrementUnread('system');
        useChatTabsStore.getState().incrementUnread('system');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === 'system')?.unread,
        ).toBe(3);
    });
});

// ── markRead ─────────────────────────────────────────────────────────────────

describe('markRead', () => {
    it('zeros the unread counter on the given tab', () => {
        useChatTabsStore.setState({ activeId: 'city' });
        useChatTabsStore.getState().incrementUnread('system');
        useChatTabsStore.getState().markRead('system');
        expect(
            useChatTabsStore.getState().tabs.find((t) => t.id === 'system')?.unread,
        ).toBe(0);
    });

    it('is a no-op for unknown tab ids', () => {
        const before = useChatTabsStore.getState().tabs;
        useChatTabsStore.getState().markRead('unknown');
        expect(useChatTabsStore.getState().tabs).toEqual(before);
    });
});

// ── raiseNotification / clearNotification ────────────────────────────────────

describe('raiseNotification', () => {
    it('flips hasNotification to true', () => {
        useChatTabsStore.getState().raiseNotification();
        expect(useChatTabsStore.getState().hasNotification).toBe(true);
    });

    it('is idempotent when already raised', () => {
        useChatTabsStore.setState({ hasNotification: true });
        useChatTabsStore.getState().raiseNotification();
        expect(useChatTabsStore.getState().hasNotification).toBe(true);
    });
});

describe('clearNotification', () => {
    it('flips hasNotification to false when set', () => {
        useChatTabsStore.setState({ hasNotification: true });
        useChatTabsStore.getState().clearNotification();
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });

    it('is a no-op when already cleared', () => {
        useChatTabsStore.getState().clearNotification();
        expect(useChatTabsStore.getState().hasNotification).toBe(false);
    });
});

// ── Tab ordering (sortTabs) ──────────────────────────────────────────────────

describe('tab ordering', () => {
    it('keeps canonical order: city → guild → party → system → pm', () => {
        useChatTabsStore.getState().syncGuildTab('g1');
        useChatTabsStore.getState().syncPartyTab('p1');
        useChatTabsStore.getState().openPm('Me', 'Alice');
        const types = useChatTabsStore.getState().tabs.map((t) => t.type);
        expect(types).toEqual(['city', 'guild', 'party', 'system', 'pm']);
    });
});
