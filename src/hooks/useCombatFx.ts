import { useCallback, useRef, useState } from 'react';
import { getSkillAnimation } from '../data/skillAnimations';
import { getSkillIcon } from '../data/skillIcons';
import { isImageUrl } from '../systems/spriteAssets';

/**
 * Per-slot combat visual effects: skill animations + floating damage numbers.
 *
 * Lives in a single hook so every combat view (Dungeon, Boss, Combat, Transform,
 * Raid) gets identical mechanics for free. Each enemy/ally slot keeps its own
 * independent stream of effects so parallel hits never overwrite each other:
 *
 *   - `triggerEnemySkillAnim(slot, skillId)`  — show the skill's themed
 *     overlay (fire/ice/holy/etc.) on enemy slot `slot`. Auto-clears after
 *     the skill's duration.
 *
 *   - `pushEnemyFloat(slot, value, kind, …)` — spawn a floating damage
 *     number anchored to enemy slot `slot` that drifts up and fades out.
 *     `kind` drives the colour family + crit emphasis:
 *       'basic'        — player physical attack (white / pale gold on crit)
 *       'spell'        — player spell  (purple / pink on crit, with skill icon)
 *       'ally-basic'   — ally physical attack (cyan / lime on crit)
 *       'ally-spell'   — ally spell           (cyan-pink / lime-pink on crit)
 *     `isCrit` toggles a larger, brighter render. Pass `icon` to put a small
 *     emoji on the float (skill / weapon glyph) — required for spells, optional
 *     for basics.
 *
 *   - `pushAllyFloat(slot, value, kind, …)` — same shape, but for an ally
 *     slot taking damage. `kind` here is 'monster' or 'monster-spell' (red
 *     vs. dark-red, monster-spell adds a glyph and a slight darkening
 *     halo to read as magical damage).
 *
 * Each float carries a unique monotonic id so React's reconciler treats
 * rapid-fire hits as separate elements (no animation merging). Floats
 * self-expire 1.5s after spawn — long enough to read mid-combat, short
 * enough not to pile up during a sustained burst.
 */

export type TFloatKind =
    | 'basic'        // player physical hit on enemy
    | 'spell'        // player spell on enemy
    | 'ally-basic'   // ally physical hit on enemy
    | 'ally-spell'   // ally spell on enemy
    | 'monster'      // monster physical hit on player/ally
    | 'monster-spell'// monster spell on player/ally
    | 'damage'       // generic damage number (no attacker-style colour)
    | 'heal';        // potion / heal received

export interface ICombatFloat {
    id: number;
    value: number;
    kind: TFloatKind;
    isCrit?: boolean;
    icon?: string;          // emoji shown next to the number (skill / weapon)
    /** When set, replaces the numeric `value` rendering with this label
     *  (e.g. "STUN", "PARAL") so debuff casts can show a status word
     *  instead of a meaningless "0". */
    label?: string;
}

export interface ICombatSkillAnim {
    id: number;
    emoji: string;
    cssClass: string;       // skill-anim--fire / etc., from skillAnimations.ts
}

/**
 * 2026-05 v7: Necromancer summon-spawn animation that overlays the
 * caster's avatar for ~2s when they raise a new minion. Each summon
 * type gets its own visual:
 *
 *   - skeleton — gray bone dust + :skull: puff
 *   - ghost    — cyan ethereal swirl + :ghost: expansion
 *   - demon    — orange/red flame eruption + :smiling-face-with-horns: burst
 *   - lich     — purple vortex + golden runes + :crown: epic flash
 *
 * The overlay is just a CSS-keyframe-driven div on top of the AllyCard
 * avatar. View triggers via `triggerAllySummonSpawn(slot, type)` after
 * each `useNecroSummonStore.spawn()` call.
 */
export interface ICombatSummonSpawn {
    id: number;
    type: 'skeleton' | 'ghost' | 'demon' | 'lich';
}

const FLOAT_LIFETIME_MS = 1500;

export const useCombatFx = () => {
    const [enemyFloats, setEnemyFloats] = useState<Record<number, ICombatFloat[]>>({});
    const [allyFloats,  setAllyFloats]  = useState<Record<number, ICombatFloat[]>>({});
    const [enemySkill,  setEnemySkill]  = useState<Record<number, ICombatSkillAnim>>({});
    const [allySkill,   setAllySkill]   = useState<Record<number, ICombatSkillAnim>>({});
    // 2026-05 v7: per-slot summon-spawn animation overlay (necromancer).
    const [allySummonSpawn, setAllySummonSpawn] = useState<Record<number, ICombatSummonSpawn>>({});
    const idRef = useRef(0);

    const nextId = () => ++idRef.current;

    // -- Floats -------------------------------------------------------------
    const pushEnemyFloat = useCallback(
        (slot: number, value: number, kind: TFloatKind, opts?: { isCrit?: boolean; icon?: string; label?: string }) => {
            const id = nextId();
            const float: ICombatFloat = { id, value, kind, isCrit: opts?.isCrit, icon: opts?.icon, label: opts?.label };
            setEnemyFloats((prev) => ({
                ...prev,
                [slot]: [...(prev[slot] ?? []), float],
            }));
            window.setTimeout(() => {
                setEnemyFloats((prev) => {
                    const list = prev[slot];
                    if (!list) return prev;
                    const next = list.filter((f) => f.id !== id);
                    return { ...prev, [slot]: next };
                });
            }, FLOAT_LIFETIME_MS);
        },
        [],
    );

    const pushAllyFloat = useCallback(
        (slot: number, value: number, kind: TFloatKind, opts?: { isCrit?: boolean; icon?: string; label?: string }) => {
            const id = nextId();
            const float: ICombatFloat = { id, value, kind, isCrit: opts?.isCrit, icon: opts?.icon, label: opts?.label };
            setAllyFloats((prev) => ({
                ...prev,
                [slot]: [...(prev[slot] ?? []), float],
            }));
            window.setTimeout(() => {
                setAllyFloats((prev) => {
                    const list = prev[slot];
                    if (!list) return prev;
                    const next = list.filter((f) => f.id !== id);
                    return { ...prev, [slot]: next };
                });
            }, FLOAT_LIFETIME_MS);
        },
        [],
    );

    // -- Skill anims --------------------------------------------------------
    // The animation glyph prefers the per-class PNG artwork (e.g.
    // archer-1.png) so the actual spell image flies on the target. Falls
    // back to the legacy emoji from skillAnimations.ts when no artwork is
    // registered. Keeping the cssClass + duration from skillAnimations
    // means the existing per-element keyframes (skill-fire-emoji etc.)
    // still drive the motion — they just animate an <img> instead of a
    // glyph when the resolved icon is a URL.
    const resolveAnimEmoji = (skillId: string, fallback: string): string => {
        const ic = getSkillIcon(skillId);
        return isImageUrl(ic) ? ic : fallback;
    };
    const triggerEnemySkillAnim = useCallback((slot: number, skillId: string): void => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        const id = nextId();
        const emoji = resolveAnimEmoji(skillId, animData.emoji);
        const next: ICombatSkillAnim = { id, emoji, cssClass: animData.cssClass };
        setEnemySkill((prev) => ({ ...prev, [slot]: next }));
        window.setTimeout(() => {
            setEnemySkill((prev) => (prev[slot]?.id === id ? { ...prev, [slot]: undefined as unknown as ICombatSkillAnim } : prev));
        }, animData.duration);
    }, []);

    const triggerAllySkillAnim = useCallback((slot: number, skillId: string): void => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        const id = nextId();
        const emoji = resolveAnimEmoji(skillId, animData.emoji);
        const next: ICombatSkillAnim = { id, emoji, cssClass: animData.cssClass };
        setAllySkill((prev) => ({ ...prev, [slot]: next }));
        window.setTimeout(() => {
            setAllySkill((prev) => (prev[slot]?.id === id ? { ...prev, [slot]: undefined as unknown as ICombatSkillAnim } : prev));
        }, animData.duration);
    }, []);

    // -- Summon-spawn overlay (Necromancer) ---------------------------------
    // 2-second epic-flavoured animation on the caster's AllyCard avatar
    // when a new minion rises. Each type has its own keyframe in
    // CombatUI.scss so the player can tell skeleton / ghost / demon /
    // lich apart at a glance.
    const SUMMON_SPAWN_MS = 2000;
    const triggerAllySummonSpawn = useCallback((slot: number, type: 'skeleton' | 'ghost' | 'demon' | 'lich'): void => {
        const id = nextId();
        const next: ICombatSummonSpawn = { id, type };
        setAllySummonSpawn((prev) => ({ ...prev, [slot]: next }));
        window.setTimeout(() => {
            setAllySummonSpawn((prev) => (prev[slot]?.id === id ? { ...prev, [slot]: undefined as unknown as ICombatSummonSpawn } : prev));
        }, SUMMON_SPAWN_MS);
    }, []);

    // -- Reset (call between waves / fights to drop pending tails) ---------
    const resetFx = useCallback(() => {
        setEnemyFloats({});
        setAllyFloats({});
        setEnemySkill({});
        setAllySkill({});
        setAllySummonSpawn({});
    }, []);

    // 2026-05-15 spec ("Jezeli ktos wyjdzie z party podczas raidu i
    // znika jakis sojusznik z widoku walki to animacje ataku potworow
    // zle sie pokzuja nie w tym miejscu co powinny a czasami na
    // kafelku co jest pusty"): when an ally slot disappears (member
    // leaves party mid-fight) the SLOT INDEX used by allyFloats /
    // allySkill / allySummonSpawn no longer maps to the same member —
    // floats end up on the wrong card or on the empty padding tiles.
    // The boss/raid roster-sync calls this to drop every pending
    // ally-side animation when the roster changes; the very next
    // tick's pushAllyFloat lands on the fresh slot layout. Enemy-side
    // animations stay untouched (boss slots are stable). */
    const resetAllyFx = useCallback(() => {
        setAllyFloats({});
        setAllySkill({});
        setAllySummonSpawn({});
    }, []);

    return {
        enemyFloats,
        allyFloats,
        enemySkill,
        allySkill,
        allySummonSpawn,
        pushEnemyFloat,
        pushAllyFloat,
        triggerEnemySkillAnim,
        triggerAllySkillAnim,
        triggerAllySummonSpawn,
        resetFx,
        resetAllyFx,
    };
};
