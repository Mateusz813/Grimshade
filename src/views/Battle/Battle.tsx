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
  id: 'polowanie' | 'dungeon' | 'boss' | 'transform' | 'raid' | 'arena' | 'trainer';
  label: string;
  path: string;
  bg: string;
}

const Battle = () => {
  const navigate = useNavigate();
  const character = useCharacterStore((s) => s.character);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();
  const isMemberLocked = useIsPartyMemberLocked();
  const MEMBER_LOCKED_ROUTES = new Set<string>(['/boss', '/raid', '/trainer', '/combat']);
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
                if (locked) return;
                if (tile.path === '/trainer') {
                    const triggered = requestPartyCombatStart({
                        destination: '/trainer',
                        label: 'Trainer',
                        onConfirmed: () => navigate('/trainer'),
                    });
                    if (!triggered) return;
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
