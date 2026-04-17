import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useCharacterStore } from '../../stores/characterStore';
import { characterApi, type ICharacter } from '../../api/v1/characterApi';
import { switchToCharacter, deleteCharacterData, saveCurrentCharacterStores, peekCharacterStore } from '../../stores/characterScope';
import { getTotalEquipmentStats, flattenItemsData, EMPTY_EQUIPMENT, type EquipmentSlot, type IInventoryItem } from '../../systems/itemSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import itemsRaw from '../../data/items.json';
import { getCharacterAvatar } from '../../data/classAvatars';
import { getTransformColor } from '../../systems/transformSystem';
import './CharacterSelect.scss';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

/**
 * Peek a character's completed transforms list from localStorage without
 * switching active character. Used to render the correct transform avatar on
 * the character list.
 */
const getPeekedCompletedTransforms = (charId: string): number[] => {
  const t = peekCharacterStore(charId, 'transforms');
  const list = t?.completedTransforms as unknown;
  if (Array.isArray(list)) return list.filter((x): x is number => typeof x === 'number');
  return [];
};

/**
 * Read a character's saved equipment + training bonuses from localStorage
 * (without switching active character) and return effective max HP/MP.
 */
const getEffectiveMaxStats = (charId: string, baseMaxHp: number, baseMaxMp: number, charClass?: string): { maxHp: number; maxMp: number } => {
  const inv = peekCharacterStore(charId, 'inventory');
  const skills = peekCharacterStore(charId, 'skills');

  const equipment = (inv?.equipment as Record<EquipmentSlot, IInventoryItem | null> | undefined) ?? { ...EMPTY_EQUIPMENT };
  const skillLevels = (skills?.skillLevels as Record<string, number> | undefined) ?? {};

  let eqHp = 0;
  let eqMp = 0;
  try {
    const s = getTotalEquipmentStats(equipment, ALL_ITEMS);
    eqHp = s.hp ?? 0;
    eqMp = s.mp ?? 0;
  } catch {
    /* ignore */
  }

  const tb = getTrainingBonuses(skillLevels, charClass);
  return {
    maxHp: baseMaxHp + eqHp + (tb.max_hp ?? 0),
    maxMp: baseMaxMp + eqMp + (tb.max_mp ?? 0),
  };
};

const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const hexToRgb = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

/**
 * Derive the accent color for a character card. Characters who have completed
 * at least one transform tier get the transform color (solid color or first
 * gradient stop) instead of the class color — same rule as Town / Stats /
 * Inventory / Skills so the UI stays coherent.
 */
const getCardAccent = (charId: string, charClass: string): { color: string; rgb: string; tier: number } => {
  const fallback = CLASS_COLORS[charClass] ?? '#e94560';
  const completed = getPeekedCompletedTransforms(charId);
  if (completed.length === 0) {
    return { color: fallback, rgb: hexToRgb(fallback), tier: 0 };
  }
  const highest = Math.max(...completed);
  const tc = getTransformColor(highest);
  const color = tc.solid ?? (tc.gradient ? tc.gradient[0] : fallback);
  return { color, rgb: hexToRgb(color), tier: completed.length };
};

const CharacterSelect = () => {
  const navigate = useNavigate();
  const setCharacter = useCharacterStore((s) => s.setCharacter);

  const [characters, setCharacters] = useState<ICharacter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        navigate('/login');
        return;
      }
      try {
        // CRITICAL: Save current character data to Supabase BEFORE loading the list
        // This ensures level/XP/stats are up-to-date in the database
        await saveCurrentCharacterStores();

        const chars = await characterApi.getCharacters(session.session.user.id);
        setCharacters(chars ?? []);
      } catch {
        setError('Nie można załadować postaci.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [navigate]);

  const [isSelecting, setIsSelecting] = useState(false);

  const handleSelect = async (char: ICharacter) => {
    setIsSelecting(true);
    try {
      await switchToCharacter(char.id);

      // CRITICAL: Fetch fresh character data from Supabase after switching
      // The `char` object from the list may be stale (old level/XP)
      const { data: session } = await supabase.auth.getSession();
      if (session.session) {
        const freshChars = await characterApi.getCharacters(session.session.user.id);
        const freshChar = freshChars.find((c) => c.id === char.id);
        setCharacter(freshChar ?? char);
      } else {
        setCharacter(char);
      }

      navigate('/');
    } catch {
      setError('Nie można załadować danych postaci.');
    } finally {
      setIsSelecting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await characterApi.deleteCharacter(id);
      await deleteCharacterData(id);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError('Nie można usunąć postaci.');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="char-select">
        <p className="char-select__loading">Ładowanie postaci…</p>
      </div>
    );
  }

  return (
    <div className="char-select">
      <header className="char-select__header">
        <h1 className="char-select__title">⚔️ Grimshade</h1>
        <p className="char-select__subtitle">Wybierz postać</p>
      </header>

      {error && <p className="char-select__error">{error}</p>}

      <div className="char-select__list">
        {characters.map((char) => {
          const eff = getEffectiveMaxStats(char.id, char.max_hp, char.max_mp, char.class);
          const effMaxHp = eff.maxHp;
          const effMaxMp = eff.maxMp;
          const hpPct = effMaxHp > 0 ? Math.min(100, (char.hp / effMaxHp) * 100) : 0;
          const mpPct = effMaxMp > 0 ? Math.min(100, (char.mp / effMaxMp) * 100) : 0;
          const isConfirming = confirmDeleteId === char.id;

          const accent = getCardAccent(char.id, char.class);
          return (
            <div
              key={char.id}
              className="char-select__card"
              style={{
                '--class-color': accent.color,
                '--class-color-rgb': accent.rgb,
              } as React.CSSProperties}
            >
              <div className="char-select__card-left">
                <div className="char-select__avatar">
                  <img src={getCharacterAvatar(char.class, getPeekedCompletedTransforms(char.id))} alt={char.class} className="char-select__avatar-img" />
                </div>
              </div>

              <div className="char-select__card-info">
                <div className="char-select__card-name">{char.name}</div>
                <div className="char-select__card-meta">
                  {char.class} · Poziom {char.level}
                </div>

                <div className="char-select__bars">
                  <div className="char-select__bar-wrap">
                    <span className="char-select__bar-label">HP</span>
                    <div className="char-select__bar char-select__bar--hp">
                      <div className="char-select__bar-fill" style={{ width: `${hpPct}%` }} />
                    </div>
                    <span className="char-select__bar-value">{char.hp}/{effMaxHp}</span>
                  </div>
                  <div className="char-select__bar-wrap">
                    <span className="char-select__bar-label">MP</span>
                    <div className="char-select__bar char-select__bar--mp">
                      <div className="char-select__bar-fill" style={{ width: `${mpPct}%` }} />
                    </div>
                    <span className="char-select__bar-value">{char.mp}/{effMaxMp}</span>
                  </div>
                </div>
              </div>

              <div className="char-select__card-actions">
                <button
                  className="char-select__select-btn"
                  onClick={() => void handleSelect(char)}
                  disabled={isSelecting}
                >
                  {isSelecting ? 'Ładowanie…' : 'Wybierz'}
                </button>

                {isConfirming ? (
                  <div className="char-select__confirm-wrap">
                    <span className="char-select__confirm-label">Na pewno?</span>
                    <button
                      className="char-select__delete-confirm-btn"
                      onClick={() => void handleDelete(char.id)}
                      disabled={deletingId === char.id}
                    >
                      {deletingId === char.id ? '…' : 'Usuń'}
                    </button>
                    <button
                      className="char-select__cancel-btn"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <button
                    className="char-select__delete-btn"
                    onClick={() => setConfirmDeleteId(char.id)}
                    title="Usuń postać"
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {characters.length === 0 && (
          <p className="char-select__empty">Nie masz jeszcze żadnych postaci.</p>
        )}
      </div>

      {characters.length < 7 && (
        <button
          className="char-select__create-btn"
          onClick={() => navigate('/create-character')}
        >
          + Stwórz nową postać ({characters.length}/7)
        </button>
      )}

      <button
        className="char-select__logout-btn"
        onClick={async () => {
          await saveCurrentCharacterStores();
          await supabase.auth.signOut();
          navigate('/login');
        }}
      >
        Wyloguj
      </button>
    </div>
  );
};

export default CharacterSelect;
