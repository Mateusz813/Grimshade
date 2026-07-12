import { describe, it, expect, vi, beforeEach } from 'vitest';

const client = vi.hoisted(() => ({
    get: vi.fn((_url?: string) => Promise.resolve({ data: { ok: true } })),
    post: vi.fn((_url?: string, _body?: unknown) => Promise.resolve({ data: { ok: true } })),
    put: vi.fn((_url?: string, _body?: unknown) => Promise.resolve({ data: { ok: true } })),
    delete: vi.fn((_url?: string) => Promise.resolve({ data: { ok: true } })),
}));
vi.mock('./client', () => ({ default: client }));

import { backendApi } from './backendApi';

const CID = 'c1';

beforeEach(() => vi.clearAllMocks());

describe('backendApi — kontrakt URL (odczyty)', () => {
    it('GET-y trafiają w poprawne ścieżki', async () => {
        await backendApi.contentVersion();
        expect(client.get).toHaveBeenCalledWith('/api/v1/content/version');
        await backendApi.characters();
        expect(client.get).toHaveBeenCalledWith('/api/v1/characters');
        await backendApi.state(CID);
        expect(client.get).toHaveBeenCalledWith(`/api/v1/characters/${CID}/state`);
        await backendApi.shopCatalog();
        expect(client.get).toHaveBeenCalledWith('/api/v1/shop/catalog');
        await backendApi.marketListings();
        expect(client.get).toHaveBeenCalledWith('/api/v1/market/listings');
        await backendApi.deathsFeed();
        expect(client.get).toHaveBeenCalledWith('/api/v1/deaths');
        await backendApi.listPublicParties();
        expect(client.get).toHaveBeenCalledWith('/api/v1/parties');
    });

    it('guildsBrowse buduje query string (i bez paramów zwykły URL)', async () => {
        await backendApi.guildsBrowse({ offset: 10, limit: 5, search: 'abc' });
        const url = client.get.mock.calls.at(-1)?.[0] as string;
        expect(url).toContain('/api/v1/guilds?');
        expect(url).toContain('offset=10');
        expect(url).toContain('limit=5');
        expect(url).toContain('search=abc');
        await backendApi.guildsBrowse();
        expect(client.get).toHaveBeenCalledWith('/api/v1/guilds');
    });
});

describe('backendApi — mutacje (requestId + URL)', () => {
    it('POST dokłada requestId + body', async () => {
        await backendApi.combatResolve(CID, 'm1');
        expect(client.post).toHaveBeenCalledWith(
            `/api/v1/characters/${CID}/combat/resolve`,
            expect.objectContaining({ requestId: expect.any(String), monsterId: 'm1' }),
        );
    });

    it('PUT commitState przekazuje state + event, updatePrefs settings', async () => {
        await backendApi.commitState(CID, { s: 1 }, { type: 'hunt' });
        expect(client.put).toHaveBeenCalledWith(
            `/api/v1/characters/${CID}/state`,
            expect.objectContaining({ requestId: expect.any(String), state: { s: 1 }, event: { type: 'hunt' } }),
        );
        await backendApi.commitState(CID, { s: 2 });
        const body = client.put.mock.calls.at(-1)?.[1] as Record<string, unknown>;
        expect(body.event).toBeUndefined();
        await backendApi.updatePrefs(CID, { lang: 'pl' });
        expect(client.put).toHaveBeenCalledWith(`/api/v1/characters/${CID}/prefs`, { settings: { lang: 'pl' } });
    });

    it('DELETE dla cancel/delete', async () => {
        await backendApi.marketCancel(CID, 'l1');
        expect(client.delete).toHaveBeenCalledWith(`/api/v1/characters/${CID}/market/listings/l1`);
        await backendApi.deleteCharacter(CID);
        expect(client.delete).toHaveBeenCalledWith(`/api/v1/characters/${CID}`);
    });
});

describe('backendApi — wywołuje KAŻDĄ metodę (pokrycie cienkich wrapperów)', () => {
    it('wszystkie metody odpalają klienta bez wyjątku', async () => {
        await Promise.all([
            backendApi.bossResolve(CID, 'b1'),
            backendApi.dungeonResolve(CID, 'd1'),
            backendApi.raidResolve(CID, 'r1'),
            backendApi.transformResolve(CID, 't1'),
            backendApi.transformClaim(CID, 't1'),
            backendApi.offlineHuntSettle(CID),
            backendApi.sell(CID, 'u1'),
            backendApi.upgrade(CID, 'u1'),
            backendApi.equip(CID, 'u1', 'helmet'),
            backendApi.unequip(CID, 'helmet'),
            backendApi.deposit(CID, 'u1'),
            backendApi.withdraw(CID, 'u1'),
            backendApi.disassemble(CID, 'u1'),
            backendApi.disassembleMass(CID, ['u1', 'u2']),
            backendApi.reroll(CID, 'u1'),
            backendApi.convertStones(CID, 'stone'),
            backendApi.buyElixir(CID, 'e1', 2),
            backendApi.buyShopItem(CID, 'i1'),
            backendApi.convertPotions(CID, 'p1', 'p2', 3),
            backendApi.useConsumable(CID, 'p1'),
            backendApi.statReset(CID, 'c1'),
            backendApi.claimTask(CID, 't1'),
            backendApi.claimQuest(CID, 'q1'),
            backendApi.refreshDailyQuests(CID),
            backendApi.claimDailyQuest(CID, 'q1'),
            backendApi.upgradeSkill(CID, 's1'),
            backendApi.startTraining(CID, 's1'),
            backendApi.collectTraining(CID),
            backendApi.unlockSkill(CID, 's1'),
            backendApi.setSkillSlot(CID, 0, 's1'),
            backendApi.arenaMatch(CID, 'o1'),
            backendApi.arenaShop(CID),
            backendApi.buyArenaItem(CID, 'i1'),
            backendApi.arenaSeason(CID),
            backendApi.claimArenaSeason(CID),
            backendApi.marketMine(CID),
            backendApi.marketList(CID, { price: 1 }),
            backendApi.marketBuy(CID, 'l1'),
            backendApi.editListing(CID, 'l1', { price: 5 }),
            backendApi.marketNotifications(CID),
            backendApi.dismissNotification(CID, 'n1'),
            backendApi.logDeath(CID, { source: 'monster' }),
            backendApi.createGuild(CID, { name: 'g' }),
            backendApi.showGuild(CID, 'g1'),
            backendApi.joinGuild(CID, 'g1'),
            backendApi.acceptRequest(CID, 'g1', 't1'),
            backendApi.rejectRequest(CID, 'g1', 't1'),
            backendApi.kickGuildMember(CID, 'g1', 't1'),
            backendApi.leaveGuild(CID, 'g1'),
            backendApi.disbandGuild(CID, 'g1'),
            backendApi.guildBossDamage(CID, 'g1'),
            backendApi.guildBossState(CID, 'g1'),
            backendApi.guildBossClaim(CID, 'g1'),
            backendApi.guildTreasury(CID, 'g1'),
            backendApi.guildTreasuryDeposit(CID, 'g1', 'u1'),
            backendApi.guildTreasuryWithdraw(CID, 'g1', 'ti1'),
            backendApi.createParty(CID, { name: 'p' }),
            backendApi.showParty(CID, 'p1'),
            backendApi.joinParty(CID, 'p1', 'pw'),
            backendApi.leaveParty(CID, 'p1'),
            backendApi.handoverParty(CID, 'p1', 'nl'),
            backendApi.kickParty(CID, 'p1', 'm1'),
            backendApi.updateParty(CID, 'p1', { name: 'x' }),
            backendApi.myActiveParty(CID),
            backendApi.chatSend(CID, { channel: 'city', content: 'hi' }),
            backendApi.chatSystemEvent(CID, { type: 'x' }),
            backendApi.createCharacter({ name: 'n', class: 'Knight' }),
            backendApi.dpsRecord(CID, { dps: 1 }),
        ]);
        const total = client.get.mock.calls.length + client.post.mock.calls.length
            + client.put.mock.calls.length + client.delete.mock.calls.length;
        expect(total).toBeGreaterThan(60);
    });
});
