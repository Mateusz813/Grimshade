import { useEffect } from 'react';
import { useLevelUpStore } from '../../../stores/levelUpStore';
import './LevelUpNotification.scss';

const SUBTLE_DURATION_MS = 3000;
const EPIC_DURATION_MS = 5000;

const LevelUpNotification = () => {
  const event = useLevelUpStore((s) => s.event);
  const clearLevelUp = useLevelUpStore((s) => s.clearLevelUp);

  useEffect(() => {
    if (!event) return;
    const duration = event.inCombat ? SUBTLE_DURATION_MS : EPIC_DURATION_MS;
    const timer = setTimeout(clearLevelUp, duration);
    return () => clearTimeout(timer);
  }, [event, clearLevelUp]);

  if (!event) return null;

  const goldGained = event.goldGained ?? 0;
  const goldMilestones = event.goldMilestoneLevels ?? [];

  // ── Subtle (in-combat) ──────────────────────────────────────────────────
  if (event.inCombat) {
    return (
      <div className="lvlup lvlup--subtle" onClick={clearLevelUp}>
        <div className="lvlup__subtle-flash" />
        <div className="lvlup__subtle-content">
          <span className="lvlup__subtle-icon">⚡</span>
          <div className="lvlup__subtle-text">
            <span className="lvlup__subtle-title">Poziom {event.newLevel}!</span>
            <span className="lvlup__subtle-sub">
              HP/MP odnowione ✦ +{event.statPointsGained} pkt statystyk
              {goldGained > 0 && (
                <>
                  {' '}✦ <span className="lvlup__subtle-gold">+{goldGained.toLocaleString()} 💰</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Epic (out of combat) ────────────────────────────────────────────────
  return (
    <div className="lvlup lvlup--epic" onClick={clearLevelUp}>
      {/* Background rays */}
      <div className="lvlup__rays">
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="lvlup__ray"
            style={{ '--ray-angle': `${i * 30}deg` } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Expanding rings */}
      <div className="lvlup__rings">
        <span className="lvlup__ring lvlup__ring--1" />
        <span className="lvlup__ring lvlup__ring--2" />
        <span className="lvlup__ring lvlup__ring--3" />
      </div>

      {/* Floating particles */}
      <div className="lvlup__particles">
        {Array.from({ length: 40 }).map((_, i) => (
          <span
            key={i}
            className="lvlup__particle"
            style={{
              '--p-x': `${Math.random() * 100}%`,
              '--p-delay': `${Math.random() * 2}s`,
              '--p-duration': `${1.5 + Math.random() * 2}s`,
              '--p-size': `${4 + Math.random() * 8}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Center content */}
      <div className="lvlup__center">
        <span className="lvlup__star">⭐</span>
        <span className="lvlup__level-label">LEVEL UP!</span>
        <span className="lvlup__level-number">{event.newLevel}</span>
        <div className="lvlup__rewards">
          <span className="lvlup__reward lvlup__reward--hp">❤️ HP odnowione do 100%</span>
          <span className="lvlup__reward lvlup__reward--mp">💙 MP odnowione do 100%</span>
          {event.statPointsGained > 0 && (
            <span className="lvlup__reward lvlup__reward--stats">
              ✦ +{event.statPointsGained} punktów statystyk
            </span>
          )}
          {goldGained > 0 && (
            <span className="lvlup__reward lvlup__reward--gold">
              💰 +{goldGained.toLocaleString()} Gold
              {goldMilestones.length > 0 && (
                <span className="lvlup__reward-detail">
                  {' '}(milestone lvl {goldMilestones.join(', ')})
                </span>
              )}
            </span>
          )}
        </div>
        <span className="lvlup__tap-hint">kliknij aby zamknąć</span>
      </div>
    </div>
  );
};

export default LevelUpNotification;
