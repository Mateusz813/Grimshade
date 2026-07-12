import { create } from 'zustand';
import {
  createBotHelper,
  canJoinParty,
  type IPartyMember,
  type IPartyInfo,
} from '../systems/partySystem';
import type { CharacterClass } from '../api/v1/characterApi';
import { partyApi, extractApiError, type IPartyWithMembers, type IPartyMemberRow } from '../api/v1/partyApi';
import { isBackendMode } from '../config/backendMode';
import { backendApi, type IPartyPatch } from '../api/backend/backendApi';

const BACKEND_POLL_MS = 8000;


const adaptToPartyInfo = (raw: IPartyWithMembers): IPartyInfo => ({
  id: raw.id,
  leaderId: raw.leader_id,
  members: raw.members.map(rowToMember),
  createdAt: raw.created_at,
  name: raw.name,
  description: raw.description ?? '',
  hasPassword: raw.has_password,
  isPublic: raw.is_public,
  maxMembers: raw.max_members,
  minJoinLevel: raw.min_join_level ?? 1,
});

const rowToMember = (row: IPartyMemberRow): IPartyMember => ({
  id: row.character_id,
  name: row.character_name,
  class: row.character_class,
  level: row.character_level,
  hp: 0,
  maxHp: 1,
  isOnline: true,
});

interface ICreatePartyOptions {
  name: string;
  description: string;
  password: string | null;
  isPublic: boolean;
  minJoinLevel?: number;
}

interface IPartyStore {
  party: IPartyInfo | null;
  loading: boolean;
  error: string | null;

  publicParties: IPartyWithMembers[];

  createParty: (self: IPartyMember, options: ICreatePartyOptions) => Promise<void>;

  joinPartyById: (partyId: string, self: IPartyMember, password?: string) => Promise<void>;

  leaveParty: (selfId: string) => Promise<void>;

  disbandParty: (selfId: string) => Promise<void>;

  kickByRowId: (rowId: string) => Promise<void>;

  updateMeta: (patch: { description?: string; password?: string | null; isPublic?: boolean }) => Promise<void>;

  transferLeadership: (newLeaderId: string) => Promise<void>;

  hydrateActiveParty: (characterId: string) => Promise<void>;

  addBotHelper: () => void;

  removeMember: (memberId: string) => void;

  subscribePublicFeed: () => () => void;

  refreshPublicParties: () => Promise<void>;

  subscribeToActiveParty: () => () => void;
}

export const usePartyStore = create<IPartyStore>()((set, get) => ({
  party: null,
  loading: false,
  error: null,
  publicParties: [],

  createParty: async (self, options) => {
    if (isBackendMode()) {
      set({ loading: true, error: null });
      try {
        const fresh = await backendApi.createParty(self.id, {
          name:         options.name.trim() || `${self.name}'s party`,
          description:  options.description.trim(),
          password:     options.password,
          isPublic:     options.isPublic,
          minJoinLevel: options.minJoinLevel ?? 1,
        }) as IPartyWithMembers;
        set({ party: adaptToPartyInfo(fresh), loading: false });
      } catch (err) {
        console.error('[partyStore] backend createParty failed:', err);
        const msg = extractApiError(err) || (err instanceof Error ? err.message : 'Nie udało się utworzyć party.');
        set({ loading: false, error: msg, party: null });
      }
      return;
    }
    set({ loading: true, error: null });
    try {
      const fresh = await partyApi.createParty({
        leaderId:        self.id,
        name:            options.name.trim() || `${self.name}'s party`,
        description:     options.description.trim(),
        password:        options.password,
        isPublic:        options.isPublic,
        minJoinLevel:    options.minJoinLevel ?? 1,
        characterId:     self.id,
        characterName:   self.name,
        characterClass:  self.class as CharacterClass,
        characterLevel:  self.level,
        partyId:         '',
      });
      if (!fresh) throw new Error('Nie udało się utworzyć party.');
      set({ party: adaptToPartyInfo(fresh), loading: false });
    } catch (err) {
      console.error('[partyStore] createParty failed:', err);
      const msg = extractApiError(err) || (err instanceof Error ? err.message : 'Nie udało się utworzyć party.');
      set({ loading: false, error: msg, party: null });
    }
  },

  joinPartyById: async (partyId, self, password) => {
    if (isBackendMode()) {
      set({ loading: true, error: null });
      try {
        const fresh = await backendApi.joinParty(self.id, partyId, password) as IPartyWithMembers;
        set({ party: adaptToPartyInfo(fresh), loading: false });
      } catch (err) {
        set({ loading: false, error: extractApiError(err) });
      }
      return;
    }
    set({ loading: true, error: null });
    try {
      const result = await partyApi.joinParty({
        partyId,
        characterId:    self.id,
        characterName:  self.name,
        characterClass: self.class as CharacterClass,
        characterLevel: self.level,
        password,
      });
      if ('error' in result) {
        set({ loading: false, error: result.error });
        return;
      }
      set({ party: adaptToPartyInfo(result), loading: false });
    } catch (err) {
      set({
        loading: false,
        error: extractApiError(err),
      });
    }
  },

  leaveParty: async (selfId) => {
    const { party } = get();
    if (!party) return;
    if (isBackendMode()) {
      set({ party: null });
      try {
        await backendApi.leaveParty(selfId, party.id);
      } catch {
      }
      return;
    }
    try {
      sessionStorage.setItem(
        'grimshade_party_left_at',
        JSON.stringify({ partyId: party.id, at: Date.now() }),
      );
    } catch { }
    set({ party: null });
    try {
      await partyApi.leaveParty(party.id, selfId);
    } catch {
    }
  },

  disbandParty: async (selfId) => {
    const { party } = get();
    if (!party) return;
    if (isBackendMode()) {
      try {
        await backendApi.leaveParty(selfId, party.id);
      } catch {
      }
      set({ party: null });
      return;
    }
    try {
      await partyApi.leaveParty(party.id, selfId);
    } catch {
    }
    set({ party: null });
  },

  kickByRowId: async (rowId) => {
    const { party } = get();
    if (!party) return;
    if (isBackendMode()) {
      try {
        const fresh = await backendApi.kickParty(party.leaderId, party.id, rowId) as IPartyWithMembers;
        set({ party: adaptToPartyInfo(fresh) });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Błąd wyrzucania gracza.' });
      }
      return;
    }
    try {
      await partyApi.kickMember(party.id, rowId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Błąd wyrzucania gracza.' });
    }
  },

  updateMeta: async (patch) => {
    const { party } = get();
    if (!party) return;
    if (isBackendMode()) {
      const backendPatch: IPartyPatch = {};
      if (patch.description !== undefined) backendPatch.description = patch.description;
      if (patch.isPublic !== undefined) backendPatch.isPublic = patch.isPublic;
      if (patch.password !== undefined) backendPatch.password = patch.password ?? '';
      try {
        const fresh = await backendApi.updateParty(party.leaderId, party.id, backendPatch) as IPartyWithMembers;
        set({ party: adaptToPartyInfo(fresh) });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Błąd aktualizacji party.' });
      }
      return;
    }
    try {
      await partyApi.updatePartyMeta(party.id, {
        description: patch.description,
        password:    patch.password,
        is_public:   patch.isPublic,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Błąd aktualizacji party.' });
    }
  },

  hydrateActiveParty: async (characterId) => {
    if (isBackendMode()) {
      try {
        const fresh = await backendApi.myActiveParty(characterId) as IPartyWithMembers | null;
        if (fresh) {
          set({ party: adaptToPartyInfo(fresh) });
        } else {
          set({ party: null });
        }
      } catch {
      }
      return;
    }
    try {
      const fresh = await partyApi.getMyActiveParty(characterId);
      if (fresh) {
        try {
          const raw = sessionStorage.getItem('grimshade_party_left_at');
          if (raw) {
            const { partyId, at } = JSON.parse(raw) as { partyId: string; at: number };
            const fresh30s = Date.now() - at < 30_000;
            if (fresh30s && partyId === fresh.id) {
              await partyApi.deleteMyStaleMemberships(characterId);
              return;
            }
          }
        } catch { }
        const localBots = get().party?.members.filter((m) => m.isBot) ?? [];
        const adapted = adaptToPartyInfo(fresh);
        set({ party: { ...adapted, members: [...adapted.members, ...localBots] } });
        return;
      }
      if (!get().party) {
        await partyApi.deleteMyStaleMemberships(characterId);
      }
    } catch {
    }
  },

  transferLeadership: async (newLeaderId) => {
    const { party } = get();
    if (!party) return;
    if (isBackendMode()) {
      const actingLeaderId = party.leaderId;
      set({ party: { ...party, leaderId: newLeaderId } });
      try {
        const fresh = await backendApi.handoverParty(actingLeaderId, party.id, newLeaderId) as IPartyWithMembers;
        set({ party: adaptToPartyInfo(fresh) });
      } catch (err) {
        set({ party, error: err instanceof Error ? err.message : 'Nie udało się przekazać lidera.' });
      }
      return;
    }
    set({ party: { ...party, leaderId: newLeaderId } });
    try {
      await partyApi.transferLeadership(party.id, newLeaderId);
    } catch (err) {
      set({ party, error: err instanceof Error ? err.message : 'Nie udało się przekazać lidera.' });
    }
  },

  addBotHelper: () => {
    const { party } = get();
    if (!party || !canJoinParty(party.members.length)) return;
    void import('./connectivityStore').then(({ isOfflineMode }) => {
      if (isOfflineMode()) return;
      const bot = createBotHelper(party.members);
      set((s) => (s.party ? { party: { ...s.party, members: [...s.party.members, bot] } } : s));
    }).catch(() => {
      const bot = createBotHelper(party.members);
      set({ party: { ...party, members: [...party.members, bot] } });
    });
  },

  removeMember: (memberId) => {
    const { party } = get();
    if (!party) return;
    const members = party.members.filter((m) => m.id !== memberId);
    if (members.length === 0) {
      set({ party: null });
    } else {
      set({ party: { ...party, members } });
    }
  },

  subscribePublicFeed: () => {
    if (isBackendMode()) {
      void get().refreshPublicParties();
      const interval = setInterval(() => { void get().refreshPublicParties(); }, BACKEND_POLL_MS);
      return () => { clearInterval(interval); };
    }
    const unsub = partyApi.subscribePublicFeed(
      (parties) => set({ publicParties: parties, error: null }),
      (err) => {
        const msg = err instanceof Error ? err.message : 'Nie udało się pobrać listy party.';
        set({ error: msg });
      },
    );
    return unsub;
  },

  refreshPublicParties: async () => {
    set({ loading: true });
    if (isBackendMode()) {
      try {
        const rows = await backendApi.listPublicParties() as IPartyWithMembers[];
        set({ publicParties: rows, loading: false, error: null });
      } catch (err) {
        const msg = extractApiError(err) || 'Nie udało się pobrać listy party.';
        set({ loading: false, error: msg });
      }
      return;
    }
    try {
      const rows = await partyApi.listPublicParties();
      set({ publicParties: rows, loading: false, error: null });
    } catch (err) {
      const msg = extractApiError(err) || 'Nie udało się pobrać listy party.';
      set({ loading: false, error: msg });
    }
  },

  subscribeToActiveParty: () => {
    const { party } = get();
    if (!party) return () => {};
    if (isBackendMode()) {
      const interval = setInterval(() => {
        void import('./characterStore').then(({ useCharacterStore }) => {
          const cid = useCharacterStore.getState().character?.id;
          if (cid) void get().hydrateActiveParty(cid);
        }).catch(() => { });
      }, BACKEND_POLL_MS);
      return () => { clearInterval(interval); };
    }
    const unsub = partyApi.subscribeParty(party.id, (fresh) => {
      if (!fresh) {
        set({ party: null });
        return;
      }
      const localBots = get().party?.members.filter((m) => m.isBot) ?? [];
      const adapted = adaptToPartyInfo(fresh);
      set({ party: { ...adapted, members: [...adapted.members, ...localBots] } });
    });
    return unsub;
  },
}));
