import client from './client';

// Typowany klient autorytatywnego backendu. Każda metoda mutująca wysyła
// `requestId` (idempotencja). Odpowiedzi to autorytatywny stan/wynik z serwera
// — store'y mają go APLIKOWAĆ, nie liczyć samodzielnie.

const rid = (): string =>
    (globalThis.crypto?.randomUUID?.() ?? `r_${Date.now()}_${Math.random().toString(36).slice(2)}`);

const post = async <T = unknown>(url: string, body: Record<string, unknown> = {}): Promise<T> => {
    const res = await client.post<T>(url, { requestId: rid(), ...body });
    return res.data;
};
const get = async <T = unknown>(url: string): Promise<T> => (await client.get<T>(url)).data;
const del = async <T = unknown>(url: string): Promise<T> => (await client.delete<T>(url)).data;

const c = (id: string) => `/api/v1/characters/${id}`;

export interface IGuildsBrowseParams {
    offset?: number;
    limit?: number;
    search?: string;
}

export interface IPartyPatch {
    name?: string;
    description?: string;
    password?: string;
    isPublic?: boolean;
    minJoinLevel?: number;
}

export const backendApi = {
    // -- Meta / odczyt --
    contentVersion: () => get<{ version: string }>('/api/v1/content/version'),
    characters: () => get('/api/v1/characters'),
    state: (charId: string) => get(`${c(charId)}/state`),
    updatePrefs: (charId: string, settings: Record<string, unknown>) =>
        client.put(`${c(charId)}/prefs`, { settings }).then((r) => r.data),
    // Autorytatywny zapis pełnego stanu (blob) — klient liczy grę swoim silnikiem,
    // serwer waliduje (diff prev↔new: duplikaty itemów, wejścia, śmierć) i zapisuje
    // (jedyny zapisujący). `event` = kontekst zdarzenia (koniec dungeona/polowania
    // itp.) dla walidacji. Zwraca autorytatywny stan (jak GET /state), ale klient go
    // NIE aplikuje (jest źródłem).
    commitState: (charId: string, state: Record<string, unknown>, event?: Record<string, unknown>) =>
        client.put(`${c(charId)}/state`, { requestId: rid(), state, ...(event ? { event } : {}) }).then((r) => r.data),

    // -- Walka / świat --
    combatResolve: (charId: string, monsterId: string) => post(`${c(charId)}/combat/resolve`, { monsterId }),
    bossResolve: (charId: string, bossId: string) => post(`${c(charId)}/boss/${bossId}/resolve`),
    dungeonResolve: (charId: string, dungeonId: string) => post(`${c(charId)}/dungeon/${dungeonId}/resolve`),
    raidResolve: (charId: string, raidId: string) => post(`${c(charId)}/raid/${raidId}/resolve`),
    transformResolve: (charId: string, transformId: string) => post(`${c(charId)}/transform/${transformId}/resolve`),
    transformClaim: (charId: string, transformId: string) => post(`${c(charId)}/transform/claim`, { transformId }),
    offlineHuntSettle: (charId: string) => post(`${c(charId)}/offline-hunt/settle`),

    // -- Ekwipunek / itemy --
    sell: (charId: string, itemUuid: string) => post(`${c(charId)}/items/sell`, { itemUuid }),
    upgrade: (charId: string, itemUuid: string) => post(`${c(charId)}/items/upgrade`, { itemUuid }),
    equip: (charId: string, itemUuid: string, slot: string) => post(`${c(charId)}/inventory/equip`, { itemUuid, slot }),
    unequip: (charId: string, slot: string) => post(`${c(charId)}/inventory/unequip`, { slot }),
    deposit: (charId: string, itemUuid: string) => post(`${c(charId)}/inventory/deposit`, { itemUuid }),
    withdraw: (charId: string, itemUuid: string) => post(`${c(charId)}/inventory/withdraw`, { itemUuid }),
    disassemble: (charId: string, itemUuid: string) => post(`${c(charId)}/items/disassemble`, { itemUuid }),
    disassembleMass: (charId: string, itemUuids: string[]) => post(`${c(charId)}/items/disassemble-mass`, { itemUuids }),
    reroll: (charId: string, itemUuid: string) => post(`${c(charId)}/items/reroll`, { itemUuid }),
    convertStones: (charId: string, stoneType: string) => post(`${c(charId)}/stones/convert`, { stoneType }),

    // -- Sklep --
    shopCatalog: () => get('/api/v1/shop/catalog'),
    buyElixir: (charId: string, itemId: string, quantity: number) => post(`${c(charId)}/shop/buy-elixir`, { itemId, quantity }),
    buyShopItem: (charId: string, itemId: string) => post(`${c(charId)}/shop/buy-item`, { itemId }),

    // -- Potiony / konsumowalne --
    convertPotions: (charId: string, inputId: string, outputId: string, batches: number) =>
        post(`${c(charId)}/potions/convert`, { inputId, outputId, batches }),
    useConsumable: (charId: string, consumableId: string) => post(`${c(charId)}/consumables/use`, { consumableId }),
    statReset: (charId: string, consumableId?: string) => post(`${c(charId)}/character/stat-reset`, { consumableId }),

    // -- Progresja --
    claimTask: (charId: string, taskId: string) => post(`${c(charId)}/tasks/${taskId}/claim`),
    claimQuest: (charId: string, questId: string) => post(`${c(charId)}/quests/${questId}/claim`),
    refreshDailyQuests: (charId: string) => post(`${c(charId)}/daily-quests/refresh`),
    claimDailyQuest: (charId: string, questId: string) => post(`${c(charId)}/daily-quests/${questId}/claim`),
    upgradeSkill: (charId: string, skillId: string) => post(`${c(charId)}/skills/${skillId}/upgrade`),
    startTraining: (charId: string, skillId: string) => post(`${c(charId)}/skills/train/start`, { skillId }),
    collectTraining: (charId: string) => post(`${c(charId)}/skills/train/collect`),
    unlockSkill: (charId: string, skillId: string) => post(`${c(charId)}/skills/${skillId}/unlock`),
    setSkillSlot: (charId: string, slot: number, skillId: string | null) => post(`${c(charId)}/skills/slot`, { slot, skillId }),

    // -- Arena / market / feed --
    arenaMatch: (charId: string, opponentId: string) => post(`${c(charId)}/arena/match`, { opponentId }),
    arenaShop: (charId: string) => get(`${c(charId)}/arena/shop`),
    buyArenaItem: (charId: string, itemId: string) => post(`${c(charId)}/arena/shop/buy`, { itemId }),
    arenaSeason: (charId: string) => get(`${c(charId)}/arena/season`),
    claimArenaSeason: (charId: string) => post(`${c(charId)}/arena/season/claim`),
    marketListings: () => get('/api/v1/market/listings'),
    marketMine: (charId: string) => get(`${c(charId)}/market/mine`),
    marketList: (charId: string, body: Record<string, unknown>) => post(`${c(charId)}/market/listings`, body),
    marketBuy: (charId: string, listingId: string) => post(`${c(charId)}/market/listings/${listingId}/buy`),
    marketCancel: (charId: string, listingId: string) => del(`${c(charId)}/market/listings/${listingId}`),
    editListing: (charId: string, listingId: string, patch: { price?: number; quantity?: number }) =>
        client.put(`${c(charId)}/market/listings/${listingId}`, { requestId: rid(), ...patch }).then((r) => r.data),
    marketNotifications: (charId: string) => get(`${c(charId)}/market/notifications`),
    dismissNotification: (charId: string, notificationId: string) =>
        post(`${c(charId)}/market/notifications/${notificationId}/dismiss`),
    deathsFeed: () => get('/api/v1/deaths'),
    logDeath: (charId: string, body: Record<string, unknown>) => post(`${c(charId)}/deaths`, body),

    // -- Gildie --
    createGuild: (charId: string, body: Record<string, unknown>) => post(`${c(charId)}/guilds`, body),
    showGuild: (charId: string, guildId: string) => get(`${c(charId)}/guilds/${guildId}`),
    joinGuild: (charId: string, guildId: string) => post(`${c(charId)}/guilds/${guildId}/join`),
    acceptRequest: (charId: string, guildId: string, targetId: string) =>
        post(`${c(charId)}/guilds/${guildId}/accept/${targetId}`),
    rejectRequest: (charId: string, guildId: string, targetId: string) =>
        post(`${c(charId)}/guilds/${guildId}/reject/${targetId}`),
    kickGuildMember: (charId: string, guildId: string, targetId: string) =>
        post(`${c(charId)}/guilds/${guildId}/kick/${targetId}`),
    leaveGuild: (charId: string, guildId: string) => post(`${c(charId)}/guilds/${guildId}/leave`),
    disbandGuild: (charId: string, guildId: string) => post(`${c(charId)}/guilds/${guildId}/disband`),
    guildBossDamage: (charId: string, guildId: string) => post(`${c(charId)}/guilds/${guildId}/boss/damage`),
    guildBossState: (charId: string, guildId: string) => get(`${c(charId)}/guilds/${guildId}/boss`),
    guildBossClaim: (charId: string, guildId: string) => post(`${c(charId)}/guilds/${guildId}/boss/claim-reward`),
    guildTreasury: (charId: string, guildId: string) => get(`${c(charId)}/guilds/${guildId}/treasury`),
    guildTreasuryDeposit: (charId: string, guildId: string, itemUuid: string) =>
        post(`${c(charId)}/guilds/${guildId}/treasury/deposit`, { itemUuid }),
    guildTreasuryWithdraw: (charId: string, guildId: string, treasuryItemId: string) =>
        post(`${c(charId)}/guilds/${guildId}/treasury/withdraw`, { treasuryItemId }),
    guildsBrowse: (params?: IGuildsBrowseParams) => {
        const qs = new URLSearchParams();
        if (params?.offset !== undefined) qs.set('offset', String(params.offset));
        if (params?.limit !== undefined) qs.set('limit', String(params.limit));
        if (params?.search !== undefined) qs.set('search', params.search);
        const suffix = qs.toString();
        return get(`/api/v1/guilds${suffix ? `?${suffix}` : ''}`);
    },

    // -- Party --
    createParty: (charId: string, body: Record<string, unknown>) => post(`${c(charId)}/parties`, body),
    showParty: (charId: string, partyId: string) => get(`${c(charId)}/parties/${partyId}`),
    joinParty: (charId: string, partyId: string, password?: string) =>
        post(`${c(charId)}/parties/${partyId}/join`, { password }),
    leaveParty: (charId: string, partyId: string) => post(`${c(charId)}/parties/${partyId}/leave`),
    handoverParty: (charId: string, partyId: string, newLeaderId: string) =>
        post(`${c(charId)}/parties/${partyId}/handover`, { newLeaderId }),
    kickParty: (charId: string, partyId: string, memberRowId: string) =>
        post(`${c(charId)}/parties/${partyId}/kick`, { memberRowId }),
    updateParty: (charId: string, partyId: string, patch: IPartyPatch) =>
        client.put(`${c(charId)}/parties/${partyId}`, { requestId: rid(), ...patch }).then((r) => r.data),
    listPublicParties: () => get('/api/v1/parties'),
    myActiveParty: (charId: string) => get(`${c(charId)}/parties/active`),

    // -- Chat --
    chatSend: (charId: string, body: { channel: string; content: string }) =>
        post(`${c(charId)}/chat/messages`, body),
    chatSystemEvent: (charId: string, payload: Record<string, unknown>) =>
        post(`${c(charId)}/chat/system-event`, payload),

    // -- Postać (create/delete) --
    createCharacter: (body: { name: string; class: string }) => post('/api/v1/characters', body),
    deleteCharacter: (charId: string) => del(`/api/v1/characters/${charId}`),

    // -- DPS --
    dpsRecord: (charId: string, body: Record<string, unknown>) => post(`${c(charId)}/dps-record`, body),
};

export type BackendApi = typeof backendApi;
