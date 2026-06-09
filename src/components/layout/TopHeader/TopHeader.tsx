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
import './TopHeader.scss';

/**
 * Fixed thin top header that lives on every authenticated screen.
 * Layout: [avatar] [hp/mp mini-bars] [buffs (if any)] [spacer] [tasks] [gold]
 *
 * Avatar opens a popup (change character, language, sync, logout).
 * The two thin bars next to the avatar mirror the player's live HP/MP from
 * the characterStore — every combat view (Dungeon, Boss, Transform, Combat
 * hunting, Raid) writes its tick-by-tick HP/MP back to characterStore via a
 * mirror useEffect, so the header stays live during fights without needing
 * to subscribe to per-view local state.
 * Gold is displayed in the compact tier form (k / cc / sc); clicking the
 * pill opens a small popover with the full breakdown.
 */
const TopHeader = () => {
  const character = useCharacterStore((s) => s.character);
  const gold = useInventoryStore((s) => s.gold);
  // 2026-05-20 spec: drives the offline pill rendered next to the buffs.
  const playMode = useConnectivityStore((s) => s.mode);
  // ── Gold tick-up animation ───────────────────────────────────────────
  // When `gold` jumps (typically because the player just claimed a task
  // / quest / loot drop), the displayed value rolls UP from the previous
  // amount to the new one over ~600 ms instead of snapping. The pill
  // also pulses with a brief glow so the eye catches the increase. The
  // animation only fires on increases — a spend snaps instantly so the
  // player isn't tricked into thinking they have more than they do.
  const [displayGold, setDisplayGold] = useState(gold);
  const [goldPulse, setGoldPulse] = useState(false);
  const lastGoldRef = useRef(gold);
  useEffect(() => {
    const prev = lastGoldRef.current;
    if (gold === prev) return;
    if (gold < prev) {
      // Spend / loss — snap straight to the new value.
      lastGoldRef.current = gold;
      setDisplayGold(gold);
      return;
    }
    // Increase — count up over ~600 ms.
    const start = prev;
    const target = gold;
    const startedAt = performance.now();
    const duration = 600;
    setGoldPulse(true);
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      // Ease-out so the number slows as it approaches the final value.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(start + (target - start) * eased);
      setDisplayGold(current);
      if (t < 1) {
        raf = window.requestAnimationFrame(tick);
      } else {
        lastGoldRef.current = target;
        // Drop the pulse a moment after the count settles.
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

  // Subscribe to fields that affect getEffectiveChar's max_hp/max_mp so the
  // bars re-scale instantly when buffs/elixirs/equipment swaps occur. The
  // returned value isn't used here — `getEffectiveChar` reads it via store
  // getters — but the subscription forces a re-render on change.
  useInventoryStore((s) => s.equipment);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [buffsOpen, setBuffsOpen] = useState(false);
  // Change-password modal lives HERE (not inside AvatarMenu) so it survives the
  // menu closing when the user taps "Zmień hasło".
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [goldOpen, setGoldOpen] = useState(false);
  // Pulse popover — click on the HP/MP mini bars to peek the exact values
  // (shown as "10/100" rows). Same click-outside contract as the gold popover.
  const [pulseOpen, setPulseOpen] = useState(false);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const buffsBtnRef = useRef<HTMLButtonElement>(null);
  const goldRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);

  // Track wall-clock time as state so the buff icon's "active count" stays
  // current as buffs expire — Date.now() is impure and may not be called
  // during render (react-hooks/purity).
  //
  // 2026-05 v6 (buff-stuck fix): TopHeader is the SINGLE always-mounted
  // host that ticks the global BuffStore. Each interval pass:
  //   • Drains every game-time buff by 250ms × combatSpeedMult so a
  //     20s skill buff cast at x4 burns in 5 wall seconds, while a
  //     buff cast outside combat (mult=1) drains in real time.
  //   • Calls cleanExpired() to drop realtime buffs whose expiresAt
  //     passed, plus pausable / game-time buffs whose remaining time
  //     hit zero.
  // Previously this lived in `<BuffBar>` — but BuffBar was never mounted
  // (orphaned file), so game-time buffs never drained: the player cast
  // a spell, the buff appeared in the header, and stayed there forever.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const TICK = 250;
    const id = setInterval(() => {
      const bs = useBuffStore.getState();
      bs.tickGameTimeBuffs(TICK, bs.combatSpeedMult);
      bs.cleanExpired();
      // 2026-05 v6: Cleric Błogosławieństwo (heal_party_dot) — central
      // regen tick that runs OUT of combat. Each combat view owns its
      // own 1-Hz pulse for the visible floats + local HP refs, so we
      // skip the rise here when a combat HUD is mounted (combatHudStore
      // active=true) — otherwise characterStore.hp would double-tick.
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

  // Gold popover click-outside.
  useEffect(() => {
    if (!goldOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!goldRef.current?.contains(e.target as Node)) setGoldOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [goldOpen]);

  // Pulse popover click-outside — same contract as gold above.
  useEffect(() => {
    if (!pulseOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!pulseRef.current?.contains(e.target as Node)) setPulseOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pulseOpen]);

  // ── Claimable rewards detection ──────────────────────────────────────────
  // Subscribe to the source data so the glow turns on / off the moment a
  // task or quest crosses its goal threshold (or gets claimed).
  const activeTasks = useTaskStore((s) => s.activeTasks);
  const activeQuests = useQuestStore((s) => s.activeQuests);
  const dailyActive = useDailyQuestStore((s) => s.activeQuests);

  // Tasks: ready-to-claim = progress reached killCount.
  const claimableTasks = activeTasks.filter((t) => t.progress >= t.killCount).length;
  // Quests: ALL goals must be done. Quests don't currently track a "claimed"
  // flag distinct from "completed" — claiming removes them from activeQuests
  // — so being in activeQuests with all goals done means "ready".
  const claimableQuests = activeQuests.filter((aq) =>
    aq.goals.every((g) => (g.progress ?? 0) >= g.count),
  ).length;
  // Daily quests have explicit completed/claimed flags.
  const claimableDailies = dailyActive.filter((dq) => dq.completed && !dq.claimed).length;
  const claimableTotal = claimableTasks + claimableQuests + claimableDailies;

  if (!character) return null;

  const playerAvatarSrc = getCharacterAvatar(character.class, completedTransforms);

  // Effective max HP/MP — accounts for equipment + training + elixirs + transform.
  const effChar = getEffectiveChar(character);
  const maxHp = effChar?.max_hp ?? character.max_hp;
  const maxMp = effChar?.max_mp ?? character.max_mp;
  const liveHp = character.hp;
  const liveMp = character.mp;
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (liveHp / maxHp) * 100)) : 0;
  const mpPct = maxMp > 0 ? Math.max(0, Math.min(100, (liveMp / maxMp) * 100)) : 0;

  // Count active buffs (realtime: not expired; pausable: remainingMs > 0;
  // charge buffs: charges > 0). Plus passive death-protection counters
  // (amulet of loss + death potion).
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

  // Displayed value during the tick-up; the popover still uses the
  // canonical `gold` so the breakdown matches the inventory store
  // exactly even mid-animation.
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
          {/* 2026-05-20 spec ("Wywal offline z headera, daj tylko czerwona
              kropke w prawym rogu avataru w headerze, a jak jestem online
              to zielona"): tiny status dot anchored to the bottom-right
              of the avatar. Green = online, red = offline. */}
          <span
            className={`top-header__status-dot top-header__status-dot--${playMode}`}
            aria-label={playMode === 'online' ? 'Tryb online' : 'Tryb offline'}
            title={playMode === 'online' ? 'Tryb online' : 'Tryb offline'}
          />
        </button>

        {/* Live HP/MP mini bars — sit IMMEDIATELY next to the avatar so the
            player's pulse reads as part of the avatar identity, before the
            buff chip. Each bar carries a tiny percentage label inside it so
            the player can read "10%/100%" at a glance; clicking the cluster
            opens a popover with the exact HP/MP values for cases where the
            percent isn't enough (e.g. 1 HP at low cap looks the same as 1 HP
            at high cap on the bar). */}
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
            <span className="top-header__buffs-icon">✦</span>
            <span className="top-header__buffs-count">{totalBuffCount}</span>
          </button>
        )}


        <div className="top-header__spacer" />

        {/* Task/quest badge — global, shows ALL active tasks + quests across
            every screen. Sits just before the gold counter so the player can
            check "what's next" with one tap from anywhere. Glows when at
            least one task / quest / daily is ready to claim. */}
        <TaskBadge claimableCount={claimableTotal} />

        {/* Arena Points used to live here next to gold; per design it now
            lives only inside the Arena view's league strip. The header is
            for in-world currencies (gold, chests, badges) — AP is a
            tournament-scoped score that doesn't belong globally. */}

        <div className="top-header__gold" ref={goldRef} title="Złoto">
          <button
            type="button"
            className={`top-header__gold-btn${goldPulse ? ' top-header__gold-btn--pulse' : ''}`}
            onClick={() => setGoldOpen((v) => !v)}
            aria-expanded={goldOpen}
            aria-label={`Złoto: ${gold.toLocaleString('pl-PL')}`}
          >
            <span className="top-header__gold-icon">💰</span>
            <span className="top-header__gold-value">{goldShort}</span>
          </button>
          {goldOpen && (
            <div className="top-header__gold-popover" role="dialog" aria-label="Pełna wartość złota">
              <div className="top-header__gold-popover-title">
                <span>💰</span>
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
