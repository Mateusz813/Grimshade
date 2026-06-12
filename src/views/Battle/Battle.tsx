import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useTransformStore } from '../../stores/transformStore';
import { useConnectivityStore } from '../../stores/connectivityStore';
import { useIsPartyMemberLocked } from '../../hooks/usePartyMemberRouteGate';
import { requestPartyCombatStart } from '../../hooks/usePartyReadyCheck';
import bgPolowanie from '../../assets/images/battle/battle-polowanie.png';
import bgDungeon from '../../assets/images/battle/battle-dungeon.png';
import bgBoss from '../../assets/images/battle/battle-boss.png';
import bgTransform from '../../assets/images/battle/battle-transform.png';
import bgRaid from '../../assets/images/battle/battle-raid.png';
import bgArena from '../../assets/images/battle/battle-arena.png';
import bgTrainer from '../../assets/images/battle/battle-trainer.png';
import './Battle.scss';

/** Same per-class fallback used by Town.tsx so the accent never looks foreign. */
const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const hexToRgb = (hex: string): string => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '233, 69, 96';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
};

interface IBattleTile {
  /** Stable id used for class modifier. */
  id: 'polowanie' | 'dungeon' | 'boss' | 'transform' | 'raid' | 'arena' | 'trainer';
  /** Polish label rendered as the tile's heading at the top of the banner. */
  label: string;
  /** Route navigated to on click. */
  path: string;
  /** Bundled URL of the tile's background image (Vite hashes it for us). */
  bg: string;
}

/**
 * Battle hub. Reached from BottomNav -> Walka. Six vertically-stacked tiles
 * (one per battle mode) presented as banner-style buttons with a custom
 * background image and a border tinted by the player's current transform.
 *
 * Layout is always a single column (mobile-first). On larger screens the
 * column is centered with a comfortable max-width so the banners stay
 * readable without becoming awkwardly wide.
 *
 * Background images live in /public/images/ as battle-<id>.png and are loaded
 * lazily by the browser. If a file is missing the tile still renders with the
 * accent gradient fallback.
 */
const Battle = () => {
  const navigate = useNavigate();
  const character = useCharacterStore((s) => s.character);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();
  // 2026-05-12 spec ("nie rob redirectow, zablokuj kliki"): non-leader
  // members in a multi-human party are locked out of leader-only
  // instances (/boss, /raid, /trainer, /combat). Disabled tiles
  // silently no-op on click — no navigation, no popups.
  const isMemberLocked = useIsPartyMemberLocked();
  const MEMBER_LOCKED_ROUTES = new Set<string>(['/boss', '/raid', '/trainer', '/combat']);
  // 2026-05-20 spec ("wyszarz, spolecznosc, arene, raidy"): Arena + Raid
  // are multiplayer-only — when the player is in offline mode the tiles
  // grey out and become unclickable. Same visual treatment the Town
  // tiles use so the gating reads consistently across the chrome.
  const playMode = useConnectivityStore((s) => s.mode);
  const isOffline = playMode === 'offline';
  const OFFLINE_LOCKED_PATHS = new Set<string>(['/raid', '/arena']);

  const classColorFallback = character ? (CLASS_COLORS[character.class] ?? '#e94560') : '#e94560';
  const tileAccent = (() => {
    if (!transformColor) return classColorFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classColorFallback;
  })();
  const tileAccentRgb = hexToRgb(tileAccent);

  const tiles: IBattleTile[] = [
    { id: 'polowanie', label: 'Polowanie',     path: '/combat',    bg: bgPolowanie },
    { id: 'dungeon',   label: 'Dungeon',       path: '/dungeon',   bg: bgDungeon },
    { id: 'boss',      label: 'Boss',          path: '/boss',      bg: bgBoss },
    { id: 'transform', label: 'Transformacja', path: '/transform', bg: bgTransform },
    { id: 'raid',      label: 'Raid',          path: '/raid',      bg: bgRaid },
    { id: 'arena',     label: 'Arena',         path: '/arena',     bg: bgArena },
    { id: 'trainer',   label: 'Trainer',       path: '/trainer',   bg: bgTrainer },
  ];

  return (
    <div
      className="battle"
      style={{
        '--tile-accent': tileAccent,
        '--tile-accent-rgb': tileAccentRgb,
      } as React.CSSProperties}
    >
      <div className="battle__inner">
        {tiles.map((tile) => {
          const memberLocked = isMemberLocked && MEMBER_LOCKED_ROUTES.has(tile.path);
          const offlineLocked = isOffline && OFFLINE_LOCKED_PATHS.has(tile.path);
          const locked = memberLocked || offlineLocked;
          return (
            <button
              key={tile.id}
              type="button"
              className={`battle__tile battle__tile--${tile.id}${locked ? ' battle__tile--locked' : ''}${offlineLocked ? ' battle__tile--offline-locked' : ''}`}
              onClick={() => {
                if (locked) return; // silent no-op for party members / offline players
                // 2026-05-15 spec ("Brakuje popupu do przyzywania na
                // trainery jak lider wchodzi do trainera"): when the
                // leader clicks Trainer in a multi-human party, fire
                // the ready-check so every member gets the same
                // "Gotowy?" popup boss/raid use. Solo players (or
                // bots-only) navigate directly via the
                // onConfirmed callback — `requestPartyCombatStart`
                // handles both paths.
                if (tile.path === '/trainer') {
                    const triggered = requestPartyCombatStart({
                        destination: '/trainer',
                        label: 'Trainer',
                        onConfirmed: () => navigate('/trainer'),
                    });
                    if (!triggered) return; // non-leader fallback (shouldn't hit, locked above)
                    return;
                }
                navigate(tile.path);
              }}
              aria-label={tile.label}
              aria-disabled={locked || undefined}
              title={
                offlineLocked
                  ? 'Niedostępne w trybie offline'
                  : memberLocked
                    ? 'Tylko lider party może rozpocząć tę walkę'
                    : undefined
              }
              style={locked && !offlineLocked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              <span
                className="battle__tile-bg"
                aria-hidden="true"
                style={{ backgroundImage: `url(${tile.bg})` }}
              />
              <span className="battle__tile-shade" aria-hidden="true" />
              <span className="battle__tile-title">{tile.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Battle;
