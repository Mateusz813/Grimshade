import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatHudStore } from '../../../stores/combatHudStore';
import { useAppRouteStore } from '../../../stores/appRouteStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useGuildStore } from '../../../stores/guildStore';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
import { isBackendMode } from '../../../config/backendMode';
import {
  shouldDieOnDisconnect,
  resolveDisconnectSource,
  DISCONNECT_COMBAT_ROUTES,
  DISCONNECT_ARENA_ROUTES,
} from '../../../systems/disconnectPolicy';
import { useDeathStore } from '../../../stores/deathStore';
import { consumeDeathProtection } from '../../../systems/deathProtection';
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

const CHARACTERLESS_ROUTES = new Set<string>([
  '/login',
  '/register',
  '/forgot-password',
  '/character-select',
  '/create-character',
  '/wiki',
]);

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

  usePartyPresence();
  usePartyReadyCheck();
  useReadyCheckGoEffect();
  usePartyCombatSync();

  const activePartyId = usePartyStore((s) => s.party?.id);
  const subscribeToActiveParty = usePartyStore((s) => s.subscribeToActiveParty);
  useEffect(() => {
    if (!activePartyId) return;
    const unsub = subscribeToActiveParty();
    return unsub;
  }, [activePartyId, subscribeToActiveParty]);

  const activeGuildId = useGuildStore((s) => s.guild?.id ?? null);
  useEffect(() => {
    useChatTabsStore.getState().syncPartyTab(activePartyId ?? null);
  }, [activePartyId]);
  useEffect(() => {
    useChatTabsStore.getState().syncGuildTab(activeGuildId);
  }, [activeGuildId]);

  useEffect(() => {
    if (!character?.id) {
      void import('../../../stores/guildStore').then(({ useGuildStore }) => {
        useGuildStore.getState().clear();
      }).catch(() => { });
      return;
    }
    const id = character.id;
    void import('../../../stores/guildStore').then(({ useGuildStore }) => {
      void useGuildStore.getState().hydrateForCharacter(id);
    }).catch(() => { });
  }, [character?.id]);

  const prevPartyLeaderRef = useRef<string | null>(null);
  const partyForFleeWatcher = usePartyStore((s) => s.party);
  useEffect(() => {
    const me = character?.id;
    const prevLeaderId = prevPartyLeaderRef.current;
    const currentLeaderId = partyForFleeWatcher?.leaderId ?? null;
    prevPartyLeaderRef.current = currentLeaderId;
    if (prevLeaderId === null || currentLeaderId !== null) return;
    if (!me) return;
    if (prevLeaderId === me) return;
    if (useDeathStore.getState().event !== null) return;
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
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      if (useDeathStore.getState().event !== null) return;
      const ch = useCharacterStore.getState().character;
      if (ch && ch.level > 1) {
        const routeName = location.pathname === '/boss'
          ? 'Boss'
          : location.pathname === '/raid'
            ? 'Rajd'
            : 'Trener';
        const prot = consumeDeathProtection();
        if (prot.isProtected) {
          if (useDeathStore.getState().event !== null) return;
          const protectionLabel = prot.consumedId === 'death_protection'
            ? 'Eliksir Ochrony'
            : 'Amulet of Loss';
          console.info(`[protection] ${protectionLabel} saved everything on flee from ${routeName}.`);
          useDeathStore.getState().triggerDeath({
            kind: 'flee',
            killedBy: routeName,
            sourceLevel: ch.level,
            oldLevel: ch.level,
            newLevel: ch.level,
            levelsLost: 0,
            xpPercent: 100,
            skillXpLossPercent: 0,
            protectionUsed: true,
            source: 'flee',
          });
        } else {
          const pen = applyFleePenalty(ch.level, ch.xp);
          useCharacterStore.getState().updateCharacter({
            xp: pen.newXp,
            level: pen.newLevel,
          });
          useSkillStore.getState().applyDeathPenalty(ch.class, pen.skillXpLossPercent);
          if (pen.levelsLost > 0) {
            useSkillStore.getState().purgeLockedSkillSlots(ch.class, pen.newLevel);
          }
          if (useDeathStore.getState().event !== null) return;
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
      }
    })();
    setCombatHudActive(false);
    setCombatHudCompact(false);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [partyForFleeWatcher, character?.id, location.pathname, setCombatHudActive, setCombatHudCompact]);

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
    if (wasOnline && !networkUp) {
      const ch = useCharacterStore.getState().character;
      if (!ch) return;
      const route = location.pathname;
      const inParty = !!partyForDcWatcher;
      const inCombat = DISCONNECT_COMBAT_ROUTES.has(route);
      const inArena = DISCONNECT_ARENA_ROUTES.has(route);
      if (useDeathStore.getState().event !== null) return;

      void import('../../../systems/connectivityTransitions').then(({ transitionToOffline }) => {
        transitionToOffline({ explicit: false });
      }).catch(() => {
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
            try { await usePartyStore.getState().leaveParty(ch.id); } catch { }
          }
        })();
      } else if (inParty) {
        void (async () => {
          try { await usePartyStore.getState().leaveParty(ch.id); } catch { }
        })();
      }
      return;
    }

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

  const setIsCharacterlessRoute = useAppRouteStore((s) => s.setIsCharacterless);
  useEffect(() => {
    setIsCharacterlessRoute(isCharacterless);
  }, [isCharacterless, setIsCharacterlessRoute]);

  useEffect(() => {
    if (!isCharacterless) return;
    const ch = useCharacterStore.getState().character;
    const pty = usePartyStore.getState().party;
    if (!ch || !pty) return;
    const partyId = pty.id;
    const charId = ch.id;
    usePartyStore.setState({ party: null });
    void (async () => {
      if (isBackendMode()) {
        try {
          const { backendApi } = await import('../../../api/backend/backendApi');
          await backendApi.leaveParty(charId, partyId);
        } catch { }
        return;
      }
      try {
        const { partyApi } = await import('../../../api/v1/partyApi');
        await partyApi.leaveParty(partyId, charId);
      } catch { }
      try {
        const { partyApi } = await import('../../../api/v1/partyApi');
        await partyApi.deleteMyStaleMemberships(charId);
      } catch { }
    })();
  }, [isCharacterless]);

  useEffect(() => {
    if (COMBAT_HUD_ROUTES.has(location.pathname)) return;
    setCombatHudActive(false);
    setCombatHudCompact(false);
  }, [location.pathname, setCombatHudActive, setCombatHudCompact]);

  const showBottomNav = showChrome && !combatHudActive;

  return (
    <div className={`app-shell${showChrome ? '' : ' app-shell--bare'}${combatHudActive ? ' app-shell--combat-hud' : ''}${combatHudActive && combatHudCompact ? ' app-shell--combat-hud-compact' : ''}`}>
      {showChrome && <TopHeader />}
      <main className="app-shell__main">{children}</main>
      {showBottomNav && <BottomNav />}
      {showChrome && !combatHudActive && <PartyWidget />}
      {showChrome && <ReadyCheckModal />}
    </div>
  );
};

export default AppShell;
