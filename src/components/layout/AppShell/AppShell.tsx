import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatHudStore } from '../../../stores/combatHudStore';
import { useAppRouteStore } from '../../../stores/appRouteStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useGuildStore } from '../../../stores/guildStore';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
import {
  shouldDieOnDisconnect,
  resolveDisconnectSource,
  DISCONNECT_COMBAT_ROUTES,
  DISCONNECT_ARENA_ROUTES,
} from '../../../systems/disconnectPolicy';
import { useDeathStore } from '../../../stores/deathStore';
import { useSyncStore } from '../../../stores/syncStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { usePartyPresence } from '../../../hooks/usePartyPresence';
import { usePartyReadyCheck, useReadyCheckGoEffect } from '../../../hooks/usePartyReadyCheck';
import { usePartyCombatSync } from '../../../hooks/usePartyCombatSync';
import TopHeader from '../TopHeader/TopHeader';
import BottomNav from '../BottomNav/BottomNav';
import PartyWidget from '../../ui/PartyWidget/PartyWidget';
import ReadyCheckModal from '../../ui/ReadyCheckModal/ReadyCheckModal';
import './AppShell.scss';

interface IAppShellProps {
  children: React.ReactNode;
}

/**
 * Routes where the player has no character context yet — login / register /
 * character-select. The fixed top header and bottom nav must NOT render here,
 * because they are character-specific (gold, avatar, buffs).
 */
const CHARACTERLESS_ROUTES = new Set<string>([
  '/login',
  '/register',
  '/forgot-password',
  '/character-select',
  '/create-character',
]);

/**
 * Wraps every routed page. When a character is active and we're not on an
 * auth/select screen, the shell mounts the persistent TopHeader at the top and
 * BottomNav at the bottom and pads the inner content area so they don't
 * overlap the page.
 *
 * On characterless routes the chrome stays hidden but the wrapper DOM stays
 * stable so React doesn't remount the entire routed tree just because the
 * chrome flipped — we simply toggle a `--bare` modifier that drops the inner
 * padding.
 */
// Routes whose view owns the in-combat HUD (renders its own CombatHudHost +
// CombatActionBar). On these routes AppShell must NOT force-reset the HUD flag
// on navigation — the view's CombatHudHost decides based on its live phase.
// Resetting here would clobber that set in the same commit (child effect runs
// before this parent effect), which left the global BottomNav showing during an
// active background fight re-entered from Town. Non-combat routes still get the
// defensive reset below.
const COMBAT_HUD_ROUTES: ReadonlySet<string> = new Set([
  '/combat', '/dungeon', '/boss', '/raid', '/transform', '/trainer', '/arena', '/arena/match',
]);

const AppShell = ({ children }: IAppShellProps) => {
  const location = useLocation();
  const character = useCharacterStore((s) => s.character);
  const combatHudActive = useCombatHudStore((s) => s.active);
  const combatHudCompact = useCombatHudStore((s) => s.compact);
  const setCombatHudActive = useCombatHudStore((s) => s.setActive);
  const setCombatHudCompact = useCombatHudStore((s) => s.setCompact);

  // 2026-05-09: keep the realtime party-presence channel open while
  // we're in a party. Drives PartyWidget's live HP/MP bars + ally
  // transform avatars. Hook bails internally when there's no party.
  usePartyPresence();
  // 2026-05-09: party ready-check — channel subscription + post-`go`
  // navigation. The actual gate runs on click (see
  // `requestPartyCombatStart`), not on route entry.
  usePartyReadyCheck();
  // Runs queued go-actions for leader + per-destination replicators
  // for members once everyone confirms.
  useReadyCheckGoEffect();
  // 2026-05-09: keep the realtime combat-sync channel open while we're
  // in a multi-human party. Leader broadcasts authoritative combat
  // state; members mirror it locally so everyone sees the same fight.
  // Hook bails internally for solo / bots-only parties.
  usePartyCombatSync();

  // 2026-05-09: subscribe to live `party_members` row changes for the
  // party we're currently in. Without this the leader / other members
  // only see departures when they navigate to the /party view (which
  // is where the subscription used to live). Mounting it here means
  // a teammate that hits "Wyjdź z party" disappears from EVERY screen
  // (including the in-fight ally column) within a tick.
  const activePartyId = usePartyStore((s) => s.party?.id);
  const subscribeToActiveParty = usePartyStore((s) => s.subscribeToActiveParty);
  useEffect(() => {
    if (!activePartyId) return;
    const unsub = subscribeToActiveParty();
    return unsub;
  }, [activePartyId, subscribeToActiveParty]);

  // 2026-05-19 spec ("Zawsze powinny być zakładki Globalny chat. Party
  // chat jeżeli jesteśmy w party"): keep the Party / Guild tabs in the
  // GlobalChat tab list in sync with live membership. When the active
  // party / guild id changes, the chat tabs store adds or removes the
  // corresponding tab so the chat view always reflects the current
  // social state without the user having to open it first.
  const activeGuildId = useGuildStore((s) => s.guild?.id ?? null);
  useEffect(() => {
    useChatTabsStore.getState().syncPartyTab(activePartyId ?? null);
  }, [activePartyId]);
  useEffect(() => {
    useChatTabsStore.getState().syncGuildTab(activeGuildId);
  }, [activeGuildId]);

  // 2026-05-18: hydrate the guild store on character switch / login so
  // [TAG] prefixes render everywhere (chat, town, rankings, deaths)
  // without waiting for the user to actually navigate to /guild. Re-runs
  // whenever the active character id changes.
  useEffect(() => {
    if (!character?.id) {
      void import('../../../stores/guildStore').then(({ useGuildStore }) => {
        useGuildStore.getState().clear();
      }).catch(() => { /* offline */ });
      return;
    }
    const id = character.id;
    void import('../../../stores/guildStore').then(({ useGuildStore }) => {
      void useGuildStore.getState().hydrateForCharacter(id);
    }).catch(() => { /* offline */ });
  }, [character?.id]);

  // 2026-05-13 spec ("sojusznicy zostac wywaleni do miasta i to powinno
  // byc potraktowane jak ucieczka z walki czyli 1/10 kary, chyba ze to
  // polowanie to nic"): detect involuntary party dissolution (server
  // delete from leader-leave or kick) while the local player is in a
  // shared boss/raid/trainer fight, and treat it like a flee — small
  // XP penalty + send the player home. Hunt is exempt (the spec
  // explicitly carves it out — hunt members already have their own
  // graceful exit via combat-end broadcast).
  const prevPartyLeaderRef = useRef<string | null>(null);
  const partyForFleeWatcher = usePartyStore((s) => s.party);
  useEffect(() => {
    const me = character?.id;
    const prevLeaderId = prevPartyLeaderRef.current;
    const currentLeaderId = partyForFleeWatcher?.leaderId ?? null;
    prevPartyLeaderRef.current = currentLeaderId;
    // Only fire on non-null -> null transition.
    if (prevLeaderId === null || currentLeaderId !== null) return;
    if (!me) return;
    // If WE were the dissolving leader, that's a voluntary action —
    // skip the penalty.
    if (prevLeaderId === me) return;
    // 2026-05-14 spec ("Zginalem jako sojusznik pierwszy i kliknalem
    // powrot do miasta i nie pokazalo mi animaji smierci"): if the
    // death-overlay is already showing, the user is voluntarily
    // exiting via the death-confirmation popup — we MUST NOT apply
    // a second flee penalty + force-navigate, because that races the
    // death overlay's own navigate and the skull animation never gets
    // a chance to render. Skip the flee path entirely in that case.
    if (useDeathStore.getState().event !== null) return;
    // Only penalise active boss/raid/trainer combat. Hunt (/combat) and
    // all non-combat routes are exempt.
    const fleeRoutes = new Set<string>(['/boss', '/raid', '/trainer']);
    if (!fleeRoutes.has(location.pathname)) return;
    void (async () => {
      const [
        { applyFleePenalty },
        { useCharacterStore },
        { useSkillStore },
      ] = await Promise.all([
        import('../../../systems/levelSystem'),
        import('../../../stores/characterStore'),
        import('../../../stores/skillStore'),
      ]);
      // 2026-05-14 spec ("sojusznik dostal kare jak za ucieczke a
      // powinna smierci bo nie ucieknal"): a wipe broadcasts on TWO
      // independent channels — party_members (party row deletion)
      // and partyCombatSync (phase='wipe' raid/boss state). They
      // race. If party_members lands first, this AppShell effect
      // fires BEFORE the in-view wipe latch (wipeForcedRef ->
      // handleWipe -> triggerDeath('death')) — and a flee penalty
      // would land on top of an incoming death penalty.
      //
      // Defer by ~250 ms then re-check the death event. The in-view
      // wipe latch fires within ~16 ms of phase='wipe' landing
      // (one render + effect tick), so a quarter-second is plenty
      // of slack while still feeling instant for legitimate flee
      // scenarios (voluntary leader-leave without a wipe). If the
      // event is set after the wait, the local wipe owns this
      // transition and we silently bow out.
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      if (useDeathStore.getState().event !== null) return;
      const ch = useCharacterStore.getState().character;
      if (ch && ch.level > 1) {
        const pen = applyFleePenalty(ch.level, ch.xp);
        useCharacterStore.getState().updateCharacter({
          xp: pen.newXp,
          level: pen.newLevel,
        });
        useSkillStore.getState().applyDeathPenalty(ch.class, pen.skillXpLossPercent);
        if (pen.levelsLost > 0) {
          useSkillStore.getState().purgeLockedSkillSlots(ch.class, pen.newLevel);
        }
        // 2026-05-14 spec ("Jezeli sojusznik ucieknie z bossa lub
        // dungeona ... powinien wyskoczyc mu popup ze udalo Ci sie
        // uciec"): mirror the flee overlay that the in-view "Ucieknij"
        // button shows — when the leader dissolves the party mid-fight
        // and we're shipped home, the player still loses XP / Skill XP
        // and deserves a visible "UCIEKŁEŚ" panel with the penalty
        // numbers instead of a silent stat drop.
        if (useDeathStore.getState().event !== null) return;
        const routeName = location.pathname === '/boss'
          ? 'Boss'
          : location.pathname === '/raid'
            ? 'Rajd'
            : 'Trener';
        useDeathStore.getState().triggerDeath({
          kind: 'flee',
          killedBy: routeName,
          sourceLevel: ch.level,
          oldLevel: ch.level,
          newLevel: pen.newLevel,
          levelsLost: pen.levelsLost,
          xpPercent: pen.xpPercent,
          skillXpLossPercent: pen.skillXpLossPercent,
          protectionUsed: false,
          source: 'flee',
        });
      }
    })();
    // Bail home so the empty arena doesn't stay stuck.
    setCombatHudActive(false);
    setCombatHudCompact(false);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [partyForFleeWatcher, character?.id, location.pathname, setCombatHudActive, setCombatHudCompact]);

  // 2026-05-20 spec ("Ogarnac przelacznik do gry offline i online ... Jak
  // ktos dostanie DC to od razu na ta akcje jezeli jestes podczas walki to
  // traktuje sie to jako smierc"): global disconnect watcher.
  //
  // syncStore.isOnline already mirrors `navigator.onLine` via window
  // events. We subscribe here so we react ONCE on the falling edge
  // regardless of which view is mounted.
  //
  // Decision matrix on network drop:
  //
  //   +----------------+--------------+----------------------------------+
  //   | Route          | In party?    | Action                           |
  //   +----------------+--------------+----------------------------------+
  //   | /boss /dungeon | yes          | leave-death penalty + leave party|
  //   | /raid /trans   |              | (party combat = always death)    |
  //   | /combat        |              |                                  |
  //   +----------------+--------------+----------------------------------+
  //   | /arena         | n/a (PvP)    | leave-death penalty (always —    |
  //   | /arena/match   |              |  arena is multiplayer-only)      |
  //   +----------------+--------------+----------------------------------+
  //   | /boss /dungeon | no           | auto-flip to offline mode, KEEP  |
  //   | /combat /trans |              | combat running locally. Fully    |
  //   | /trainer       |              | solo content = client-authorit.  |
  //   +----------------+--------------+----------------------------------+
  //   | anything else  | any          | auto-flip to offline mode silent |
  //   +----------------+--------------+----------------------------------+
  //
  // Auto-flipping to offline mode is the friendly recovery path the user
  // explicitly asked for ("chyba ze da sie automatycznie wejsc do trybu
  // offline to okej ale tylko jezeli nie jestesmy w party").
  const networkUp = useSyncStore((s) => s.isOnline);
  const setNetworkUp = useConnectivityStore((s) => s.setIsNetworkUp);
  const playMode = useConnectivityStore((s) => s.mode);
  const userExplicitlyOffline = useConnectivityStore((s) => s.userExplicitlyOffline);
  const partyForDcWatcher = usePartyStore((s) => s.party);
  const wasOnlineRef = useRef(networkUp);
  useEffect(() => {
    setNetworkUp(networkUp);
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = networkUp;
    // -- Network DROP (online -> offline) -------------------------------
    if (wasOnline && !networkUp) {
      const ch = useCharacterStore.getState().character;
      if (!ch) return;
      const route = location.pathname;
      const inParty = !!partyForDcWatcher;
      const inCombat = DISCONNECT_COMBAT_ROUTES.has(route);
      const inArena = DISCONNECT_ARENA_ROUTES.has(route);
      if (useDeathStore.getState().event !== null) return;

      // 2026-05-20 spec ("zanim wejdziemy w tryb offline w pierwszej
      // milisekundzie doslownie zapisz stan samego poczatku"):
      // snapshot synchronously + flip mode in one call. The DC watcher
      // path is IMPLICIT (`explicit: false`) so the reconnect logic
      // below can auto-restore online for us.
      void import('../../../systems/connectivityTransitions').then(({ transitionToOffline }) => {
        transitionToOffline({ explicit: false });
      }).catch(() => {
        // Fallback: at least flip the mode so multiplayer entry stays
        // gated, even if the snapshot module didn't load.
        useConnectivityStore.getState().setMode('offline', { explicit: false });
      });

      const shouldDie = shouldDieOnDisconnect({ inParty, inCombat, inArena });
      if (shouldDie) {
        void (async () => {
          const { applyCombatLeaveDeath } = await import('../../../systems/combatLeavePenalty');
          const source = resolveDisconnectSource(route, inArena);
          applyCombatLeaveDeath({
            source,
            sourceName: inArena ? 'Arena (DC)' : 'Disconnect',
            sourceLevel: ch.level,
          });
          if (inParty) {
            try { await usePartyStore.getState().leaveParty(ch.id); } catch { /* fine */ }
          }
        })();
      } else if (inParty) {
        // Party + non-combat route — drop the party so teammates
        // aren't held up. No death penalty.
        void (async () => {
          try { await usePartyStore.getState().leaveParty(ch.id); } catch { /* fine */ }
        })();
      }
      return;
    }

    // -- Network RESTORE (offline -> online) ----------------------------
    // 2026-05-20 spec ("jak mnie polaczy automatycznie, to powinnismy
    // grac w trybie online ... Natomiast jezeli sam klikne myszka ze
    // chce grac offline to nawet jak wywali mi internet i polaczy
    // powinienem grac dalej offline"): on a network reconnect we
    // auto-flip back to online ONLY when the player didn't explicitly
    // choose offline.
    if (!wasOnline && networkUp && playMode === 'offline' && !userExplicitlyOffline) {
      void import('../../../systems/connectivityTransitions').then(({ transitionToOnline }) => {
        void transitionToOnline();
      }).catch(() => {
        useConnectivityStore.getState().setMode('online');
      });
    }
  }, [networkUp, partyForDcWatcher, location.pathname, playMode, userExplicitlyOffline, setNetworkUp]);

  const isCharacterless = CHARACTERLESS_ROUTES.has(location.pathname);
  const showChrome = !!character && !isCharacterless;

  // 2026-05-09: mirror `isCharacterless` into a tiny store so the
  // background combat engine (mounted at App() level, outside the
  // router) can bail when we're on login / character-select / etc.
  // Without this, a fight left in 'fighting' phase keeps ticking and
  // fires `saveCurrentCharacterStores()` (3 Supabase writes per kill)
  // every second on the character-select screen — drowning the server.
  const setIsCharacterlessRoute = useAppRouteStore((s) => s.setIsCharacterless);
  useEffect(() => {
    setIsCharacterlessRoute(isCharacterless);
  }, [isCharacterless, setIsCharacterlessRoute]);

  // 2026-05-13 spec ("Wyszedlem do widoku wyboru postaci i dalej po
  // wejsciu na postac moja postac byla w party"): when the player lands
  // on a characterless route (e.g. cleared the URL -> /character-select)
  // while still holding a party row, dissolve the party. clearCharacter
  // already does this via fire-and-forget but only fires on the auth /
  // menu paths — URL clear simply navigates without touching the store.
  // We catch all of them here by reacting to the route itself.
  useEffect(() => {
    if (!isCharacterless) return;
    const ch = useCharacterStore.getState().character;
    const pty = usePartyStore.getState().party;
    if (!ch || !pty) return;
    // 2026-05-13: the user reported repeatedly ("mowie ci to 5 raz!!!!")
    // that returning to /party from /character-select still shows the
    // old party. Root cause: leaveParty is async, the user picks the
    // character + hydrateActiveParty re-fetches from the server BEFORE
    // the delete commits. Defence in depth:
    //   1. CLEAR local party + server-membership flag IMMEDIATELY so
    //      any re-hydrate that sees a stale row still won't restore the
    //      old state until the user joins something new.
    //   2. Fire the delete to the server.
    //   3. Best-effort cleanup of orphan party_members rows so even a
    //      flaky leave still removes us from the row count.
    const partyId = pty.id;
    const charId = ch.id;
    usePartyStore.setState({ party: null });
    void (async () => {
      try {
        const { partyApi } = await import('../../../api/v1/partyApi');
        await partyApi.leaveParty(partyId, charId);
      } catch { /* ignore */ }
      try {
        const { partyApi } = await import('../../../api/v1/partyApi');
        await partyApi.deleteMyStaleMemberships(charId);
      } catch { /* ignore */ }
    })();
  }, [isCharacterless]);

  // Defensive: if a combat view forgot to clear the HUD flag on unmount, the
  // global nav would stay hidden forever. Clearing on navigation to a
  // NON-combat route gives a safe baseline.
  //
  // 2026-06-21 fix: we must SKIP this reset when navigating TO a combat-HUD
  // route. Otherwise, re-entering an active background fight (e.g. tapping a
  // monster in Town while a hunt is still running) races the combat view's own
  // CombatHudHost mount-set: the child effect sets active=true, then this parent
  // effect set active=false in the same commit and won — so the player saw the
  // normal Walka/Questy/Miasto nav instead of the spells + exit bar. Combat
  // routes now own their HUD flag entirely (CombatHudHost sets it from phase and
  // clears it on unmount), so no clobber.
  useEffect(() => {
    if (COMBAT_HUD_ROUTES.has(location.pathname)) return;
    setCombatHudActive(false);
    setCombatHudCompact(false);
  }, [location.pathname, setCombatHudActive, setCombatHudCompact]);

  // Combat HUD swap: when a combat view is in a fight, hide the global
  // BottomNav so the view's own fixed-position <CombatActionBar> sits there
  // instead. The shell still renders padding for the bottom area so combat
  // content doesn't get clipped by the action bar.
  const showBottomNav = showChrome && !combatHudActive;

  return (
    <div className={`app-shell${showChrome ? '' : ' app-shell--bare'}${combatHudActive ? ' app-shell--combat-hud' : ''}${combatHudActive && combatHudCompact ? ' app-shell--combat-hud-compact' : ''}`}>
      {showChrome && <TopHeader />}
      <main className="app-shell__main">{children}</main>
      {showBottomNav && <BottomNav />}
      {/* 2026-05-08 v3: floating party widget — visible on every
          chrome-mounted screen when the player is in a party. The
          component itself bails out when there's no party so we can
          mount it unconditionally here.
          2026-05-15 v8 spec ("Ty specjalnie pomijasz ta ikonke tarczy
          zeby mnie wkurwic w raidzie?"): also gate the mount on
          `!combatHudActive` so during ANY combat HUD the entire
          component is unmounted (not just `display:none`). Belt-
          and-braces with the route-based and CSS-based hides — at
          least one of the three must take effect even on stale dev-
          server caches. */}
      {showChrome && !combatHudActive && <PartyWidget />}
      {/* 2026-05-09: ready-check modal sits at the very top of the
          z-order so it covers any view. Component returns null when
          no check is in flight. */}
      {showChrome && <ReadyCheckModal />}
    </div>
  );
};

export default AppShell;
