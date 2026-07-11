import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Guild view — single-entry-point view with internal screens
 * (list / home / boss / treasury / requests) routed by local state.
 * Hits guildApi for list rendering + member ops. The view is large
 * (~2500 lines) but most of it is sub-screens that only render when
 * the player is already in a guild.
 *
 * Coverage targets the unaffiliated-player branch (screen === 'list',
 * guild === null) because that's what every new character lands on:
 *   - Smoke render: .guild root + top bar.
 *   - "Zaloguj się" empty state when character is null.
 *   - List of guilds renders from a fixture rows[] (after the
 *     guildApi mock resolves).
 *   - Empty-list message renders when listGuilds returns [].
 *   - "Stwórz gildię" button visible at the bottom of the list.
 *   - Pagination buttons only render when total > PAGE_SIZE.
 *   - Apply modal opens when :handshake: is clicked + closes on Anuluj.
 *
 * Heavy dependencies (Modal, GuildHome, GuildBoss arena, etc.) are
 * exercised by Playwright e2e tests with a real Supabase backend.
 *
 * Mocks: guildApi (deterministic resolved values), framer-motion, the
 * inner Chat component used by GuildHome — although we never reach
 * the home screen here.
 */

vi.mock('../../api/v1/guildApi', () => ({
    guildApi: {
        listGuilds: vi.fn(async () => []),
        countGuilds: vi.fn(async () => 0),
        listGuildSummaries: vi.fn(async () => ({})),
        findGuildForCharacter: vi.fn(async () => null),
        findGuildById: vi.fn(async () => null),
        listMembers: vi.fn(async () => []),
        listRequests: vi.fn(async () => []),
        requestJoin: vi.fn(async () => undefined),
        createGuild: vi.fn(async () => ({})),
        purgeRequestsForCharacter: vi.fn(async () => undefined),
        updateMemberStats: vi.fn(async () => undefined),
        updateGuildLevelXp: vi.fn(async () => undefined),
        listContributions: vi.fn(async () => []),
        kickMember: vi.fn(async () => undefined),
        leaveGuild: vi.fn(async () => ({ disbanded: false })),
        disbandGuild: vi.fn(async () => undefined),
        acceptRequest: vi.fn(async () => undefined),
        deleteRequest: vi.fn(async () => undefined),
        listTreasury: vi.fn(async () => []),
        listTreasuryLogs: vi.fn(async () => []),
        depositItem: vi.fn(async () => undefined),
        withdrawItem: vi.fn(async () => undefined),
        fetchOrCreateWeeklyBoss: vi.fn(async () => ({})),
        releaseBossArena: vi.fn(async () => undefined),
        claimBossArena: vi.fn(async () => null),
        fetchContribution: vi.fn(async () => null),
        listAttemptsToday: vi.fn(async () => []),
        listWeeklyAttempts: vi.fn(async () => []),
        applyBossDamage: vi.fn(async () => undefined),
        logAttempt: vi.fn(async () => undefined),
        addContribution: vi.fn(async () => undefined),
        markContributionClaimed: vi.fn(async () => undefined),
    },
}));

// Backend-authoritative branch mocks. Default OFF so the existing client-path
// tests exercise the untouched guildApi paths; the dedicated describe flips
// `backendFlag.on`.
const backendFlag = vi.hoisted(() => ({ on: false }));
const sundayFlag = vi.hoisted(() => ({ on: false }));
const backendApiMock = vi.hoisted(() => ({
    guildsBrowse: vi.fn(),
    showGuild: vi.fn(),
    createGuild: vi.fn(),
    joinGuild: vi.fn(),
    acceptRequest: vi.fn(),
    rejectRequest: vi.fn(),
    kickGuildMember: vi.fn(),
    leaveGuild: vi.fn(),
    disbandGuild: vi.fn(),
    guildBossState: vi.fn(),
    guildBossDamage: vi.fn(),
    guildBossClaim: vi.fn(),
    guildTreasury: vi.fn(),
    guildTreasuryDeposit: vi.fn(),
    guildTreasuryWithdraw: vi.fn(),
}));
const syncFromBackendMock = vi.hoisted(() => vi.fn());

vi.mock('../../config/backendMode', () => ({
    isBackendMode: () => backendFlag.on,
    isBackendConfigured: () => backendFlag.on,
    getBackendBaseUrl: () => (backendFlag.on ? 'http://localhost:8088' : ''),
    setBackendMode: (v: boolean) => { backendFlag.on = v; },
}));
vi.mock('../../api/backend/backendApi', () => ({ backendApi: backendApiMock }));
vi.mock('../../api/backend/syncState', () => ({
    syncFromBackend: syncFromBackendMock,
    syncIfBackend: vi.fn().mockResolvedValue(undefined),
}));

// Control isGuildBossClaimDay (Sunday gate) deterministically so the boss
// tests don't depend on the real calendar day.
vi.mock('../../systems/guildSystem', async () => {
    const actual = await vi.importActual<typeof import('../../systems/guildSystem')>('../../systems/guildSystem');
    return {
        ...actual,
        isGuildBossClaimDay: () => sundayFlag.on,
    };
});

vi.mock('framer-motion', async () => {
    const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
    return {
        ...actual,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: new Proxy({}, {
            get: () => (props: Record<string, unknown>) => {
                const { children, ...rest } = props as { children?: React.ReactNode };
                return <div {...(rest as Record<string, unknown>)}>{children}</div>;
            },
        }),
    };
});

vi.mock('../../components/ui/Chat/Chat', () => ({
    default: ({ channel }: { channel: string }) => <div data-testid={`chat-${channel}`} />,
}));

import Guild from './Guild';
import { useCharacterStore } from '../../stores/characterStore';
import { useGuildStore } from '../../stores/guildStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useTransformStore } from '../../stores/transformStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import { guildApi } from '../../api/v1/guildApi';
import type { ICharacter } from '../../api/v1/characterApi';
import type { IGuildRow } from '../../api/v1/guildApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 30,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 30,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const makeGuild = (overrides: Partial<IGuildRow> = {}): IGuildRow => ({
    id: 'g1',
    name: 'Iron Wolves',
    tag: 'IW',
    leader_id: 'leader-1',
    level: 5,
    xp: 0,
    xp_to_next: 1000,
    member_cap: 20,
    color: '#e53935',
    logo: 'wolf',
    description: '',
    created_at: '2026-05-22T00:00:00.000Z',
    motto: '',
    ...(overrides as object),
} as unknown as IGuildRow);

const makeMember = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    guild_id: 'g1',
    character_id: 'char-1',
    character_name: 'Hero',
    character_class: 'Knight',
    character_level: 30,
    character_transform_tier: 0,
    joined_at: '2026-05-22T00:00:00.000Z',
    ...overrides,
});

const makeRequest = (overrides: Record<string, unknown> = {}) => ({
    id: 'req-1',
    guild_id: 'g1',
    character_id: 'char-2',
    character_name: 'Newbie',
    character_class: 'Mage',
    character_level: 10,
    requested_at: '2026-05-22T00:00:00.000Z',
    ...overrides,
});

const makeBoss = (overrides: Record<string, unknown> = {}) => ({
    id: 'boss-1',
    guild_id: 'g1',
    week_start: '2026-07-06',
    boss_tier: 1,
    boss_max_hp: 2_000_000,
    boss_current_hp: 2_000_000,
    boss_killed: false,
    current_attacker_id: null,
    created_at: '2026-07-06T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
    ...overrides,
});

const makeTreasuryRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'trow-1',
    guild_id: 'g1',
    item_data: JSON.stringify({
        uuid: 'vault-item-1',
        itemId: 'sword_iron',
        rarity: 'common',
        bonuses: {},
        upgradeLevel: 0,
        itemLevel: 5,
    }),
    deposited_by: 'char-9',
    deposited_by_name: 'Depositor',
    deposited_at: '2026-07-06T00:00:00.000Z',
    ...overrides,
});

const makeBagItem = (uuid: string, overrides: Record<string, unknown> = {}) => ({
    uuid,
    itemId: 'sword_iron',
    rarity: 'common',
    bonuses: {},
    upgradeLevel: 0,
    itemLevel: 5,
    ...overrides,
});

const renderGuild = () =>
    render(
        <MemoryRouter>
            <Guild />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.mocked(guildApi.listGuilds).mockReset();
    vi.mocked(guildApi.countGuilds).mockReset();
    vi.mocked(guildApi.listGuildSummaries).mockReset();
    vi.mocked(guildApi.findGuildForCharacter).mockReset();
    vi.mocked(guildApi.listGuilds).mockResolvedValue([]);
    vi.mocked(guildApi.countGuilds).mockResolvedValue(0);
    vi.mocked(guildApi.listGuildSummaries).mockResolvedValue({});
    vi.mocked(guildApi.findGuildForCharacter).mockResolvedValue(null);

    useCharacterStore.setState({ character: makeChar() });
    useGuildStore.setState({
        guild: null,
        members: [],
        requests: [],
        loading: false,
        guildIdByCharacter: {},
        channel: null,
        hydrateForCharacter: async () => { /* noop */ },
    } as never);
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 100_000,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useTransformStore.setState({ completedTransforms: [] });

    backendFlag.on = false;
    sundayFlag.on = false;
    Object.values(backendApiMock).forEach((fn) => fn.mockReset().mockResolvedValue(undefined));
    syncFromBackendMock.mockReset().mockResolvedValue(undefined);
    // Sensible defaults for the read endpoints so sub-screens hydrate
    // without throwing; individual tests override where they assert.
    backendApiMock.guildsBrowse.mockResolvedValue({ guilds: [], summaries: {}, total: 0 });
    backendApiMock.showGuild.mockResolvedValue({ guild: makeGuild(), members: [], requests: [] });
    backendApiMock.guildBossState.mockResolvedValue({
        boss: makeBoss(), contribution: null, contributions: [], attemptsToday: [], weeklyAttempts: [],
    });
    backendApiMock.guildTreasury.mockResolvedValue({ items: [], logs: [] });
    backendApiMock.createGuild.mockResolvedValue({ guild: makeGuild(), gold: 0 });
    backendApiMock.guildBossDamage.mockResolvedValue({
        ok: true, damageDealt: 1000, killed: false, leveledUp: false,
        boss: makeBoss({ boss_current_hp: 1_999_000 }), guild: makeGuild(), contributionTotal: 1000,
    });
    backendApiMock.guildBossClaim.mockResolvedValue({
        ok: true, rewards: [{ kind: 'gold', label: '1cc golda', icon: 'money-bag' }], gold: 100, xp: 0, level: 30,
    });
});

afterEach(() => {
    cleanup();
});

describe('Guild — smoke', () => {
    it('renders the root .guild container', () => {
        const { container } = renderGuild();
        expect(container.querySelector('.guild')).not.toBeNull();
    });

    it('renders the "Zaloguj się" empty state when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderGuild();
        expect(container.querySelector('.guild__empty')?.textContent).toContain('Zaloguj się');
    });

    it('renders the top-bar title when a character is loaded', () => {
        const { container } = renderGuild();
        expect(container.querySelector('.guild__top-title')?.textContent).toContain('Gildie');
    });
});

describe('Guild — list screen (no membership)', () => {
    it('renders the list search input on the unaffiliated screen', () => {
        const { container } = renderGuild();
        expect(container.querySelector('.guild__list-search input')).not.toBeNull();
    });

    it('shows the "Ładowanie…" empty message while the fetch is pending', () => {
        // Initial render fires the fetchPage useEffect; before the
        // promise resolves the loading flag is true.
        const { container } = renderGuild();
        expect(container.querySelector('.guild__list-empty')).not.toBeNull();
    });

    it('renders the "Stwórz gildię" button at the bottom of the list', () => {
        const { container } = renderGuild();
        const createBtn = container.querySelector('.guild__list-create') as HTMLButtonElement;
        expect(createBtn?.textContent).toContain('Stwórz gildię');
    });

    it('renders the empty-list copy when listGuilds returns []', async () => {
        const { container, findByText } = renderGuild();
        // Wait for the resolved listGuilds promise.
        await findByText(/Brak gildii/);
        expect(container.querySelector('.guild__list-empty')?.textContent).toContain('Brak gildii');
    });
});

describe('Guild — list rows', () => {
    it('renders one .guild__list-row per guild returned by the API', async () => {
        const rows = [
            makeGuild({ id: 'g1', name: 'Iron Wolves', tag: 'IW' }),
            makeGuild({ id: 'g2', name: 'Steel Hawks', tag: 'SH' }),
        ];
        vi.mocked(guildApi.listGuilds).mockResolvedValue(rows);
        vi.mocked(guildApi.countGuilds).mockResolvedValue(2);
        vi.mocked(guildApi.listGuildSummaries).mockResolvedValue({
            g1: { memberCount: 5, leaderName: 'Bob' },
            g2: { memberCount: 8, leaderName: 'Alice' },
        });
        const { container, findAllByRole } = renderGuild();
        await findAllByRole('listitem');
        const listRows = container.querySelectorAll('.guild__list-row');
        expect(listRows.length).toBe(2);
        expect(container.textContent).toContain('Iron Wolves');
        expect(container.textContent).toContain('Steel Hawks');
    });

    it('renders the leader name from listGuildSummaries', async () => {
        vi.mocked(guildApi.listGuilds).mockResolvedValue([
            makeGuild({ id: 'g1', name: 'Iron Wolves', tag: 'IW' }),
        ]);
        vi.mocked(guildApi.countGuilds).mockResolvedValue(1);
        vi.mocked(guildApi.listGuildSummaries).mockResolvedValue({
            g1: { memberCount: 5, leaderName: 'Krasek' },
        });
        const { findByText } = renderGuild();
        await findByText(/Krasek/);
    });

    it('opens the apply modal when :handshake: is clicked on a row', async () => {
        vi.mocked(guildApi.listGuilds).mockResolvedValue([
            makeGuild({ id: 'g1', name: 'Iron Wolves', tag: 'IW' }),
        ]);
        vi.mocked(guildApi.countGuilds).mockResolvedValue(1);
        vi.mocked(guildApi.listGuildSummaries).mockResolvedValue({
            g1: { memberCount: 1, leaderName: 'Bob' },
        });
        const { container, findByText } = renderGuild();
        await findByText('Iron Wolves');
        const applyBtn = container.querySelector('.guild__list-apply') as HTMLButtonElement;
        fireEvent.click(applyBtn);
        // Apply modal renders a paragraph containing the guild name.
        // The modal mounts at body, so use screen rather than container.
        expect(screen.getByText(/Czy chcesz aplikować/i)).toBeTruthy();
    });
});

describe('Guild — search filter', () => {
    it('forwards search query into listGuilds', async () => {
        const { container } = renderGuild();
        const input = container.querySelector('.guild__list-search input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'iron' } });
        // The first useEffect-driven call ran with search='', then the
        // re-render fires another with search='iron'. We only assert
        // that listGuilds was called with the new search at least once.
        await Promise.resolve();
        const calls = vi.mocked(guildApi.listGuilds).mock.calls;
        const sawSearch = calls.some(([params]) => (params as { search: string }).search === 'iron');
        expect(sawSearch).toBe(true);
    });
});

// =============================================================================
// BACKEND-AUTHORITATIVE BRANCH — every mutating guild action routes through
// backendApi when isBackendMode() is ON, and the direct guildApi Supabase
// write is SKIPPED. Flag OFF = the client path is untouched.
// =============================================================================

const seatInGuild = (over: Record<string, unknown> = {}, members = [makeMember()]) => {
    useGuildStore.setState({
        guild: makeGuild({ id: 'g1', leader_id: 'char-1', member_cap: 20, ...over }),
        members: members as never,
        requests: [],
        loading: false,
        guildIdByCharacter: { 'char-1': 'g1' },
        channel: null,
        hydrateForCharacter: async () => { /* noop — store state is set directly */ },
    } as never);
};

const openSubScreen = async (label: RegExp) => {
    const btn = await screen.findByRole('button', { name: label });
    fireEvent.click(btn);
};

describe('Guild — backend-authoritative branch', () => {
    it('create routes through backendApi.createGuild + syncFromBackend and SKIPS guildApi.createGuild + spendGold', async () => {
        backendFlag.on = true;
        useInventoryStore.setState({ gold: 5_000_000 });
        const spendGold = vi.fn().mockReturnValue(true);
        useInventoryStore.setState({ spendGold });
        renderGuild();
        fireEvent.click(await screen.findByRole('button', { name: /Stwórz gildię/ }));
        fireEvent.change(screen.getByLabelText('Nazwa gildii'), { target: { value: 'Smocze Pazury' } });
        fireEvent.change(screen.getByLabelText(/Tag/), { target: { value: 'SMK' } });
        const dialogCreate = screen.getAllByRole('button', { name: /Stwórz gildię/ }).at(-1)!;
        fireEvent.click(dialogCreate);
        await waitFor(() => expect(backendApiMock.createGuild).toHaveBeenCalledWith('char-1', {
            name: 'Smocze Pazury', tag: 'SMK', logo: expect.any(String), color: expect.any(String),
        }));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(vi.mocked(guildApi.createGuild)).not.toHaveBeenCalled();
        expect(spendGold).not.toHaveBeenCalled();
    });

    it('apply/join routes through backendApi.joinGuild and SKIPS guildApi.requestJoin', async () => {
        backendFlag.on = true;
        backendApiMock.guildsBrowse.mockResolvedValue({
            guilds: [makeGuild({ id: 'g9', name: 'Iron Wolves', tag: 'IW' })],
            summaries: { g9: { memberCount: 1, leaderName: 'Bob' } },
            total: 1,
        });
        renderGuild();
        await screen.findByText('Iron Wolves');
        fireEvent.click(document.querySelector('.guild__list-apply') as HTMLButtonElement);
        fireEvent.click(await screen.findByRole('button', { name: /^Aplikuj$/ }));
        await waitFor(() => expect(backendApiMock.joinGuild).toHaveBeenCalledWith('char-1', 'g9'));
        expect(vi.mocked(guildApi.requestJoin)).not.toHaveBeenCalled();
    });

    it('accept routes through backendApi.acceptRequest and SKIPS guildApi.acceptRequest', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        useGuildStore.setState({ requests: [makeRequest()] as never });
        renderGuild();
        await openSubScreen(/Prośby/);
        fireEvent.click(await screen.findByRole('button', { name: /Przyjmij/ }));
        await waitFor(() => expect(backendApiMock.acceptRequest).toHaveBeenCalledWith('char-1', 'g1', 'char-2'));
        expect(vi.mocked(guildApi.acceptRequest)).not.toHaveBeenCalled();
    });

    it('reject routes through backendApi.rejectRequest and SKIPS guildApi.deleteRequest', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        useGuildStore.setState({ requests: [makeRequest()] as never });
        renderGuild();
        await openSubScreen(/Prośby/);
        fireEvent.click(await screen.findByRole('button', { name: /Odrzuć/ }));
        await waitFor(() => expect(backendApiMock.rejectRequest).toHaveBeenCalledWith('char-1', 'g1', 'char-2'));
        expect(vi.mocked(guildApi.deleteRequest)).not.toHaveBeenCalled();
    });

    it('kick routes through backendApi.kickGuildMember and SKIPS guildApi.kickMember', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember(), makeMember({ id: 'm2', character_id: 'char-2', character_name: 'Grunt' })]);
        renderGuild();
        await screen.findByText('Grunt');
        fireEvent.click(document.querySelector('.guild__member-kick') as HTMLButtonElement);
        fireEvent.click(await screen.findByRole('button', { name: /^Wyrzuć$/ }));
        await waitFor(() => expect(backendApiMock.kickGuildMember).toHaveBeenCalledWith('char-1', 'g1', 'char-2'));
        expect(vi.mocked(guildApi.kickMember)).not.toHaveBeenCalled();
    });

    it('leave routes through backendApi.leaveGuild and SKIPS guildApi.leaveGuild', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        renderGuild();
        fireEvent.click(await screen.findByRole('button', { name: /Opuść gildię/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Opuść$/ }));
        await waitFor(() => expect(backendApiMock.leaveGuild).toHaveBeenCalledWith('char-1', 'g1'));
        expect(vi.mocked(guildApi.leaveGuild)).not.toHaveBeenCalled();
    });

    it('disband routes through backendApi.disbandGuild and SKIPS guildApi.disbandGuild', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        renderGuild();
        fireEvent.click(await screen.findByRole('button', { name: /Rozwiąż gildię/ }));
        // Both the roster row (title) and the modal (text) read "Rozwiąż
        // gildię"; the modal is rendered last, so click the trailing match.
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^Rozwiąż gildię$/ }).length).toBeGreaterThan(1));
        fireEvent.click(screen.getAllByRole('button', { name: /^Rozwiąż gildię$/ }).at(-1)!);
        await waitFor(() => expect(backendApiMock.disbandGuild).toHaveBeenCalledWith('char-1', 'g1'));
        expect(vi.mocked(guildApi.disbandGuild)).not.toHaveBeenCalled();
    });

    it('treasury deposit routes through backendApi.guildTreasuryDeposit + sync and SKIPS guildApi.depositItem + removeItem', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        const removeItem = vi.fn();
        useInventoryStore.setState({ bag: [makeBagItem('bag-1')] as never, removeItem } as never);
        renderGuild();
        await openSubScreen(/Skarbiec/);
        fireEvent.click(await screen.findByRole('button', { name: /Włóż/ }));
        await waitFor(() => expect(backendApiMock.guildTreasuryDeposit).toHaveBeenCalledWith('char-1', 'g1', 'bag-1'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(vi.mocked(guildApi.depositItem)).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
    });

    it('treasury withdraw routes through backendApi.guildTreasuryWithdraw + sync and SKIPS guildApi.withdrawItem + restoreItem', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        backendApiMock.guildTreasury.mockResolvedValue({ items: [makeTreasuryRow()], logs: [] });
        const restoreItem = vi.fn().mockReturnValue(true);
        useInventoryStore.setState({ restoreItem } as never);
        renderGuild();
        await openSubScreen(/Skarbiec/);
        fireEvent.click(await screen.findByRole('button', { name: /Wyciągnij/ }));
        await waitFor(() => expect(backendApiMock.guildTreasuryWithdraw).toHaveBeenCalledWith('char-1', 'g1', 'trow-1'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(vi.mocked(guildApi.withdrawItem)).not.toHaveBeenCalled();
        expect(restoreItem).not.toHaveBeenCalled();
    });

    it('boss attack issues ONE backendApi.guildBossDamage and NEVER streams guildApi.applyBossDamage', async () => {
        backendFlag.on = true;
        seatInGuild({}, [makeMember()]);
        renderGuild();
        await openSubScreen(/Loch/);
        fireEvent.click(await screen.findByRole('button', { name: /Atakuj bossa/ }));
        await waitFor(() => expect(backendApiMock.guildBossDamage).toHaveBeenCalledWith('char-1', 'g1'));
        expect(backendApiMock.guildBossDamage).toHaveBeenCalledTimes(1);
        expect(vi.mocked(guildApi.applyBossDamage)).not.toHaveBeenCalled();
        expect(vi.mocked(guildApi.claimBossArena)).not.toHaveBeenCalled();
        expect(vi.mocked(guildApi.logAttempt)).not.toHaveBeenCalled();
    });

    it('boss claim routes through backendApi.guildBossClaim + sync and SKIPS guildApi.markContributionClaimed', async () => {
        backendFlag.on = true;
        sundayFlag.on = true;
        seatInGuild({}, [makeMember()]);
        backendApiMock.guildBossState.mockResolvedValue({
            boss: makeBoss({ boss_killed: true, boss_current_hp: 0 }),
            contribution: {
                id: 'contrib-1', guild_id: 'g1', character_id: 'char-1', week_start: '2026-07-06',
                total_damage: 5000, rewards_claimed: false, rewards_json: null, updated_at: '2026-07-06T00:00:00.000Z',
            },
            contributions: [], attemptsToday: [], weeklyAttempts: [],
        });
        renderGuild();
        await openSubScreen(/Loch/);
        fireEvent.click(await screen.findByRole('button', { name: /Odbierz nagrody/ }));
        await waitFor(() => expect(backendApiMock.guildBossClaim).toHaveBeenCalledWith('char-1', 'g1'));
        expect(syncFromBackendMock).toHaveBeenCalledWith('char-1');
        expect(vi.mocked(guildApi.markContributionClaimed)).not.toHaveBeenCalled();
    });

    it('with the flag OFF the old client path runs (guildApi.kickMember called, backend untouched)', async () => {
        backendFlag.on = false;
        seatInGuild({}, [makeMember(), makeMember({ id: 'm2', character_id: 'char-2', character_name: 'Grunt' })]);
        renderGuild();
        await screen.findByText('Grunt');
        fireEvent.click(document.querySelector('.guild__member-kick') as HTMLButtonElement);
        fireEvent.click(await screen.findByRole('button', { name: /^Wyrzuć$/ }));
        await waitFor(() => expect(vi.mocked(guildApi.kickMember)).toHaveBeenCalled());
        expect(backendApiMock.kickGuildMember).not.toHaveBeenCalled();
    });
});

// TODO: Apply confirm submit (handleApplyConfirm) routes through
//       guildApi.requestJoin + setApplyMsg toast. Easy follow-up, but
//       the toast text comes from a server-roundtrip path that's better
//       tested in the guildApi unit + Playwright e2e.
// TODO: "Stwórz gildię" CTA opens GuildCreateDialog which mounts inline
//       guildIcons + color picker; not covered here. Live coverage in
//       the guildIcons.test.ts + the create-flow Playwright spec.
// TODO: All five `screen` sub-views (list / home / boss / treasury /
//       requests) — only `list` is exercised here. The other four only
//       mount when `guildState.guild` is set + the player is a member,
//       which collapses into hydrated server state — out of vitest's
//       reasonable scope.
