import { useInventoryStore } from '../stores/inventoryStore';


export type TDeathProtectionId = 'death_protection' | 'amulet_of_loss';

export interface IDeathProtectionResult {
    isProtected: boolean;
    consumedId: TDeathProtectionId | null;
}

export const hasDeathProtection = (): boolean => {
    const c = useInventoryStore.getState().consumables;
    return (c['death_protection'] ?? 0) > 0 || (c['amulet_of_loss'] ?? 0) > 0;
};

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
