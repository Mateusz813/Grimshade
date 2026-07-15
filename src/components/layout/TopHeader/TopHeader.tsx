import { useState, useRef, useEffect } from 'react';
import { useCharacterStore } from '../../../stores/characterStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import { useBuffStore } from '../../../stores/buffStore';
import { useTransformStore } from '../../../stores/transformStore';
import { useCombatHudStore } from '../../../stores/combatHudStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore } from '../../../stores/questStore';
import { useDailyQuestStore } from '../../../stores/dailyQuestStore';
import { useTransformAccent } from '../../../hooks/useTransformAccent';
import { getCharacterAvatar } from '../../../data/classAvatars';
import { getEffectiveChar } from '../../../systems/combatEngine';
import { formatGoldShort, getGoldBreakdown } from '../../../systems/goldFormat';
import AvatarMenu from '../AvatarMenu/AvatarMenu';
import ChangePasswordModal from '../../ui/ChangePasswordModal/ChangePasswordModal';
import BuffPopover from '../BuffPopover/BuffPopover';
import TaskBadge from './TaskBadge';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './TopHeader.scss';

const TopHeader = () => {
  const character = useCharacterStore((s) => s.character);
  const gold = useInventoryStore((s) => s.gold);
  const playMode = useConnectivityStore((s) => s.mode);
  const [displayGold, setDisplayGold] = useState(gold);
  const [goldPulse, setGoldPulse] = useState(false);
  const lastGoldRef = useRef(gold);
  useEffect(() => {
    const prev = lastGoldRef.current;
    if (gold === prev) return;
    if (gold < prev) {
      lastGoldRef.current = gold;
      setDisplayGold(gold);
      return;
    }
    const start = prev;
    const target = gold;
    const startedAt = performance.now();
    const duration = 600;
    setGoldPulse(true);
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(start + (target - start) * eased);
      setDisplayGold(current);
      if (t < 1) {
        raf = window.requestAnimationFrame(tick);
      } else {
        lastGoldRef.current = target;
        window.setTimeout(() => setGoldPulse(false), 250);
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [gold]);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const allBuffs = useBuffStore((s) => s.allBuffs);
  const consumables = useInventoryStore((s) => s.consumables);
  const { accent, accentRgb } = useTransformAccent();

  useInventoryStore((s) => s.equipment);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [buffsOpen, setBuffsOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [goldOpen, setGoldOpen] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(false);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const buffsBtnRef = useRef<HTMLButtonElement>(null);
  const goldRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const TICK = 250;
    const id = setInterval(() => {
      const bs = useBuffStore.getState();
      bs.tickGameTimeBuffs(TICK, bs.combatSpeedMult);
      bs.cleanExpired();
      const hudActive = useCombatHudStore.getState().active;
      const pctPerSec = bs.getPartyHealDotPctPerSec();
      if (pctPerSec > 0 && !hudActive) {
        const live = useCharacterStore.getState().character;
        if (live && live.hp > 0 && live.hp < live.max_hp) {
          const gameDeltaSec = TICK / 1000;
          const heal = Math.max(1, Math.floor(live.max_hp * (pctPerSec / 100) * gameDeltaSec));
          const newHp = Math.min(live.max_hp, live.hp + heal);
          if (newHp !== live.hp) {
            useCharacterStore.getState().updateCharacter({ hp: newHp });
          }
        }
      }
      setNow(Date.now());
    }, TICK);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!goldOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!goldRef.current?.contains(e.target as Node)) setGoldOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [goldOpen]);

  useEffect(() => {
    if (!pulseOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!pulseRef.current?.contains(e.target as Node)) setPulseOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pulseOpen]);

  const activeTasks = useTaskStore((s) => s.activeTasks);
  const activeQuests = useQuestStore((s) => s.activeQuests);
  const dailyActive = useDailyQuestStore((s) => s.activeQuests);

  const claimableTasks = activeTasks.filter((t) => t.progress >= t.killCount).length;
  const claimableQuests = activeQuests.filter((aq) =>
    aq.goals.every((g) => (g.progress ?? 0) >= g.count),
  ).length;
  const claimableDailies = dailyActive.filter((dq) => dq.completed && !dq.claimed).length;
  const claimableTotal = claimableTasks + claimableQuests + claimableDailies;

  if (!character) return null;

  const playerAvatarSrc = getCharacterAvatar(character.class, completedTransforms);

  const effChar = getEffectiveChar(character);
  const maxHp = effChar?.max_hp ?? character.max_hp;
  const maxMp = effChar?.max_mp ?? character.max_mp;
  const liveHp = character.hp;
  const liveMp = character.mp;
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (liveHp / maxHp) * 100)) : 0;
  const mpPct = maxMp > 0 ? Math.max(0, Math.min(100, (liveMp / maxMp) * 100)) : 0;

  const charId = character.id;
  const activeBuffCount = allBuffs.filter((b) => {
    if (b.characterId !== charId) return false;
    if ((b.charges ?? 0) > 0) return true;
    if (b.timerMode === 'game') return (b.gameMsRemaining ?? 0) > 0;
    if (b.timerMode === 'pausable') return b.remainingMs > 0;
    return b.expiresAt > now;
  }).length;
  const aolCount = consumables['amulet_of_loss'] ?? 0;
  const deathProtCount = consumables['death_protection'] ?? 0;
  const totalBuffCount = activeBuffCount + (aolCount > 0 ? 1 : 0) + (deathProtCount > 0 ? 1 : 0);

  const goldShort = formatGoldShort(displayGold);
  const goldBreakdown = getGoldBreakdown(gold);

  return (
    <header
      className="top-header"
      style={{
        '--nav-accent': accent,
        '--nav-accent-rgb': accentRgb,
      } as React.CSSProperties}
    >
      <div className="top-header__inner">
        <button
          ref={avatarBtnRef}
          className={`top-header__avatar-btn${avatarOpen ? ' top-header__avatar-btn--open' : ''}`}
          onClick={() => { setAvatarOpen((v) => !v); setBuffsOpen(false); }}
          aria-label="Menu postaci"
          type="button"
        >
          <img src={playerAvatarSrc} alt={character.class} className="top-header__avatar-img" />
          <span
            className={`top-header__status-dot top-header__status-dot--${playMode}`}
            aria-label={playMode === 'online' ? 'Tryb online' : 'Tryb offline'}
            title={playMode === 'online' ? 'Tryb online' : 'Tryb offline'}
          />
        </button>

        <div
          className="top-header__pulse-wrap"
          ref={pulseRef}
        >
          <button
            type="button"
            className={`top-header__pulse${pulseOpen ? ' top-header__pulse--open' : ''}`}
            aria-label={`HP ${Math.round(hpPct)}% · MP ${Math.round(mpPct)}%`}
            aria-expanded={pulseOpen}
            title={`HP ${Math.max(0, Math.round(liveHp))}/${maxHp} · MP ${Math.max(0, Math.round(liveMp))}/${maxMp}`}
            onClick={() => setPulseOpen((v) => !v)}
          >
            <div className="top-header__pulse-bar top-header__pulse-bar--hp">
              <span className="top-header__pulse-fill" style={{ width: `${hpPct}%` }} />
              <span className="top-header__pulse-label">{Math.round(hpPct)}%</span>
            </div>
            <div className="top-header__pulse-bar top-header__pulse-bar--mp">
              <span className="top-header__pulse-fill" style={{ width: `${mpPct}%` }} />
              <span className="top-header__pulse-label">{Math.round(mpPct)}%</span>
            </div>
          </button>
          {pulseOpen && (
            <div className="top-header__pulse-popover" role="dialog" aria-label="Stan HP i MP">
              <div className="top-header__pulse-popover-row top-header__pulse-popover-row--hp">
                <span className="top-header__pulse-popover-tier">HP</span>
                <span className="top-header__pulse-popover-val">
                  {Math.max(0, Math.round(liveHp)).toLocaleString('pl-PL')}/{maxHp.toLocaleString('pl-PL')}
                </span>
              </div>
              <div className="top-header__pulse-popover-row top-header__pulse-popover-row--mp">
                <span className="top-header__pulse-popover-tier">MP</span>
                <span className="top-header__pulse-popover-val">
                  {Math.max(0, Math.round(liveMp)).toLocaleString('pl-PL')}/{maxMp.toLocaleString('pl-PL')}
                </span>
              </div>
            </div>
          )}
        </div>

        {totalBuffCount > 0 && (
          <button
            ref={buffsBtnRef}
            className={`top-header__buffs-btn${buffsOpen ? ' top-header__buffs-btn--open' : ''}`}
            onClick={() => { setBuffsOpen((v) => !v); setAvatarOpen(false); }}
            aria-label="Aktywne buffy"
            type="button"
          >
            <span className="top-header__buffs-icon"><GameIcon name="sparkles" /></span>
            <span className="top-header__buffs-count">{totalBuffCount}</span>
          </button>
        )}


        <div className="top-header__spacer" />

        <TaskBadge claimableCount={claimableTotal} />


        <div className="top-header__gold" ref={goldRef} title="Złoto">
          <button
            type="button"
            className={`top-header__gold-btn${goldPulse ? ' top-header__gold-btn--pulse' : ''}`}
            onClick={() => setGoldOpen((v) => !v)}
            aria-expanded={goldOpen}
            aria-label={`Złoto: ${gold.toLocaleString('pl-PL')}`}
          >
            <span className="top-header__gold-icon"><GameIcon name="money-bag" /></span>
            <span className="top-header__gold-value">{goldShort}</span>
          </button>
          {goldOpen && (
            <div className="top-header__gold-popover" role="dialog" aria-label="Pełna wartość złota">
              <div className="top-header__gold-popover-title">
                <span><GameIcon name="money-bag" /></span>
                <span>Złoto</span>
              </div>
              <div className="top-header__gold-popover-rows">
                <div className="top-header__gold-row">
                  <span className="top-header__gold-row-tier">sc</span>
                  <span className="top-header__gold-row-val">{goldBreakdown.sc.toLocaleString('pl-PL')}</span>
                </div>
                <div className="top-header__gold-row">
                  <span className="top-header__gold-row-tier">cc</span>
                  <span className="top-header__gold-row-val">{goldBreakdown.cc.toLocaleString('pl-PL')}</span>
                </div>
                <div className="top-header__gold-row">
                  <span className="top-header__gold-row-tier">k</span>
                  <span className="top-header__gold-row-val">{goldBreakdown.k.toLocaleString('pl-PL')}</span>
                </div>
                <div className="top-header__gold-row">
                  <span className="top-header__gold-row-tier">gp</span>
                  <span className="top-header__gold-row-val">{goldBreakdown.gold.toLocaleString('pl-PL')}</span>
                </div>
              </div>
              <div className="top-header__gold-popover-total">
                Razem: {gold.toLocaleString('pl-PL')} gp
              </div>
            </div>
          )}
        </div>
      </div>

      {avatarOpen && (
        <AvatarMenu
          anchorRef={avatarBtnRef}
          onClose={() => setAvatarOpen(false)}
          onChangePassword={() => { setAvatarOpen(false); setChangePwdOpen(true); }}
        />
      )}
      {changePwdOpen && (
        <ChangePasswordModal onClose={() => setChangePwdOpen(false)} />
      )}
      {buffsOpen && (
        <BuffPopover
          anchorRef={buffsBtnRef}
          onClose={() => setBuffsOpen(false)}
        />
      )}
    </header>
  );
};

export default TopHeader;
