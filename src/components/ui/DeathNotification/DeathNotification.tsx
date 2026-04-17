import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeathStore } from '../../../stores/deathStore';
import { useCombatStore } from '../../../stores/combatStore';
import { stopCombat } from '../../../systems/combatEngine';
import './DeathNotification.scss';

const DEATH_DURATION_MS = 6000;

const DeathNotification = () => {
  const event = useDeathStore((s) => s.event);
  const clearDeath = useDeathStore((s) => s.clearDeath);
  const navigate = useNavigate();

  useEffect(() => {
    if (!event) return;

    // Stop all background combat immediately
    const cs = useCombatStore.getState();
    if (cs.phase === 'fighting' || cs.phase === 'victory' || cs.phase === 'dead') {
      stopCombat();
    }

    // Auto-dismiss after duration and navigate to town
    const timer = setTimeout(() => {
      clearDeath();
      navigate('/');
    }, DEATH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [event, clearDeath, navigate]);

  if (!event) return null;

  const handleClick = () => {
    clearDeath();
    navigate('/');
  };

  return (
    <div className="death death--epic" onClick={handleClick}>
      {/* Blood drip particles falling from top */}
      <div className="death__drips">
        {Array.from({ length: 30 }).map((_, i) => (
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
        <span className="death__skull">💀</span>
        <span className="death__label">ZGINĄŁEŚ</span>

        <div className="death__killer">
          <span className="death__killer-text">
            Zabity przez: <strong>{event.killedBy}</strong>
          </span>
          <span className="death__killer-level">
            Poziom {event.sourceLevel}
          </span>
        </div>

        <div className="death__penalties">
          {event.protectionUsed ? (
            <span className="death__penalty death__penalty--protected">
              🛡️ Eliksir Ochrony uchronił od utraty poziomu!
            </span>
          ) : (
            <>
              {event.levelsLost > 0 ? (
                <span className="death__penalty death__penalty--level">
                  📉 Poziom {event.oldLevel} → {event.newLevel}
                </span>
              ) : (
                <span className="death__penalty death__penalty--xp">
                  📉 -50% XP
                </span>
              )}
              <span className="death__penalty death__penalty--skill">
                ⚔️ -5% Skill XP
              </span>
            </>
          )}
        </div>

        <span className="death__tap-hint">kliknij aby wrócić do miasta</span>
      </div>
    </div>
  );
};

export default DeathNotification;
