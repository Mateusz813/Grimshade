import { create } from 'zustand';
import {
  createBotHelper,
  canJoinParty,
  type IPartyMember,
  type IPartyInfo,
} from '../systems/partySystem';
import type { CharacterClass } from '../api/v1/characterApi';
import { partyApi, extractApiError, type IPartyWithMembers, type IPartyMemberRow } from '../api/v1/partyApi';

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
  minJoinLevel: raw.min_join_level ?? 1,
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
  /** Optional minimum level. 1 (or undefined) = no restriction. */
  minJoinLevel?: number;
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

  /** Hand off leadership to another member (leader only). */
  transferLeadership: (newLeaderId: string) => Promise<void>;

  /**
   * Fetch the user's active party from DB and hydrate the local store.
   * Call this on app boot / Party page mount so a refresh restores the
   * correct party instead of leaving the local store empty while the
   * server-side membership row still exists. If no membership is found
   * AND the local store also has no party, optionally cleans any stale
   * member rows so zombie parties don't linger in the public feed.
   */
  hydrateActiveParty: (characterId: string) => Promise<void>;

  /** Add a local-only bot helper for bossfights. */
  addBotHelper: () => void;

  /** Legacy local helper — removes any member by id (used for bots). */
  removeMember: (memberId: string) => void;

  /** Start streaming the public parties feed (cleanup when browser unmounts). */
  subscribePublicFeed: () => () => void;

  /** Manually re-fetch the public parties list (used by refresh button). */
  refreshPublicParties: () => Promise<void>;

  /** Start streaming updates for whichever party the user is currently in. */
  subscribeToActiveParty: () => () => void;
}

export const usePartyStore = create<IPartyStore>()((set, get) => ({
  party: null,
  loading: false,
  error: null,
  publicParties: [],

  createParty: async (self, options) => {
    // 2026-05-13 spec ("nie moge tworzyc party w trakcie polowania offline"):
    // block party creation ONLY while an offline HUNT is running — the
    // 12h passive kill-accumulation flow. The always-on active training
    // that ticks during normal gameplay is allowed (it's just the
    // baseline state for any logged-in character, blocking it would lock
    // every player out of party creation entirely).
    //
    // History: the first version of this gate checked
    // `skillStore.offlineTrainingSkillId`, which never resets to null
    // once a stat was picked — locking the player out forever. The
    // second iteration tightened it to `trainingSegmentStartedAt`, but
    // that flag is ALSO true during normal active training, so it
    // still blocked the common case. Offline-hunt is the only mode
    // that genuinely conflicts with shared party combat.
    try {
      const { useOfflineHuntStore } = await import('./offlineHuntStore');
      if (useOfflineHuntStore.getState().isActive) {
        set({ error: 'Najpierw zakończ polowanie offline, zanim stworzysz party.' });
        return;
      }
    } catch {
      /* defensive: offlineHuntStore not available — skip the guard */
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
        partyId:         '', // ignored by createParty
      });
      if (!fresh) throw new Error('Nie udało się utworzyć party.');
      set({ party: adaptToPartyInfo(fresh), loading: false });
    } catch (err) {
      // 2026-05-09 spec ("Wchodze na inna postac i nie widze stworzonego
      // party przezemnie"): the previous code silently fell back to a
      // local-only party (`id: 'local_<ts>'`) when the API failed, so the
      // leader saw a party that was NEVER persisted to Supabase — other
      // characters could never join because the row didn't exist. Now we
      // surface the real error so the player can act on it (fix RLS,
      // run the migration, etc.) instead of being misled.
      // eslint-disable-next-line no-console
      console.error('[partyStore] createParty failed:', err);
      const msg = extractApiError(err) || (err instanceof Error ? err.message : 'Nie udało się utworzyć party.');
      set({ loading: false, error: msg, party: null });
    }
  },

  joinPartyById: async (partyId, self, password) => {
    // 2026-05-13: same guard as createParty — offline hunt and shared
    // party combat are mutually exclusive. Joining a party while the
    // 12h hunt is running would either silently kill the hunt's
    // accumulation or leave the player double-booked between two
    // active systems.
    try {
      const { useOfflineHuntStore } = await import('./offlineHuntStore');
      if (useOfflineHuntStore.getState().isActive) {
        set({ error: 'Najpierw zakończ polowanie offline, zanim dołączysz do party.' });
        return;
      }
    } catch {
      /* defensive */
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
    // 2026-05-13 spec ("po wejsciu na postac moja postac byla w party!!!"):
    // record the just-left party so `hydrateActiveParty` ignores any
    // server row that hasn't been deleted yet by Supabase's eventually
    // consistent realtime layer. 30 s is long enough for the delete
    // chain to land + short enough that a player who joins the same
    // party again can re-hydrate.
    try {
      sessionStorage.setItem(
        'grimshade_party_left_at',
        JSON.stringify({ partyId: party.id, at: Date.now() }),
      );
    } catch { /* ignore */ }
    set({ party: null });
    try {
      await partyApi.leaveParty(party.id, selfId);
    } catch {
      // Non-fatal — clear locally regardless so the UI doesn't get stuck.
    }
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

  hydrateActiveParty: async (characterId) => {
    try {
      const fresh = await partyApi.getMyActiveParty(characterId);
      if (fresh) {
        // 2026-05-13: if we JUST left this exact party (sessionStorage
        // marker), the server's still-present row is a stale read
        // from before our DELETE committed. Don't re-hydrate it —
        // instead delete the orphan row(s) and stay out.
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
        } catch { /* ignore parse failures */ }
        // Server says we're in a party — hydrate the local store.
        // Preserve any local-only bot helpers already in the members array
        // (bots are local-only, never on the server) — mirror subscribeToActiveParty.
        const localBots = get().party?.members.filter((m) => m.isBot) ?? [];
        const adapted = adaptToPartyInfo(fresh);
        set({ party: { ...adapted, members: [...adapted.members, ...localBots] } });
        return;
      }
      // Server says no membership. If our local store also has no
      // party, clean any stale member rows so zombie parties don't
      // linger in the public feed (a user can leave a tab open from
      // hours ago, refresh today, and see their old party still
      // taking a slot).
      if (!get().party) {
        await partyApi.deleteMyStaleMemberships(characterId);
      }
    } catch {
      // Non-fatal — keep whatever we had.
    }
  },

  transferLeadership: async (newLeaderId) => {
    const { party } = get();
    if (!party) return;
    // Optimistic update — flip leader_id locally so the buttons re-render.
    // Realtime push will sync any divergence within the second.
    set({ party: { ...party, leaderId: newLeaderId } });
    try {
      await partyApi.transferLeadership(party.id, newLeaderId);
    } catch (err) {
      // Roll back on failure.
      set({ party, error: err instanceof Error ? err.message : 'Nie udało się przekazać lidera.' });
    }
  },

  addBotHelper: () => {
    const { party } = get();
    if (!party || !canJoinParty(party.members.length)) return;
    // 2026-05-20 spec ("W grze offline nie moge nawet walczyc z botami
    // razem"): bot helpers are blocked in offline mode. We pull the
    // mode dynamically so the partyStore doesn't get a hard dep on
    // connectivityStore at module load (avoids potential cycles).
    void import('./connectivityStore').then(({ isOfflineMode }) => {
      if (isOfflineMode()) return; // silent — UI already shows the offline pill
      const bot = createBotHelper(party.members);
      set((s) => (s.party ? { party: { ...s.party, members: [...s.party.members, bot] } } : s));
    }).catch(() => {
      // If the dynamic import somehow fails, default to the old
      // behaviour rather than soft-locking the player out.
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
