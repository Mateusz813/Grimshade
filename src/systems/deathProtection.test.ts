import { describe, it, expect, beforeEach } from 'vitest';
import { consumeDeathProtection, hasDeathProtection } from './deathProtection';
import { useInventoryStore } from '../stores/inventoryStore';


const seed = (consumables: Record<string, number>): void => {
    useInventoryStore.setState({ consumables });
};

describe('deathProtection › consumeDeathProtection', () => {
    beforeEach(() => {
        useInventoryStore.setState({ consumables: {} });
    });

    it('returns not-protected and consumes nothing when no protection is held', () => {
        seed({ hp_potion_sm: 3 });
        const r = consumeDeathProtection();
        expect(r.isProtected).toBe(false);
        expect(r.consumedId).toBeNull();
        expect(useInventoryStore.getState().consumables.hp_potion_sm).toBe(3);
    });

    it('consumes ONE death_protection elixir when present', () => {
        seed({ death_protection: 2 });
        const r = consumeDeathProtection();
        expect(r.isProtected).toBe(true);
        expect(r.consumedId).toBe('death_protection');
        expect(useInventoryStore.getState().consumables.death_protection).toBe(1);
    });

    it('falls back to the amulet of loss when no elixir is held', () => {
        seed({ amulet_of_loss: 1 });
        const r = consumeDeathProtection();
        expect(r.isProtected).toBe(true);
        expect(r.consumedId).toBe('amulet_of_loss');
        expect(useInventoryStore.getState().consumables.amulet_of_loss).toBe(0);
    });

    it('prefers the elixir and leaves the amulet untouched when both are held', () => {
        seed({ death_protection: 1, amulet_of_loss: 1 });
        const r = consumeDeathProtection();
        expect(r.consumedId).toBe('death_protection');
        const c = useInventoryStore.getState().consumables;
        expect(c.death_protection).toBe(0);
        expect(c.amulet_of_loss).toBe(1);
    });
});

describe('deathProtection › hasDeathProtection', () => {
    beforeEach(() => {
        useInventoryStore.setState({ consumables: {} });
    });

    it('is false with no protection and does not consume on check', () => {
        seed({ death_protection: 0, amulet_of_loss: 0 });
        expect(hasDeathProtection()).toBe(false);
    });

    it('is true (non-consuming) when either item is held', () => {
        seed({ amulet_of_loss: 1 });
        expect(hasDeathProtection()).toBe(true);
        expect(useInventoryStore.getState().consumables.amulet_of_loss).toBe(1);
    });
});
