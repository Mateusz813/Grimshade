import { useEffect, useRef, type RefObject } from 'react';
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
import './AvatarMenu.scss';

interface IAvatarMenuProps {
  /** The button this popup is anchored to – used so outside-click ignores its own opener. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Closes the popup. */
  onClose: () => void;
}

/**
 * Avatar dropdown anchored to the avatar button in TopHeader.
 *
 * Contents (in order):
 *  - Zmień postać   → saves stores, clears character, navigates to /character-select
 *  - Język          → inline PL / EN toggle (no extra navigation)
 *  - Synchronizuj   → triggers manual cloud sync; shows last-synced timestamp
 *  - Wyloguj        → saves stores, signs out of supabase, navigates to /login
 *
 * Closes on outside click and on Escape.
 */
const AvatarMenu = ({ anchorRef, onClose }: IAvatarMenuProps) => {
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastSynced = useSyncStore((s) => s.lastSynced);
  const { doSync } = useSync();

  // 2026-05-20 spec: play-mode toggle. The toggle is the player's
  // explicit choice — separate from `isOnline` which mirrors the OS-
  // level network state.
  //
  //   • Switching → offline: drop any active party first (teammates
  //     keep playing), then call `transitionToOffline({ explicit })`
  //     which snapshots the trusted baseline IMMEDIATELY before
  //     flipping the mode.
  //
  //   • Switching → online: call `transitionToOnline()` which forces a
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
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
        <span className="avatar-menu__item-icon">👤</span>
        <span className="avatar-menu__item-label">Zmień postać</span>
      </button>

      <div className="avatar-menu__item avatar-menu__item--row">
        <span className="avatar-menu__item-icon">🌐</span>
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
          {playMode === 'online' ? '🟢' : '🔴'}
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
        <span className="avatar-menu__item-icon">{isSyncing ? '⟳' : '☁️'}</span>
        <span className="avatar-menu__item-label">
          {isSyncing ? 'Synchronizuje…' : 'Synchronizuj'}
        </span>
        <span className="avatar-menu__item-meta">
          {isOnline ? formatLastSynced(lastSynced) : 'Offline'}
        </span>
      </button>

      <button
        type="button"
        className="avatar-menu__item avatar-menu__item--danger"
        onClick={() => void handleLogout()}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon">🚪</span>
        <span className="avatar-menu__item-label">Wyloguj</span>
      </button>
    </div>
  );
};

export default AvatarMenu;
