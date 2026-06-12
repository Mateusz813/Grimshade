import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useCharacterStore } from '../../../stores/characterStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useSyncStore } from '../../../stores/syncStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useSync } from '../../../hooks/useSync';
import { saveCurrentCharacterStores } from '../../../stores/characterScope';
import { formatLastSynced } from '../../../systems/syncSystem';
import AdminPanel, { isAdminEmail } from '../../ui/AdminPanel/AdminPanel';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import Icon from '../../atoms/Icon/Icon';
import { APP_VERSION } from '../../../lib/appVersion';
import './AvatarMenu.scss';

interface IAvatarMenuProps {
  /** The button this popup is anchored to – used so outside-click ignores its own opener. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Closes the popup. */
  onClose: () => void;
  /** Opens the change-password modal. The modal is rendered by the PARENT
   *  (TopHeader) so it survives this menu closing on click. */
  onChangePassword: () => void;
  /** Opens the tutorial modal (also rendered by the parent). */
  onOpenTutorial: () => void;
}

/**
 * Avatar dropdown anchored to the avatar button in TopHeader.
 *
 * Contents (in order):
 *  - Zmień postać   -> saves stores, clears character, navigates to /character-select
 *  - Język          -> inline PL / EN toggle (no extra navigation)
 *  - Synchronizuj   -> triggers manual cloud sync; shows last-synced timestamp
 *  - Wyloguj        -> saves stores, signs out of supabase, navigates to /login
 *
 * Closes on outside click and on Escape.
 */
const AvatarMenu = ({ anchorRef, onClose, onChangePassword, onOpenTutorial }: IAvatarMenuProps) => {
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastSynced = useSyncStore((s) => s.lastSynced);
  const { doSync } = useSync();

  // 2026-05-21 spec: admin panel is gated on the player's Supabase
  // session email. We pull the email once on mount + cache locally so
  // the menu render isn't async. `null` means "still loading / not
  // signed in"; only an exact match opens the door.
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const email = data.session?.user?.email?.toLowerCase() ?? null;
      setIsAdmin(isAdminEmail(email));
    });
    return () => { cancelled = true; };
  }, []);

  // 2026-05-20 spec: play-mode toggle. The toggle is the player's
  // explicit choice — separate from `isOnline` which mirrors the OS-
  // level network state.
  //
  //   - Switching -> offline: drop any active party first (teammates
  //     keep playing), then call `transitionToOffline({ explicit })`
  //     which snapshots the trusted baseline IMMEDIATELY before
  //     flipping the mode.
  //
  //   - Switching -> online: call `transitionToOnline()` which forces a
  //     full sync (Supabase + game_saves) so the canonical row matches
  //     what the player did while offline. The sync prevents the
  //     "double XP / duplicated items" scenario the spec calls out.
  const playMode = useConnectivityStore((s) => s.mode);
  const togglePlayMode = async () => {
    const next = playMode === 'online' ? 'offline' : 'online';
    if (next === 'offline') {
      const ch = useCharacterStore.getState().character;
      const pty = usePartyStore.getState().party;
      if (ch && pty) {
        try {
          await usePartyStore.getState().leaveParty(ch.id);
        } catch { /* best effort */ }
      }
      const { transitionToOffline } = await import(
        '../../../systems/connectivityTransitions'
      );
      transitionToOffline({ explicit: true });
    } else {
      const { transitionToOnline } = await import(
        '../../../systems/connectivityTransitions'
      );
      await transitionToOnline();
    }
  };

  // Close on outside click (ignore clicks inside the popup or on the anchor)
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      // 2026-05-21 fix: the admin panel renders via React portal to
      // document.body so it lives OUTSIDE this menu's DOM subtree. Without
      // this guard, every click inside the admin panel triggers the
      // outside-click handler -> closes the menu -> unmounts the panel
      // before the user's button click can register. Match by the
      // backdrop class so we catch clicks on every panel surface.
      const el = target instanceof Element ? target : (target as Node).parentElement;
      if (el && el.closest('.admin-panel__backdrop')) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 2026-05-21 fix: same idea for the keyboard handler — when the
      // admin panel is open, ESC should close the panel only. We
      // detect this by querying for the panel's backdrop in the DOM.
      if (document.querySelector('.admin-panel__backdrop')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, onClose]);

  const handleChangeChar = async () => {
    onClose();
    // 2026-05-13 spec ("Kiedy wychodze do wyboru postaci to moje party
    // ktore mialem powinno zostac zlikwidowane"): leave the active
    // party before switching characters so the leftover row doesn't
    // dangle in Supabase + the other members get a proper
    // `party_members` removal event. We swallow errors so a flaky
    // network can't strand the player on the current character.
    try {
      const { usePartyStore } = await import('../../../stores/partyStore');
      const ch = useCharacterStore.getState().character;
      if (ch && usePartyStore.getState().party) {
        await usePartyStore.getState().leaveParty(ch.id);
      }
    } catch { /* best effort — char-switch must still proceed */ }
    await saveCurrentCharacterStores();
    useCharacterStore.getState().clearCharacter();
    navigate('/character-select');
  };

  const handleSync = () => {
    if (!isOnline || isSyncing) return;
    void doSync();
  };

  const handleLogout = async () => {
    onClose();
    await saveCurrentCharacterStores();
    await supabase.auth.signOut();
    useCharacterStore.getState().clearCharacter();
    navigate('/login');
  };

  return (
    <div className="avatar-menu" ref={popoverRef} role="menu">
      <button
        type="button"
        className="avatar-menu__item"
        onClick={() => void handleChangeChar()}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon"><GameIcon name="bust-in-silhouette" /></span>
        <span className="avatar-menu__item-label">Zmień postać</span>
      </button>

      <div className="avatar-menu__item avatar-menu__item--row">
        <span className="avatar-menu__item-icon"><GameIcon name="globe-with-meridians" /></span>
        <span className="avatar-menu__item-label">Język</span>
        <div className="avatar-menu__lang-toggle">
          <button
            type="button"
            className={`avatar-menu__lang-btn${language === 'pl' ? ' avatar-menu__lang-btn--active' : ''}`}
            onClick={() => setLanguage('pl')}
          >
            PL
          </button>
          <button
            type="button"
            className={`avatar-menu__lang-btn${language === 'en' ? ' avatar-menu__lang-btn--active' : ''}`}
            onClick={() => setLanguage('en')}
          >
            EN
          </button>
        </div>
      </div>

      {/* 2026-05-20 spec: play-mode toggle. Online = full feature set,
          Offline = solo only (no party, raids, arena, bots, ladder). */}
      <div className="avatar-menu__item avatar-menu__item--row">
        <span className="avatar-menu__item-icon">
          {playMode === 'online' ? <GameIcon name="green-circle" /> : <GameIcon name="red-circle" />}
        </span>
        <span className="avatar-menu__item-label">Tryb gry</span>
        <div className="avatar-menu__lang-toggle">
          <button
            type="button"
            className={`avatar-menu__lang-btn${playMode === 'online' ? ' avatar-menu__lang-btn--active' : ''}`}
            onClick={() => void (playMode === 'offline' ? togglePlayMode() : null)}
            title="Pełna gra: party, rajdy, arena, boty"
          >
            Online
          </button>
          <button
            type="button"
            className={`avatar-menu__lang-btn${playMode === 'offline' ? ' avatar-menu__lang-btn--active' : ''}`}
            onClick={() => void (playMode === 'online' ? togglePlayMode() : null)}
            title="Tylko solo: polowanie, bossy, lochy, transformy, taski, questy, trener"
          >
            Offline
          </button>
        </div>
      </div>

      <button
        type="button"
        className={`avatar-menu__item${!isOnline || isSyncing ? ' avatar-menu__item--disabled' : ''}`}
        onClick={handleSync}
        disabled={!isOnline || isSyncing}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon">{isSyncing ? <Icon name="refresh" className="ui-icon--spin" /> : <GameIcon name="cloud" />}</span>
        <span className="avatar-menu__item-label">
          {isSyncing ? 'Synchronizuje…' : 'Synchronizuj'}
        </span>
        <span className="avatar-menu__item-meta">
          {isOnline ? formatLastSynced(lastSynced) : 'Offline'}
        </span>
      </button>

      {/* 2026-05-21 spec: admin panel entry — rendered ONLY for the
          allow-listed account email. Every other player never sees
          this DOM node. */}
      {isAdmin && (
        <button
          type="button"
          className="avatar-menu__item avatar-menu__item--admin"
          onClick={() => setAdminOpen(true)}
          role="menuitem"
        >
          <span className="avatar-menu__item-icon"><GameIcon name="hammer-and-wrench" /></span>
          <span className="avatar-menu__item-label">Panel admina</span>
        </button>
      )}

      <button
        type="button"
        className="avatar-menu__item"
        onClick={onChangePassword}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon"><GameIcon name="key" /></span>
        <span className="avatar-menu__item-label">Zmień hasło</span>
      </button>

      <button
        type="button"
        className="avatar-menu__item"
        onClick={onOpenTutorial}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon"><GameIcon name="open-book" /></span>
        <span className="avatar-menu__item-label">Tutorial</span>
      </button>

      <button
        type="button"
        className="avatar-menu__item avatar-menu__item--danger"
        onClick={() => void handleLogout()}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon"><GameIcon name="door" /></span>
        <span className="avatar-menu__item-label">Wyloguj</span>
      </button>

      {/* 2026-05-21 spec: version stripe under the logout button. Single
          source of truth = package.json so a `npm version`/manual bump
          is reflected here on the next build with zero glue. */}
      <div className="avatar-menu__version" aria-label={`Grimshade v${APP_VERSION}`}>
        v{APP_VERSION}
      </div>

      {isAdmin && adminOpen && (
        <AdminPanel onClose={() => setAdminOpen(false)} />
      )}
    </div>
  );
};

export default AvatarMenu;
