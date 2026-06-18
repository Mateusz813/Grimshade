import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useCharacterStore } from '../../stores/characterStore';
import { characterApi, type ICharacter } from '../../api/v1/characterApi';
import { authApi } from '../../api/v1/authApi';
import { switchToCharacter, deleteCharacterData, saveCurrentCharacterStores, peekCharacterStore } from '../../stores/characterScope';
import { getTotalEquipmentStats, flattenItemsData, EMPTY_EQUIPMENT, type EquipmentSlot, type IInventoryItem } from '../../systems/itemSystem';
import { getTrainingBonuses } from '../../systems/skillSystem';
import itemsRaw from '../../data/items.json';
import { getCharacterAvatar } from '../../data/classAvatars';
import Spinner from '../../components/ui/Spinner/Spinner';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { getTransformColor, getClassTransformBonuses, getTransformById } from '../../systems/transformSystem';
import pwaIcon from '../../assets/images/pwa.png';
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
 * Inspect a character's persisted buffs (without switching active character)
 * and return the effective max-HP/MP modifiers from any active elixirs.
 *
 * Pausable buffs are considered active when remainingMs > 0 (the timer only
 * ticks during combat, so it does not expire on its own). Realtime buffs are
 * considered active when their expiresAt is still in the future.
 */
const getElixirMaxBonuses = (
  charId: string,
  baseMaxHp: number,
  baseMaxMp: number,
): { hpFlat: number; hpPctMul: number; mpFlat: number; mpPctMul: number } => {
  const peek = peekCharacterStore(charId, 'buffs');
  const list = (peek?.allBuffs as Array<{ effect: string; timerMode?: string; remainingMs?: number; expiresAt?: number }> | undefined) ?? [];
  const now = Date.now();
  let hpFlat = 0;
  let mpFlat = 0;
  let hpPctMul = 1;
  let mpPctMul = 1;
  for (const b of list) {
    const isPausable = b.timerMode === 'pausable';
    const active = isPausable
      ? (b.remainingMs ?? 0) > 0
      : (b.expiresAt ?? 0) > now;
    if (!active) continue;
    if (b.effect === 'hp_boost_500') hpFlat += 500;
    else if (b.effect === 'mp_boost_500') mpFlat += 500;
    else if (b.effect === 'hp_pct_25') hpPctMul *= 1.25;
    else if (b.effect === 'mp_pct_25') mpPctMul *= 1.25;
  }
  void baseMaxHp; void baseMaxMp;
  return { hpFlat, hpPctMul, mpFlat, mpPctMul };
};

/**
 * Sum the per-class transform bonuses for a peeked character. Mirrors
 * `sumCompletedBonuses` from transformBonuses.ts but reads via
 * `peekCharacterStore` so we can compute stats for ANY character on the
 * select list without switching the active store. Returns zeroed values
 * when the character has no transforms or its save still uses the
 * legacy "baked" mode (in which case the bonuses are already inside
 * the raw `max_hp` / `max_mp` numbers and re-applying would double-count).
 */
const getTransformMaxBonuses = (
  charId: string,
  charClass?: string,
): { flatHp: number; flatMp: number; hpPctMul: number; mpPctMul: number } => {
  const ZERO = { flatHp: 0, flatMp: 0, hpPctMul: 1, mpPctMul: 1 };
  if (!charClass) return ZERO;
  const t = peekCharacterStore(charId, 'transforms');
  if (!t) return ZERO;
  if (t.bakedBonusesApplied) return ZERO; // legacy save — bonuses live in base stats
  const completed = t.completedTransforms as unknown;
  if (!Array.isArray(completed) || completed.length === 0) return ZERO;
  let flatHp = 0;
  let flatMp = 0;
  let hpPctSum = 0;
  let mpPctSum = 0;
  for (const tid of completed) {
    if (typeof tid !== 'number') continue;
    if (!getTransformById(tid)) continue;
    const per = getClassTransformBonuses(charClass as Parameters<typeof getClassTransformBonuses>[0], tid);
    flatHp += per.flatHp;
    flatMp += per.flatMp;
    hpPctSum += per.hpPercent;
    mpPctSum += per.mpPercent;
  }
  return {
    flatHp,
    flatMp,
    hpPctMul: 1 + hpPctSum / 100,
    mpPctMul: 1 + mpPctSum / 100,
  };
};

/**
 * Read a character's saved equipment + training bonuses + transform
 * bonuses + active elixir buffs from localStorage (without switching
 * active character) and return effective max HP/MP — matching the
 * `getEffectiveChar` calc that runs after login. Without this, the
 * select list under-reported HP for any character with a transform
 * unlocked (their bonus tier got skipped).
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
  const tx = getTransformMaxBonuses(charId, charClass);
  // Mirror getEffectiveChar's order:
  //   raw = base + equip + training + elixirFlat + transformFlat
  //   eff = floor(raw * elixirPctMul * transformPctMul)
  const baseSum = {
    hp: baseMaxHp + eqHp + (tb.max_hp ?? 0) + tx.flatHp,
    mp: baseMaxMp + eqMp + (tb.max_mp ?? 0) + tx.flatMp,
  };
  const elx = getElixirMaxBonuses(charId, baseSum.hp, baseSum.mp);
  return {
    maxHp: Math.floor((baseSum.hp + elx.hpFlat) * elx.hpPctMul * tx.hpPctMul),
    maxMp: Math.floor((baseSum.mp + elx.mpFlat) * elx.mpPctMul * tx.mpPctMul),
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
  // Delete is password-gated: the modal requires the account's CURRENT password
  // (verified via authApi.verifyCurrentPassword) before a character is removed.
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const closeDeleteModal = () => {
    setConfirmDeleteId(null);
    setDeletePassword('');
    setDeleteError(null);
    setDeletingId(null);
  };

  const handleConfirmDelete = async () => {
    const id = confirmDeleteId;
    if (!id) return;
    if (!deletePassword) {
      setDeleteError('Podaj obecne hasło.');
      return;
    }
    setDeletingId(id);
    setDeleteError(null);
    try {
      // Security gate: never delete without re-verifying the account password.
      const ok = await authApi.verifyCurrentPassword(deletePassword);
      if (!ok) {
        setDeleteError('Nieprawidłowe hasło.');
        setDeletingId(null);
        return;
      }
      await characterApi.deleteCharacter(id);
      await deleteCharacterData(id);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      closeDeleteModal();
    } catch {
      setError('Nie można usunąć postaci.');
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="char-select char-select--loading">
        <Spinner size="lg" label="Ładowanie postaci…" />
      </div>
    );
  }

  return (
    <div className="char-select">
      <header className="char-select__header">
        {/* 2026-05-21 spec ("skasuj napis grimshade obok"): brand artwork
            is the title now — the wordmark already sits inside the
            artwork itself, so the inline "Grimshade" span was reading
            as a duplicate. */}
        <h1 className="char-select__title">
          <img src={pwaIcon} alt="Grimshade" className="char-select__title-icon" />
        </h1>
        <p className="char-select__subtitle">Wybierz postać</p>
      </header>

      {error && <p className="char-select__error">{error}</p>}

      <div className="char-select__list">
        {characters.map((char) => {
          const eff = getEffectiveMaxStats(char.id, char.max_hp, char.max_mp, char.class);
          const effMaxHp = eff.maxHp;
          const effMaxMp = eff.maxMp;
          const curHp = Math.max(0, Math.min(char.hp ?? 0, effMaxHp));
          const curMp = Math.max(0, Math.min(char.mp ?? 0, effMaxMp));
          const hpPct = effMaxHp > 0 ? Math.min(100, (curHp / effMaxHp) * 100) : 0;
          const mpPct = effMaxMp > 0 ? Math.min(100, (curMp / effMaxMp) * 100) : 0;

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
                    <span className="char-select__bar-value">{curHp}/{effMaxHp}</span>
                  </div>
                  <div className="char-select__bar-wrap">
                    <span className="char-select__bar-label">MP</span>
                    <div className="char-select__bar char-select__bar--mp">
                      <div className="char-select__bar-fill" style={{ width: `${mpPct}%` }} />
                    </div>
                    <span className="char-select__bar-value">{curMp}/{effMaxMp}</span>
                  </div>
                </div>
              </div>

              <div className="char-select__card-actions">
                <button
                  className="char-select__select-btn"
                  onClick={() => void handleSelect(char)}
                  disabled={isSelecting}
                >
                  {isSelecting ? <Spinner size="sm" silent /> : 'Wybierz'}
                </button>

                <button
                  className="char-select__delete-btn"
                  onClick={() => setConfirmDeleteId(char.id)}
                  title="Usuń postać"
                >
                  <GameIcon name="wastebasket" />
                </button>
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

      {confirmDeleteId && (() => {
        const char = characters.find((c) => c.id === confirmDeleteId);
        if (!char) return null;
        return (
          <div className="char-select__modal-bg" onClick={closeDeleteModal}>
            <div
              className="char-select__modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="char-select__modal-title">
                Usuń postać <strong>{char.name}</strong>?
              </h2>
              <p className="char-select__modal-text">
                Tej operacji nie można cofnąć. Wpisz <strong>obecne hasło</strong>, aby potwierdzić.
              </p>
              <input
                type="password"
                className="char-select__modal-input"
                placeholder="Obecne hasło"
                value={deletePassword}
                onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirmDelete(); }}
                autoFocus
              />
              {deleteError && <p className="char-select__modal-error">{deleteError}</p>}
              <div className="char-select__modal-actions">
                <button
                  type="button"
                  className="char-select__modal-cancel"
                  onClick={closeDeleteModal}
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  className="char-select__modal-delete"
                  onClick={() => void handleConfirmDelete()}
                  disabled={deletingId === confirmDeleteId || !deletePassword}
                >
                  {deletingId === confirmDeleteId ? '…' : 'Usuń postać'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default CharacterSelect;
