import { useEffect, useRef } from 'react';
import { useCharacterStore } from '../stores/characterStore';
import { useCombatStore } from '../stores/combatStore';
import { useSkillStore } from '../stores/skillStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { getTrainingBonuses } from '../systems/skillSystem';
import { getTotalEquipmentStats, flattenItemsData } from '../systems/itemSystem';
import itemsRaw from '../data/items.json';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

/**
 * Hard cap: regen can never exceed this percentage of effective max per second.
 * Prevents immortality at very high training/gear levels.
 */
const MAX_REGEN_PCT = 0.05; // 5% of max per second
const TICK_MS = 1000;

// Fractional accumulators so sub-1 regen values (e.g. 0.1/s) still apply over time.
let hpRegenAccumulator = 0;
let mpRegenAccumulator = 0;

/**
 * Passively regenerates HP and MP every second.
 *
 * Regen is PURELY flat-based:
 *   total = character.hp_regen (base, starts at 0) + training bonus + equipment bonus
 *
 * There is NO percentage-based baseline. If the stat shows 0.0/s, regeneration
 * is truly zero. Players must train hp_regen / mp_regen or equip items to gain
 * any passive healing.
 *
 * • In combat  → writes to `combatStore.playerCurrentHp/Mp` via heal helpers.
 * • Out of combat → writes directly to `character.hp/mp` via `updateCharacter`.
 */
export const useMpRegen = (): void => {
    const tickRef = useRef<() => void>(() => undefined);

    const doTick = () => {
        const charStore = useCharacterStore.getState();
        const char = charStore.character;
        if (!char) return;

        // Equipment + training bonuses
        const { skillLevels } = useSkillStore.getState();
        const tb = getTrainingBonuses(skillLevels, char.class);
        const { equipment } = useInventoryStore.getState();
        let eqHp = 0;
        let eqMp = 0;
        try {
            const eqStats = getTotalEquipmentStats(equipment, ALL_ITEMS);
            eqHp = eqStats.hp ?? 0;
            eqMp = eqStats.mp ?? 0;
        } catch {
            /* ignore */
        }

        const effectiveMaxHp = Math.max(1, char.max_hp + eqHp + tb.max_hp);
        const effectiveMaxMp = Math.max(1, char.max_mp + eqMp + tb.max_mp);

        // Flat regen from base stat + training + equipment
        const hpRegenFlat = (char.hp_regen ?? 0) + (tb.hp_regen ?? 0);
        const mpRegenFlat = (char.mp_regen ?? 0) + (tb.mp_regen ?? 0);

        // Cap at MAX_REGEN_PCT of effective max
        const hpRegenCapped = Math.min(effectiveMaxHp * MAX_REGEN_PCT, hpRegenFlat);
        const mpRegenCapped = Math.min(effectiveMaxMp * MAX_REGEN_PCT, mpRegenFlat);

        // Accumulate fractional amounts (e.g. 0.1/s → heals 1 HP every 10 seconds)
        let hpRegen = 0;
        if (hpRegenCapped > 0) {
            hpRegenAccumulator += hpRegenCapped;
            if (hpRegenAccumulator >= 1) {
                hpRegen = Math.floor(hpRegenAccumulator);
                hpRegenAccumulator -= hpRegen;
            }
        } else {
            hpRegenAccumulator = 0;
        }

        let mpRegen = 0;
        if (mpRegenCapped > 0) {
            mpRegenAccumulator += mpRegenCapped;
            if (mpRegenAccumulator >= 1) {
                mpRegen = Math.floor(mpRegenAccumulator);
                mpRegenAccumulator -= mpRegen;
            }
        } else {
            mpRegenAccumulator = 0;
        }

        // Nothing to regenerate
        if (hpRegen === 0 && mpRegen === 0) return;

        const combat = useCombatStore.getState();
        if (combat.phase === 'fighting') {
            // In combat – feed the combat store pool.
            if (hpRegen > 0 && combat.playerCurrentHp > 0 && combat.playerCurrentHp < effectiveMaxHp) {
                combat.healPlayerHp(hpRegen, effectiveMaxHp);
            }
            if (mpRegen > 0 && combat.playerCurrentMp < effectiveMaxMp) {
                combat.healPlayerMp(mpRegen, effectiveMaxMp);
            }
            return;
        }

        // Out of combat – refill character pool directly up to effective max.
        // Skip fully dead characters (hp=0) – respawn handles those.
        if ((char.hp ?? 0) <= 0 && (char.mp ?? 0) <= 0) return;

        const newHp = hpRegen > 0
            ? Math.min(effectiveMaxHp, Math.max(0, (char.hp ?? 0) + hpRegen))
            : (char.hp ?? 0);
        const newMp = mpRegen > 0
            ? Math.min(effectiveMaxMp, Math.max(0, (char.mp ?? 0) + mpRegen))
            : (char.mp ?? 0);

        if (newHp !== char.hp || newMp !== char.mp) {
            charStore.updateCharacter({ hp: newHp, mp: newMp });
        }
    };

    tickRef.current = doTick;

    useEffect(() => {
        const id = setInterval(() => tickRef.current(), TICK_MS);
        return () => clearInterval(id);
    }, []);
};
