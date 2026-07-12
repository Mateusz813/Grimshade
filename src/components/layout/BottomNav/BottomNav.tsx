import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTransformAccent } from '../../../hooks/useTransformAccent';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore } from '../../../stores/questStore';
import { useDailyQuestStore } from '../../../stores/dailyQuestStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import './BottomNav.scss';

const OFFLINE_LOCKED_PATHS = new Set<string>(['/social']);

interface IBottomNavItem {
  path: string;
  label: string;
  icon: ReactNode;
  matches?: string[];
  claimable?: boolean;
}

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { accent, accentRgb } = useTransformAccent();
  const playMode = useConnectivityStore((s) => s.mode);
  const isOffline = playMode === 'offline';

  const activeTasks = useTaskStore((s) => s.activeTasks);
  const activeQuests = useQuestStore((s) => s.activeQuests);
  const dailyActiveQuests = useDailyQuestStore((s) => s.activeQuests);
  const tasksClaimable = activeTasks.some((t) => t.progress >= t.killCount);
  const questsClaimable = activeQuests.some(
    (aq) => aq.goals.every((g) => (g.progress ?? 0) >= g.count),
  );
  const dailyClaimable = dailyActiveQuests.some((a) => a.completed && !a.claimed);
  const questHubClaimable = tasksClaimable || questsClaimable || dailyClaimable;

  const items: IBottomNavItem[] = [
    {
      path: '/battle',
      label: 'Walka',
      matches: ['/battle', '/combat', '/dungeon', '/boss', '/raid', '/transform', '/trainer'],
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.5 17.5 4 7V4h3l10.5 10.5" />
          <path d="m13 19 6-6" />
          <path d="m16 16 4 4" />
          <path d="m19 21 2-2" />
        </svg>
      ),
    },
    {
      path: '/quests',
      label: 'Questy',
      matches: ['/quests', '/tasks'],
      claimable: questHubClaimable,
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l3 3v13a2 2 0 0 1-2 2Z" />
          <path d="M9 7h6" />
          <path d="M9 11h6" />
          <path d="M9 15h4" />
        </svg>
      ),
    },
    {
      path: '/inventory',
      label: 'Postać',
      matches: ['/inventory'],
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
      ),
    },
    {
      path: '/',
      label: 'Miasto',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11 12 3l9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-5h4v5" />
        </svg>
      ),
    },
    {
      path: '/social',
      label: 'Społeczność',
      matches: ['/social', '/friends', '/chat', '/guild', '/party'],
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      path: '/shop',
      label: 'Sklep',
      matches: ['/shop', '/market', '/deposit'],
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 7 2 13a2 2 0 0 0 2 1.7h10A2 2 0 0 0 19 20l2-13" />
          <path d="M3 7h18" />
          <path d="M8 7V5a4 4 0 0 1 8 0v2" />
        </svg>
      ),
    },
  ];

  const isActive = (item: IBottomNavItem): boolean => {
    if (location.pathname === item.path) return true;
    if (item.matches && item.matches.includes(location.pathname)) return true;
    return false;
  };

  return (
    <nav
      className="bottom-nav"
      aria-label="Główna nawigacja"
      style={{
        '--nav-accent': accent,
        '--nav-accent-rgb': accentRgb,
      } as React.CSSProperties}
    >
      {items.map((item) => {
        const active = isActive(item);
        const locked = isOffline && OFFLINE_LOCKED_PATHS.has(item.path);
        return (
          <button
            key={item.path}
            type="button"
            className={`bottom-nav__btn${active ? ' bottom-nav__btn--active' : ''}${locked ? ' bottom-nav__btn--offline-locked' : ''}`}
            disabled={locked}
            onClick={() => {
              if (locked) return;
              if (location.pathname === item.path) {
                navigate(item.path, { state: { resetAt: Date.now() }, replace: false });
              } else {
                navigate(item.path);
              }
            }}
            aria-current={active ? 'page' : undefined}
            aria-disabled={locked || undefined}
            aria-label={locked ? `${item.label} (niedostępne w trybie offline)` : item.label}
            title={locked ? 'Niedostępne w trybie offline' : undefined}
          >
            <span className="bottom-nav__icon">
              {item.icon}
              {item.claimable && (
                <span className="bottom-nav__claim-dot" aria-hidden="true" />
              )}
            </span>
            <span className="bottom-nav__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
