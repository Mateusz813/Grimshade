import { useInventoryStore } from '../stores/inventoryStore';
import { getSkillIcon } from '../data/skillIcons';

export const CLASS_MODIFIER: Record<string, number> = {
    Knight: 1.0, Mage: 1.3, Cleric: 1.0,
    Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};

export const rollWeaponDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

export const formatSkillName = (id: string | null): string => {
    if (!id) return '—';
    const name = id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${getSkillIcon(id)} ${name}`;
};
