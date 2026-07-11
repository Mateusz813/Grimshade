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

/**
 * Backend-mode poll interval (ms) for the public feed + active-party
 * pollers. Realtime (Supabase channels) is deferred in backend mode
 * (Faza 7 świadomie pominięte), so we fall back to a lightweight poll
 * that re-fetches the authoritative snapshot from Laravel.
 */
const BACKEND_POLL_MS = 8000;

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
    // 2026-07-11 (owner request): tworzenie party DOZWOLONE w trakcie polowania
    // offline / treningu. Formowanie party to akcja rosterowa, nie walka — nie
    // rusza działającego polowania (leci dalej w tle, bez utraty akumulacji).
    // Ewentualny konflikt na czas WALKI party jest obsługiwany przy jej starcie.
    // Backend-authoritative branch (opt-in). Server creates the party +
    // inserts the leader, and returns the IPartyWithMembers snapshot which
    // adaptToPartyInfo consumes 1:1. The direct Supabase write below is
    // skipped entirely so nothing double-fires.
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
    // 2026-07-11 (owner request): dołączanie do party DOZWOLONE w trakcie
    // polowania offline / treningu (akcja rosterowa, nie walka; hunt leci dalej).
    // Backend-authoritative branch (opt-in). Server validates capacity /
    // password / min-level under a row lock and returns the fresh snapshot.
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
    // Backend-authoritative branch (opt-in). Server owns the single-party
    // invariant, so we skip the sessionStorage stale-membership dance
    // (that only exists to work around Supabase realtime eventual
    // consistency). Clear locally immediately regardless of the result.
    if (isBackendMode()) {
      set({ party: null });
      try {
        await backendApi.leaveParty(selfId, party.id);
      } catch {
        // Non-fatal — UI already cleared so it can't get stuck.
      }
      return;
    }
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
    // Backend-authoritative branch (opt-in). Leader leaving dissolves the
    // party server-side; the response is {dissolved:true,party:null} so we
    // just clear locally.
    if (isBackendMode()) {
      try {
        await backendApi.leaveParty(selfId, party.id);
      } catch {
        // Non-fatal — clear locally regardless.
      }
      set({ party: null });
      return;
    }
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
    // Backend-authoritative branch (opt-in). Kick is a leader-only action,
    // so the acting character is the current leader. Server returns the
    // fresh snapshot without the kicked member.
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
    // Backend-authoritative branch (opt-in). Edit party meta is leader-only;
    // server returns the fresh snapshot with the applied changes. Empty
    // password ('') clears the gate server-side — mirror the legacy null
    // semantics by mapping null -> ''.
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
    // Backend-authoritative branch (opt-in). Server owns the single-party
    // invariant, so we skip the Supabase stale-membership deletes + the
    // sessionStorage "just-left" dance entirely — the /active endpoint is
    // the source of truth. null => not in any party (clear local).
    if (isBackendMode()) {
      try {
        const fresh = await backendApi.myActiveParty(characterId) as IPartyWithMembers | null;
        if (fresh) {
          set({ party: adaptToPartyInfo(fresh) });
        } else {
          set({ party: null });
        }
      } catch {
        // Non-fatal — keep whatever we had.
      }
      return;
    }
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
    // Backend-authoritative branch (opt-in). Handover is leader-only, so the
    // acting character is the CURRENT leader (captured before the optimistic
    // flip). Server returns the fresh snapshot with roles + leader_id set.
    if (isBackendMode()) {
      const actingLeaderId = party.leaderId;
      set({ party: { ...party, leaderId: newLeaderId } }); // optimistic
      try {
        const fresh = await backendApi.handoverParty(actingLeaderId, party.id, newLeaderId) as IPartyWithMembers;
        set({ party: adaptToPartyInfo(fresh) });
      } catch (err) {
        // Roll back on failure.
        set({ party, error: err instanceof Error ? err.message : 'Nie udało się przekazać lidera.' });
      }
      return;
    }
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
    // Backend-authoritative branch (opt-in). Realtime is deferred, so we
    // fall back to a lightweight poller that re-fetches the public feed.
    // We deliberately do NOT open a supabase.channel in backend mode.
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
    // Backend-authoritative branch (opt-in). Server returns the same
    // IPartyWithMembers[] shape the browser already consumes.
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
    // Backend-authoritative branch (opt-in). Realtime is deferred, so we
    // poll the /active endpoint via hydrateActiveParty (which clears the
    // local party if the server says we're no longer in one — kicked /
    // dissolved). We resolve the acting character id lazily to avoid a
    // hard import cycle with characterStore. No supabase.channel here.
    if (isBackendMode()) {
      const interval = setInterval(() => {
        void import('./characterStore').then(({ useCharacterStore }) => {
          const cid = useCharacterStore.getState().character?.id;
          if (cid) void get().hydrateActiveParty(cid);
        }).catch(() => { /* defensive — skip this tick */ });
      }, BACKEND_POLL_MS);
      return () => { clearInterval(interval); };
    }
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
