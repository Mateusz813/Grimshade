import { useBuffStore } from '../stores/buffStore';


export const getAtkDamageMultiplier = (): number => {
    const b = useBuffStore.getState();
    if (b.hasBuff('atk_dmg_100')) return 2.0;
    if (b.hasBuff('atk_dmg_50')) return 1.5;
    if (b.hasBuff('atk_dmg_25')) return 1.25;
    return 1.0;
};

export const getSpellDamageMultiplier = (): number => {
    const b = useBuffStore.getState();
    if (b.hasBuff('spell_dmg_100')) return 2.0;
    if (b.hasBuff('spell_dmg_50')) return 1.5;
    if (b.hasBuff('spell_dmg_25')) return 1.25;
    return 1.0;
};

export const getElixirHpBonus = (): number => {
    return useBuffStore.getState().hasBuff('hp_boost_500') ? 500 : 0;
};

export const getElixirMpBonus = (): number => {
    return useBuffStore.getState().hasBuff('mp_boost_500') ? 500 : 0;
};

export const getElixirHpPctMultiplier = (): number => {
    return useBuffStore.getState().hasBuff('hp_pct_25') ? 1.25 : 1.0;
};

export const getElixirMpPctMultiplier = (): number => {
    return useBuffStore.getState().hasBuff('mp_pct_25') ? 1.25 : 1.0;
};

export const getElixirAtkBonus = (): number => {
    return useBuffStore.getState().hasBuff('atk_boost_50') ? 50 : 0;
};

export const getElixirDefBonus = (): number => {
    return useBuffStore.getState().hasBuff('def_boost_50') ? 50 : 0;
};

export const getElixirAttackSpeedMultiplier = (): number => {
    return useBuffStore.getState().hasBuff('attack_speed') ? 1.20 : 1.0;
};

const ALWAYS_DRAIN: string[] = [
    'hp_boost_500',
    'mp_boost_500',
    'atk_boost_50',
    'def_boost_50',
    'hp_pct_25',
    'mp_pct_25',
    'attack_speed',
];

const ATK_TIERS_HIGH_FIRST: string[] = ['atk_dmg_100', 'atk_dmg_50', 'atk_dmg_25'];
const SPELL_TIERS_HIGH_FIRST: string[] = ['spell_dmg_100', 'spell_dmg_50', 'spell_dmg_25'];

export const tickCombatElixirs = (ms: number): void => {
    const b = useBuffStore.getState();
    for (const effect of ALWAYS_DRAIN) {
        if (b.hasBuff(effect)) b.consumePausableTime(effect, ms);
    }
    for (const group of [ATK_TIERS_HIGH_FIRST, SPELL_TIERS_HIGH_FIRST]) {
        for (const effect of group) {
            if (b.hasBuff(effect)) {
                b.consumePausableTime(effect, ms);
                break;
            }
        }
    }
};
