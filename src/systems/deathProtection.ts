import { useInventoryStore } from '../stores/inventoryStore';

/**
 * Death/flee protection (2026-06-21 spec).
 *
 * Either protection item — the death-protection elixir OR the amulet of loss
 * (AOL) — fully shields the player: on death AND flee they lose NOTHING (no
 * level, no XP, no skill XP, no equipment) and exactly ONE protection item is
 * consumed. This replaces the older split where the elixir only saved levels
 * and the AOL only saved items.
 */

export type TDeathProtectionId = 'death_protection' | 'amulet_of_loss';

export interface IDeathProtectionResult {
    /** True when a protection item was present and has been consumed. */
    isProtected: boolean;
    /** Which item was consumed (null when none was held). */
    consumedId: TDeathProtectionId | null;
}

/** Non-consuming check — does the player currently hold any protection? */
export const hasDeathProtection = (): boolean => {
    const c = useInventoryStore.getState().consumables;
    return (c['death_protection'] ?? 0) > 0 || (c['amulet_of_loss'] ?? 0) > 0;
};

/**
 * Consume ONE protection item if available. Priority: death-protection elixir
 * first, then the amulet of loss. When `isProtected` is true the caller MUST
 * skip the ENTIRE penalty (level + xp + skill xp + item loss) for both death
 * and flee.
 */
export const consumeDeathProtection = (): IDeathProtectionResult => {
    const inv = useInventoryStore.getState();
    if (inv.useConsumable('death_protection')) {
        return { isProtected: true, consumedId: 'death_protection' };
    }
    if (inv.useConsumable('amulet_of_loss')) {
        return { isProtected: true, consumedId: 'amulet_of_loss' };
    }
    return { isProtected: false, consumedId: null };
};
