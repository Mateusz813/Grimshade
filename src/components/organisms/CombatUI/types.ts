// Shared types for the unified combat UI used by every combat view in the
// game (hunting, boss, dungeon, transform, raid, trainer). The same JSX tree
// renders for all of them — these types describe the data each view feeds in.

import type { ReactNode } from 'react';
import type { TMonsterRarity } from '../../../systems/lootSystem';
import type { ICombatFloat, ICombatSkillAnim } from '../../../hooks/useCombatFx';

// Re-export the FX shapes so consumers only need to import from CombatUI.
export type { ICombatFloat, ICombatSkillAnim };

/** Slot for one enemy in the 4-slot left column of the arena. `null` slots
 *  render as empty placeholders so adjacent slots never reflow. */
export interface ICombatEnemy {
    id: string;
    /** Display name shown under the sprite. */
    name: string;
    /** Monster level — used by <MonsterSprite> / <BossSprite> to find the PNG. */
    level: number;
    /** Original emoji fallback when no PNG exists for this level. */
    sprite: string;
    /** Boss-art lookup vs. monster-art lookup (defaults to monster). */
    kind?: 'monster' | 'boss';
    /** Optional explicit sprite URL — overrides the level-keyed sprite registry
     *  lookup when set. Used by Transform combat to substitute the per-tier
     *  phoenix card image for the boss-slot sprite (the bestiary's `boss-N.png`
     *  doesn't fit the transform fantasy, so we paint the transform's tile
     *  art instead). Falls back to the standard MonsterSprite/BossSprite
     *  pipeline when omitted. */
    imageUrl?: string | null;
    /** Override `object-fit` for the optional `imageUrl`. Defaults to `contain`
     *  (the universal pick — never crops the artwork at the cost of a small
     *  letterbox band). Transform overrides to `cover` for the phoenix slot
     *  because the per-tier card art is composed to fill a portrait box and
     *  contain leaves visible empty bars top/bottom that read as a layout bug.
     *  Has no effect when `imageUrl` is null/undefined. */
    imageObjectFit?: 'cover' | 'contain';
    currentHp: number;
    maxHp: number;
    /** Optional MP bar (bosses with mana). */
    currentMp?: number;
    maxMp?: number;
    /** Drives the per-slot rarity-tint backdrop and the "STRONG" badge. */
    rarity: TMonsterRarity;
    isDead: boolean;
    /** True when this is the player's currently-targeted enemy (yellow ring). */
    isTargetedByPlayer: boolean;
    /** Visual hit flash — set briefly true by combat engine when this enemy
     *  takes damage. Legacy boolean toggle: rapid hits within the 300ms
     *  flash window will NOT re-trigger the CSS animation because the class
     *  is already on. Prefer `hitPulse` for new code so each individual hit
     *  shows its own visual feedback. */
    isHit?: boolean;
    /** Per-attack pulse counter. Increment on EACH hit landed against this
     *  enemy. EnemyCard renders a keyed flash overlay against this number, so
     *  the CSS animation re-mounts (and replays) on every distinct hit even
     *  when two attacks land within the same 300ms flash window. Use this
     *  instead of `isHit` when multiple attackers (party / multi-mob solo)
     *  can damage the same target in quick succession. */
    hitPulse?: number;
    /** CSS class for an active attack animation (e.g. `combat-ui__enemy--attack-Knight`). */
    attackingClassName?: string | null;
    /** Active per-slot skill overlay (fire/ice/holy/etc.) shown on this enemy
     *  while a player or ally cast lands. Populated from `useCombatFx`'s
     *  `enemySkill[slot]`. The card renders the themed `.skill-anim-overlay`
     *  child element using the supplied `cssClass`; `useCombatFx` auto-clears
     *  the entry after the animation's duration so React unmounts it. */
    skillAnim?: ICombatSkillAnim | null;
    /** Stack of floating damage / heal numbers anchored to this enemy slot
     *  (each spawned by `pushEnemyFloat`). Each entry has its own monotonic
     *  `id` so React reconciles rapid hits as independent elements — they
     *  drift up + fade out in parallel without merging. Auto-pruned by the
     *  hook 1.5s after spawn. Render order doesn't matter; each absolute. */
    floats?: ICombatFloat[];
    /** Live status countdowns shown as small icon + remaining-seconds badges
     *  pinned to the top-left of the enemy card. Used for stun, paralyze,
     *  immortal — anything the player needs to track to time their next
     *  cast. Each field is the wall-clock ms remaining; render hides the
     *  badge when ≤ 0. The view source-of-truth is the engine's IStatusState
     *  (read every render via `effectsRef.current.statuses.get(id)`). */
    statusOverlay?: {
        stunMs?: number;
        paralyzeMs?: number;
        immortalMs?: number;
        /** Rogue Naznaczony na Śmierć — incoming heals reverse to
         *  damage of equal value while > 0. Same drain cadence as
         *  stun (game-time, scales with combat speed). */
        markHealToDmgMs?: number;
        /** Necromancer Klątwa Śmierci (mark_amp) — first hit on the
         *  marked target consumes the charge and gets ×6 damage
         *  (500% more). Card shows the spell icon + countdown so the
         *  player can time their next hit before the buff window
         *  expires. The Ms here is the longest active charge's
         *  remainingMs. */
        markAmpMs?: number;
        /** Multiplier of the active mark_amp charge (e.g. 6 for
         *  Klątwa Śmierci). Surfaced so the badge can read "×6". */
        markAmpMult?: number;
        /** Necromancer Mroczny Rytuał (`dark_ritual:dur:pct`) — ms
         *  remaining on the soonest-firing pending ritual on this
         *  target. View renders :skull: + countdown so the player can see
         *  "5.2s until detonation". Drains × speedMult so x2/x4 burn
         *  the badge faster. The percent-of-max-HP that will fire
         *  when this expires is on `darkRitualPct` for the label. */
        darkRitualMs?: number;
        /** % of target max HP that the soonest-firing dark_ritual
         *  will deal when it triggers. Mirrors the spec's `:25` arg
         *  so the badge can render ":skull: 25% in 5.2s". */
        darkRitualPct?: number;
        /** Necromancer Kraina Śmierci (`mark_amp_all:mult:dur`) —
         *  duration-based amp window. Every hit by ANY ally on this
         *  target deals ×mult damage while > 0. Distinct from the
         *  count-based markAmp (which gives one bonus hit and
         *  expires); this one is passive for the whole window.
         *  Card renders :drop-of-blood: ×N · Ts so the player sees the active
         *  multiplier and seconds remaining. */
        markAmpAllMs?: number;
        markAmpAllMult?: number;
        /** Bard Kołysanka (`enemy_atk_down:25:8000`) — enemy ATK reduced
         *  by N% for the window. Card renders :sleeping-face: N% · Ts so the player
         *  can see "this enemy hits 25% less for 6s". */
        enemyAtkDownMs?: number;
        enemyAtkDownPct?: number;
        /** Bard Pieśń Syren (`aoe;enemy_no_heal:5000`) — enemy heals
         *  reverse to damage while > 0. Card renders :muted-speaker: + countdown
         *  so the player sees "boss self-heal will fail for 4.2s". */
        enemyNoHealMs?: number;
    };
}

/** Slot for one ally in the 4-slot right column. The player is typically slot 0. */
export interface ICombatAlly {
    id: string;
    /** Display name shown under the avatar. */
    name: string;
    /** Avatar src (image URL). */
    avatarUrl: string;
    /** Border color from the active transformation tier (or class color). */
    accentColor: string;
    /** Class name for animation (Knight, Mage, etc.). */
    className: string;
    currentHp: number;
    maxHp: number;
    currentMp: number;
    maxMp: number;
    isDead: boolean;
    /** True for the local player so we can mark it visually (:star:). */
    isPlayer: boolean;
    /** Character level — shown as a small badge on the avatar (top-left). */
    level?: number;
    /** Number of enemies currently aggro'd onto this ally (1-4). 0 hides badge. */
    aggroCount: number;
    /** Visual hit flash (legacy boolean — see `hitPulse` for per-attack
     *  re-trigger semantics). */
    isHit?: boolean;
    /** Per-attack pulse counter — increment on every individual hit so
     *  AllyCard's flash overlay re-mounts and replays the CSS animation.
     *  Critical when fighting multiple monsters: each monster's swing has
     *  its own attack-speed timer, so without this they'd quickly desync
     *  but visually merge into a single ongoing shake. */
    hitPulse?: number;
    /** Active attack class for skill animations. */
    attackingClassName?: string | null;
    /** Optional transformation tier (T1-T3) shown on the avatar frame. */
    transformTier?: number;
    /** Active per-slot skill overlay shown on this ally when they cast (or
     *  receive a buff). Populated from `useCombatFx`'s `allySkill[slot]`. */
    skillAnim?: ICombatSkillAnim | null;
    /** Stack of floating numbers anchored to this ally slot — typically
     *  monster-attack damage in red, plus the occasional heal in green
     *  (`kind: 'heal'`). Same lifecycle as `ICombatEnemy.floats`. */
    floats?: ICombatFloat[];
    /** Number of necromancer summons stacked on this ally's icon. */
    summonCount?: number;
    /** Counts per summon type (skeleton, ghost, demon, lich). Used for badge tooltip / stacked icons. */
    summonsByType?: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>>;
    /**
     * 2026-05 v7: click-to-despawn callback. Fires when the player taps
     * one of the per-type summon badges (:skull:×N skeletons / :ghost:×M ghosts /
     * :smiling-face-with-horns:×K demons / :crown:×L liches). The view forwards the click to
     * `useNecroSummonStore.despawnOne(necroId, type)` which removes the
     * oldest summon of that type from the queue. Card badges only render
     * the click handler when this callback is provided (typically only
     * for the local player's own card — bots don't get to manage their
     * own summons).
     */
    onSummonClick?: (type: 'skeleton' | 'ghost' | 'demon' | 'lich') => void;
    /**
     * 2026-05 v7: live "summon raised!" overlay animation on the
     * caster's avatar (~2s). Each type has its own visual:
     *   - skeleton — gray bone dust burst
     *   - ghost    — cyan ethereal swirl
     *   - demon    — red/orange flame eruption
     *   - lich     — purple vortex + golden runes (epic)
     *
     * Set by views from `useCombatFx.allySummonSpawn[slot]` after a
     * `useNecroSummonStore.spawn()` call.
     */
    summonSpawn?: { id: number; type: 'skeleton' | 'ghost' | 'demon' | 'lich' } | null;
}

/** A skill slot button in the bottom action bar. `null` slot = empty visual. */
export interface ICombatSkillSlot {
    id: string;
    /** Icon string (URL or emoji). */
    icon: string;
    /** Skill name for tooltip. */
    name: string;
    /** MP cost shown as small badge. */
    mpCost: number;
    /** 0..1 cooldown progress (1 = ready, 0 = just used). */
    cooldownProgress: number;
    /** ms remaining on the cooldown — drives the numeric "Xs" overlay
     *  shown on top of the dim sweep so the player can tell at a glance
     *  how long until the slot is ready. Optional for legacy callers
     *  that only have a 0..1 progress value. */
    cooldownRemainingMs?: number;
    /** Disabled state (no MP, dead, on cooldown, etc.). */
    disabled: boolean;
    onClick: () => void;
}

/** A potion slot in the bottom action bar (HP%, MP%) or under the arena
 *  (regular HP/MP). All four use this shape. */
export interface ICombatPotionSlot {
    /** What the potion restores — drives the accent color + cooldown rule. */
    kind: 'hp' | 'mp' | 'pct-hp' | 'pct-mp';
    /** Optional icon URL or emoji glyph for the dock button. When omitted,
     *  the dock falls back to the legacy :red-heart:/:droplet:/:red-heart:%/:droplet:% emoji per kind.
     *  2026-05: Combat fills this with the actual selected potion's PNG
     *  (`getPotionImage(potion.id)`) so the dock shows the same art as
     *  the Inventory bag tile. */
    icon?: string;
    /** Count remaining in inventory. */
    count: number;
    /** Cooldown progress 0..1 (1 = ready). */
    cooldownProgress: number;
    /** ms remaining — drives the same "Xs" overlay as skills. Optional. */
    cooldownRemainingMs?: number;
    disabled: boolean;
    onClick: () => void;
}

/** Drop entry collected during this session — drives both the backpack
 *  modal and the loot tally. */
export interface ICombatSessionDrop {
    id: string;
    icon: string;
    name: string;
    rarity: string;
    quantity: number;
    upgradeLevel?: number;
}

/** One task or quest currently active for the enemy being fought. Drives
 *  the top-left scroll badge dropdown. */
export interface ICombatActiveQuest {
    id: string;
    /** 'task' = daily-style task, 'quest' = main quest (:scroll: vs :clipboard: icon). */
    kind: 'task' | 'quest';
    /** Short label (monster name + " x10" etc.). */
    label: string;
    /** Current progress count. */
    progress: number;
    /** Goal count. */
    goal: number;
    /** True if this is already completed. */
    completed: boolean;
}

/** Configuration for the bottom-right exit button. Hunting shows a popup
 *  with two options (parent owns the popup state — the action bar just asks
 *  it to open via `onOpenDialog`). Everything else goes straight to a flee
 *  with the standard 1/10 death penalty. */
export type TExitConfig =
    | { kind: 'hunt-popup'; onOpenDialog: () => void }
    | { kind: 'flee'; onFlee: () => void };

/** Re-exportable JSX slot helpers. Most combat views pass extra DOM into
 *  the top controls (e.g. monster picker buttons during hunting); this
 *  type lets them inject without over-coupling props. */
export type TSlotNode = ReactNode | null | undefined;
