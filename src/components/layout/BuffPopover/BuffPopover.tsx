import { useEffect, useRef, useState, type RefObject } from 'react';
import { useBuffStore } from '../../../stores/buffStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatStore } from '../../../stores/combatStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import { getElixirImage } from '../../../systems/spriteAssets';
import TinyIcon from '../../ui/TinyIcon/TinyIcon';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './BuffPopover.scss';

interface IBuffPopoverProps {
  /** Anchor button — outside-click ignores it so re-clicking the opener doesn't reopen. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Closes the popup. */
  onClose: () => void;
}

/** Effects that only tick during active combat (paused otherwise). */
const COMBAT_ONLY_EFFECTS = new Set(['xp_boost', 'premium_xp_boost']);

/** Format remaining ms as "Xh YYm" / "Mm SSs" / "Ns". */
const formatTimeLeft = (ms: number): string => {
  if (ms <= 0) return 'wygasł';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
};

/**
 * Popup that lists every active buff for the current character with a live
 * countdown. Pausable buffs (e.g. elixirs that only tick in combat) show a :pause-button:
 * indicator when combat is idle.
 *
 * Also surfaces the passive death-protection counters (Amulet of Loss, Death
 * Protection potion) — they don't have timers but the player should see they
 * are armed.
 */
const BuffPopover = ({ anchorRef, onClose }: IBuffPopoverProps) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const character = useCharacterStore((s) => s.character);
  const allBuffs = useBuffStore((s) => s.allBuffs);
  const cleanExpired = useBuffStore((s) => s.cleanExpired);
  const combatPhase = useCombatStore((s) => s.phase);
  const consumables = useInventoryStore((s) => s.consumables);

  // Track wall-clock time as state so countdowns update live without calling
  // Date.now() during render (react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      cleanExpired();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [cleanExpired]);

  // Outside-click + Escape handling
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

  if (!character) return null;

  const isInCombat = combatPhase === 'fighting';
  const aolCount = consumables['amulet_of_loss'] ?? 0;
  const deathProtCount = consumables['death_protection'] ?? 0;

  const active = allBuffs.filter((b) => {
    if (b.characterId !== character.id) return false;
    if ((b.charges ?? 0) > 0) return true;
    if (b.timerMode === 'game') return (b.gameMsRemaining ?? 0) > 0;
    if (b.timerMode === 'pausable') return b.remainingMs > 0;
    return b.expiresAt > now;
  });

  const hasAnything = active.length > 0 || aolCount > 0 || deathProtCount > 0;

  return (
    <div className="buff-popover" ref={popoverRef} role="dialog" aria-label="Aktywne buffy">
      <div className="buff-popover__title">Aktywne buffy</div>

      {!hasAnything && (
        <div className="buff-popover__empty">Brak aktywnych buffów.</div>
      )}

      {hasAnything && (
        <ul className="buff-popover__list">
          {deathProtCount > 0 && (
            <li className="buff-popover__row buff-popover__row--protection">
              <span className="buff-popover__row-icon">
                <TinyIcon icon={getElixirImage('death_protection') ?? 'shield'} size="md" />
              </span>
              <span className="buff-popover__row-name">Eliksir ochrony</span>
              <span className="buff-popover__row-time">×{deathProtCount}</span>
            </li>
          )}
          {aolCount > 0 && (
            <li className="buff-popover__row buff-popover__row--protection">
              <span className="buff-popover__row-icon">
                <TinyIcon icon={getElixirImage('amulet_of_loss') ?? 'trident-emblem'} size="md" />
              </span>
              <span className="buff-popover__row-name">Amulet of Loss</span>
              <span className="buff-popover__row-time">×{aolCount}</span>
            </li>
          )}
          {active.map((buff) => {
            const isCharge = (buff.charges ?? 0) > 0;
            const isGame = buff.timerMode === 'game';
            const isPausable = buff.timerMode === 'pausable';
            const remaining = isGame
              ? (buff.gameMsRemaining ?? 0)
              : (isPausable ? buff.remainingMs : Math.max(0, buff.expiresAt - now));
            const isLow = !isCharge && remaining < 60000;
            const isCombatOnly = COMBAT_ONLY_EFFECTS.has(buff.effect);
            const isPaused = isPausable && isCombatOnly && !isInCombat && !isCharge;
            return (
              <li
                key={buff.id}
                className={`buff-popover__row${isLow ? ' buff-popover__row--low' : ''}${isPaused ? ' buff-popover__row--paused' : ''}`}
              >
                <span className="buff-popover__row-icon"><TinyIcon icon={buff.icon} size="md" /></span>
                <span className="buff-popover__row-name">{buff.name}</span>
                <span className="buff-popover__row-time">
                  {isCharge
                    ? `×${buff.charges}${buff.maxCharges ? ` / ${buff.maxCharges}` : ''}`
                    : (isPaused ? <><GameIcon name="pause-button" /> {formatTimeLeft(remaining)}</> : formatTimeLeft(remaining))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default BuffPopover;
