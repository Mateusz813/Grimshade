import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeathStore } from '../../../stores/deathStore';
import { useCombatStore } from '../../../stores/combatStore';
import { stopCombat } from '../../../systems/combatEngine';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import Icon from '../../atoms/Icon/Icon';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import './DeathNotification.scss';

// Flee is a SOFT event with a low-stakes penalty — the popup auto-dismisses
// after a short read-window. Death is a HARD event the player must
// acknowledge: navigation to town happens automatically, but the popup
// itself persists until the player clicks it. This guarantees the
// "you died, here's what you lost" message can't be missed.
const FLEE_DURATION_MS = 3500;

const DeathNotification = () => {
  const event = useDeathStore((s) => s.event);
  const clearDeath = useDeathStore((s) => s.clearDeath);
  const navigate = useNavigate();

  // Flee = soft penalty (no level loss, ~1/10 XP, no nav to town).
  // Death = full penalty + force-return to town.
  const isFlee = event?.kind === 'flee';

  useEffect(() => {
    if (!event) return;

    if (!isFlee) {
      // Real death stops combat hard, then auto-navigates to town —
      // but the popup is mounted globally in AppRouter, so it stays
      // on screen across the route change. The only way to dismiss
      // it is the click handler below. The player MUST acknowledge.
      const cs = useCombatStore.getState();
      if (cs.phase === 'fighting' || cs.phase === 'victory' || cs.phase === 'dead') {
        stopCombat();
      }
      navigate('/');
      return;
    }

    // Flee: soft auto-dismiss after a short read-window. No navigation —
    // the calling view already handled returning to its own list.
    const timer = setTimeout(() => {
      clearDeath();
    }, FLEE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [event, isFlee, clearDeath, navigate]);

  if (!event) return null;

  const handleClick = () => {
    clearDeath();
    if (!isFlee) navigate('/');
  };

  return (
    <div className={`death death--epic${isFlee ? ' death--flee' : ''}`} onClick={handleClick}>
      {/* Blood drip particles falling from top */}
      <div className="death__drips">
        {Array.from({ length: isFlee ? 8 : 30 }).map((_, i) => (
          <span
            key={i}
            className="death__drip"
            style={{
              '--d-x': `${Math.random() * 100}%`,
              '--d-delay': `${Math.random() * 1.5}s`,
              '--d-duration': `${1.2 + Math.random() * 1.5}s`,
              '--d-size': `${3 + Math.random() * 6}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Expanding dark rings */}
      <div className="death__rings">
        <span className="death__ring death__ring--1" />
        <span className="death__ring death__ring--2" />
        <span className="death__ring death__ring--3" />
      </div>

      {/* Floating soul particles */}
      <div className="death__souls">
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className="death__soul"
            style={{
              '--s-x': `${10 + Math.random() * 80}%`,
              '--s-y': `${30 + Math.random() * 40}%`,
              '--s-delay': `${0.5 + Math.random() * 2}s`,
              '--s-duration': `${2 + Math.random() * 2}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Center content */}
      <div className="death__center">
        <span className="death__skull">{isFlee ? <GameIcon name="person-running" /> : <GameIcon name="skull" />}</span>
        <span className="death__label">{isFlee ? 'UCIEKŁEŚ' : 'ZGINĄŁEŚ'}</span>

        {!isFlee && (
          <div className="death__killer">
            <span className="death__killer-text">
              Zabity przez: <strong>{event.killedBy}</strong>
            </span>
            <span className="death__killer-level">
              Poziom {event.sourceLevel}
            </span>
          </div>
        )}

        <div className="death__penalties">
          {event.protectionUsed ? (
            <span className="death__penalty death__penalty--protected">
              <EmojiText>:shield: Eliksir Ochrony uchronił od utraty poziomu!</EmojiText>
            </span>
          ) : isFlee ? (
            <>
              {event.levelsLost > 0 && (
                <span className="death__penalty death__penalty--level">
                  <GameIcon name="chart-decreasing" /> Poziom {event.oldLevel} <Icon name="arrowRight" /> {event.newLevel} (-{event.levelsLost})
                </span>
              )}
              <span className="death__penalty death__penalty--skill">
                <GameIcon name="crossed-swords" /> -{(event.skillXpLossPercent ?? 0.1).toFixed(1)}% Skill XP
              </span>
            </>
          ) : (
            <>
              {event.levelsLost > 0 ? (
                <span className="death__penalty death__penalty--level">
                  <GameIcon name="chart-decreasing" /> Poziom {event.oldLevel} <Icon name="arrowRight" /> {event.newLevel} (-{event.levelsLost})
                </span>
              ) : null}
              <span className="death__penalty death__penalty--skill">
                <GameIcon name="crossed-swords" /> -{(event.skillXpLossPercent ?? 50).toFixed(0)}% Skill XP
              </span>
            </>
          )}
        </div>

        <span className="death__tap-hint">
          {isFlee ? 'kliknij aby zamknąć' : 'kliknij aby wrócić do miasta'}
        </span>
      </div>
    </div>
  );
};

export default DeathNotification;
