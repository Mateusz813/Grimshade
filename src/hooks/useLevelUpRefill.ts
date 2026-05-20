import { useEffect, useRef } from 'react';
import { useLevelUpStore } from '../stores/levelUpStore';
import { useCharacterStore } from '../stores/characterStore';
import { getEffectiveChar } from '../systems/combatEngine';

/**
 * Subscribes the calling combat view to global level-up events and runs a
 * supplied callback with the player's fresh effective max HP/MP whenever a
 * level-up fires while the view is in the active combat phase.
 *
 * Why this exists: `characterStore.addXp()` already refills the persistent
 * `character.hp / character.mp` to 100% on every level-up. But the combat
 * views (Boss, Dungeon, Transform) each keep a LOCAL `playerHp / playerMp`
 * useState used for intra-tick rendering — and the hunting `Combat` view
 * keeps live HP/MP in `combatStore.playerCurrentHp / Mp`. None of those local
 * stores see the store-side refill, so the player's bars stay stale at the
 * pre-level-up value until the next mid-fight delta lands. From the player's
 * point of view, "I just leveled up but my HP didn't refill" — which is the
 * bug this hook fixes.
 *
 * The callback is fired ONCE per level-up event (deduped on event identity
 * via a ref), and only while `active === true` — typically `phase === 'fighting'`.
 * When inactive, level-ups still update the store as normal, but the local
 * mirror is left to natural re-sync paths (e.g. wave start re-reads HP).
 *
 * @param active   true while the calling view is in an active combat phase
 *                 — gates the refill so the hook is a no-op on idle/lobby/etc.
 * @param onRefill Called with the freshly-computed effective max HP and MP.
 *                 The view should update its own local HP/MP setters here.
 */
export function useLevelUpRefill(
    active: boolean,
    onRefill: (maxHp: number, maxMp: number) => void,
): void {
    const event = useLevelUpStore((s) => s.event);
    // Track which event id we've already handled so we don't double-fire on
    // unrelated re-renders. We key on the event object reference itself
    // (Zustand replaces the whole object on triggerLevelUp), which is stable
    // for a given level-up notification.
    const handledRef = useRef<typeof event>(null);

    useEffect(() => {
        if (!active) return;
        if (!event) return;
        if (handledRef.current === event) return;
        handledRef.current = event;

        // The store has already updated character to the new level + refilled
        // HP/MP. Re-derive the effective max because equipment/buff/elixir
        // bonuses can shift the cap, and we want the view's local mirror to
        // sit at the true effective max — not the raw character.max_hp.
        const char = useCharacterStore.getState().character;
        if (!char) return;
        const eff = getEffectiveChar(char);
        const maxHp = eff?.max_hp ?? char.max_hp;
        const maxMp = eff?.max_mp ?? char.max_mp;
        onRefill(maxHp, maxMp);
    }, [active, event, onRefill]);
}
