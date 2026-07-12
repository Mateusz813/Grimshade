import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useTransformStore } from '../../stores/transformStore';
import bgParty from '../../assets/images/spolecznosc/spolecznosc-party.png';
import bgGildia from '../../assets/images/spolecznosc/spolecznosc-gildia.png';
import bgZnajomi from '../../assets/images/spolecznosc/spolecznosc-znajomi.png';
import bgCzat from '../../assets/images/spolecznosc/spolecznosc-czat.png';
import './Social.scss';


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

interface ISocialTile {
  id: 'party' | 'gildia' | 'znajomi' | 'czat';
  label: string;
  path: string;
  bg: string;
}

const Social = () => {
  const navigate = useNavigate();
  const character = useCharacterStore((s) => s.character);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();

  const classColorFallback = character ? (CLASS_COLORS[character.class] ?? '#e94560') : '#e94560';
  const tileAccent = (() => {
    if (!transformColor) return classColorFallback;
    if (transformColor.solid) return transformColor.solid;
    if (transformColor.gradient) return transformColor.gradient[0];
    return classColorFallback;
  })();
  const tileAccentRgb = hexToRgb(tileAccent);

  const tiles: ISocialTile[] = [
    { id: 'party',   label: 'Party',   path: '/party',   bg: bgParty },
    { id: 'gildia',  label: 'Gildia',  path: '/guild',   bg: bgGildia },
    { id: 'znajomi', label: 'Znajomi', path: '/friends', bg: bgZnajomi },
    { id: 'czat',    label: 'Czat',    path: '/chat',    bg: bgCzat },
  ];

  return (
    <div
      className="social"
      style={{
        '--tile-accent': tileAccent,
        '--tile-accent-rgb': tileAccentRgb,
      } as React.CSSProperties}
    >
      <div className="social__inner">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`social__tile social__tile--${tile.id}`}
            onClick={() => navigate(tile.path)}
            aria-label={tile.label}
          >
            <span
              className="social__tile-bg"
              aria-hidden="true"
              style={{ backgroundImage: `url(${tile.bg})` }}
            />
            <span className="social__tile-shade" aria-hidden="true" />
            <span className="social__tile-title">{tile.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Social;
