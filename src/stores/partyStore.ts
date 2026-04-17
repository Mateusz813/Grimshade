import { create } from 'zustand';
import {
  createBotHelper,
  canJoinParty,
  type IPartyMember,
  type IPartyInfo,
} from '../systems/partySystem';
import type { CharacterClass } from '../api/v1/characterApi';
import { partyApi, type IPartyWithMembers, type IPartyMemberRow } from '../api/v1/partyApi';

/**
 * Party store — thin wrapper around `partyApi` + Supabase Realtime.
 *
 * Everything is server-backed now: `createParty`, `joinParty`, `leaveParty`,
 * `kickMember` all round-trip through the `parties` / `party_members` tables,
 * and `subscribeToActiveParty()` keeps the local `party` state in sync with
 * any update another member triggers.
 *
 * Bot helpers are still local-only: they live in the party members array in
 * memory but never hit the server (bots don't have characters to join rows).
 */

/** Convert a raw server-side party row into the in-memory shape used by the UI. */
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
});

const rowToMember = (row: IPartyMemberRow): IPartyMember => ({
  id: row.character_id,
  name: row.character_name,
  class: row.character_class,
  level: row.character_level,
  hp: 0, // HP comes from the live character store when entering combat
  maxHp: 1,
  isOnline: true,
});

interface ICreatePartyOptions {
  name: string;
  description: string;
  password: string | null;
  isPublic: boolean;
}

interface IPartyStore {
  party: IPartyInfo | null;
  loading: boolean;
  error: string | null;

  /** Live-updated list of public parties (the browser feed). */
  publicParties: IPartyWithMembers[];

  /** Create a new party on the server (user becomes leader + first member). */
  createParty: (self: IPartyMember, options: ICreatePartyOptions) => Promise<void>;

  /** Join a public/private party by id (password required for private). */
  joinPartyById: (partyId: string, self: IPartyMember, password?: string) => Promise<void>;

  /** Leave the current party. Leader leaving deletes the party entirely. */
  leaveParty: (selfId: string) => Promise<void>;

  /** Disband a party (leader only). */
  disbandParty: (selfId: string) => Promise<void>;

  /** Kick a member by their party_members row id (leader only). */
  kickByRowId: (rowId: string) => Promise<void>;

  /** Edit party meta (description/password/public). Leader only. */
  updateMeta: (patch: { description?: string; password?: string | null; isPublic?: boolean }) => Promise<void>;

  /** Add a local-only bot helper for bossfights. */
  addBotHelper: () => void;

  /** Legacy local helper — removes any member by id (used for bots). */
  removeMember: (memberId: string) => void;

  /** Start streaming the public parties feed (cleanup when browser unmounts). */
  subscribePublicFeed: () => () => void;

  /** Start streaming updates for whichever party the user is currently in. */
  subscribeToActiveParty: () => () => void;
}

export const usePartyStore = create<IPartyStore>()((set, get) => ({
  party: null,
  loading: false,
  error: null,
  publicParties: [],

  createParty: async (self, options) => {
    set({ loading: true, error: null });
    try {
      const fresh = await partyApi.createParty({
        leaderId:        self.id,
        name:            options.name.trim() || `${self.name}'s party`,
        description:     options.description.trim(),
        password:        options.password,
        isPublic:        options.isPublic,
        characterId:     self.id,
        characterName:   self.name,
        characterClass:  self.class as CharacterClass,
        characterLevel:  self.level,
        partyId:         '', // ignored by createParty
      });
      if (!fresh) throw new Error('Nie udało się utworzyć party.');
      set({ party: adaptToPartyInfo(fresh), loading: false });
    } catch {
      // API failed (missing table/RLS) — create local-only party as fallback
      // so players can still use party features (bots, buffs) without Supabase.
      const localParty: IPartyInfo = {
        id: `local_${Date.now()}`,
        leaderId: self.id,
        members: [self],
        createdAt: new Date().toISOString(),
        name: options.name.trim() || `${self.name}'s party`,
        description: options.description.trim(),
        hasPassword: !!options.password,
        isPublic: options.isPublic,
        maxMembers: 4,
      };
      set({ party: localParty, loading: false, error: null });
    }
  },

  joinPartyById: async (partyId, self, password) => {
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
        error: err instanceof Error ? err.message : 'Błąd dołączania do party.',
      });
    }
  },

  leaveParty: async (selfId) => {
    const { party } = get();
    if (!party) return;
    try {
      await partyApi.leaveParty(party.id, selfId);
    } catch {
      // Non-fatal — clear locally regardless so the UI doesn't get stuck.
    }
    set({ party: null });
  },

  disbandParty: async (selfId) => {
    const { party } = get();
    if (!party) return;
    try {
      await partyApi.leaveParty(party.id, selfId);
    } catch {
      // ignore
    }
    set({ party: null });
  },

  kickByRowId: async (rowId) => {
    const { party } = get();
    if (!party) return;
    try {
      await partyApi.kickMember(party.id, rowId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Błąd wyrzucania gracza.' });
    }
  },

  updateMeta: async (patch) => {
    const { party } = get();
    if (!party) return;
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

  addBotHelper: () => {
    const { party } = get();
    if (!party || !canJoinParty(party.members.length)) return;
    const bot = createBotHelper(party.members);
    set({ party: { ...party, members: [...party.members, bot] } });
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
    const unsub = partyApi.subscribePublicFeed((parties) => {
      set({ publicParties: parties });
    });
    return unsub;
  },

  subscribeToActiveParty: () => {
    const { party } = get();
    if (!party) return () => {};
    const unsub = partyApi.subscribeParty(party.id, (fresh) => {
      if (!fresh) {
        set({ party: null });
        return;
      }
      // Preserve any local-only bot helpers already in the members array.
      const localBots = get().party?.members.filter((m) => m.isBot) ?? [];
      const adapted = adaptToPartyInfo(fresh);
      set({ party: { ...adapted, members: [...adapted.members, ...localBots] } });
    });
    return unsub;
  },
}));
