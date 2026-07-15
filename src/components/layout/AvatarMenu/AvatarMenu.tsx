import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useCharacterStore } from '../../../stores/characterStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useSyncStore } from '../../../stores/syncStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useSync } from '../../../hooks/useSync';
import { saveCurrentCharacterStoresForce } from '../../../stores/characterScope';
import { formatLastSynced } from '../../../systems/syncSystem';
import AdminPanel, { isAdminEmail } from '../../ui/AdminPanel/AdminPanel';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import Icon from '../../atoms/Icon/Icon';
import { APP_VERSION } from '../../../lib/appVersion';
import './AvatarMenu.scss';

interface IAvatarMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onChangePassword: () => void;
}

const AvatarMenu = ({ anchorRef, onClose, onChangePassword }: IAvatarMenuProps) => {
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const keepScreenAwake = useSettingsStore((s) => s.keepScreenAwake);
  const setKeepScreenAwake = useSettingsStore((s) => s.setKeepScreenAwake);
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastSynced = useSyncStore((s) => s.lastSynced);
  const { doSync } = useSync();

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

  const playMode = useConnectivityStore((s) => s.mode);
  const togglePlayMode = async () => {
    const next = playMode === 'online' ? 'offline' : 'online';
    if (next === 'offline') {
      const ch = useCharacterStore.getState().character;
      const pty = usePartyStore.getState().party;
      if (ch && pty) {
        try {
          await usePartyStore.getState().leaveParty(ch.id);
        } catch { }
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

  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
      const el = target instanceof Element ? target : (target as Node).parentElement;
      if (el && el.closest('.admin-panel__backdrop')) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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
    try {
      const { usePartyStore } = await import('../../../stores/partyStore');
      const ch = useCharacterStore.getState().character;
      if (ch && usePartyStore.getState().party) {
        await usePartyStore.getState().leaveParty(ch.id);
      }
    } catch { }
    await saveCurrentCharacterStoresForce();
    useCharacterStore.getState().clearCharacter();
    navigate('/character-select');
  };

  const handleSync = () => {
    if (!isOnline || isSyncing) return;
    void doSync();
  };

  const handleLogout = async () => {
    onClose();
    await saveCurrentCharacterStoresForce();
    await supabase.auth.signOut();
    useCharacterStore.getState().clearCharacter();
    navigate('/login');
  };

  const handleOpenWiki = () => {
    onClose();
    window.open('/wiki', '_blank', 'noopener,noreferrer');
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

      <div className="avatar-menu__item avatar-menu__item--row">
        <span className="avatar-menu__item-icon"><GameIcon name="sun" /></span>
        <span className="avatar-menu__item-label">Nie wygaszaj ekranu</span>
        <div className="avatar-menu__lang-toggle">
          <button
            type="button"
            className={`avatar-menu__lang-btn${keepScreenAwake ? ' avatar-menu__lang-btn--active' : ''}`}
            onClick={() => setKeepScreenAwake(true)}
            title="Ekran nie gaśnie podczas gry (zużywa więcej baterii)"
          >
            Wł
          </button>
          <button
            type="button"
            className={`avatar-menu__lang-btn${!keepScreenAwake ? ' avatar-menu__lang-btn--active' : ''}`}
            onClick={() => setKeepScreenAwake(false)}
            title="Ekran gaśnie normalnie (oszczędza baterię)"
          >
            Wył
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
        onClick={handleOpenWiki}
        role="menuitem"
      >
        <span className="avatar-menu__item-icon"><GameIcon name="open-book" /></span>
        <span className="avatar-menu__item-label">Wiki</span>
        <span className="avatar-menu__item-meta">nowa karta</span>
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
