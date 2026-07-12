import { useEffect, useRef } from 'react';
import { useCharacterStore } from '../stores/characterStore';
import { useCombatStore } from '../stores/combatStore';
import { useSkillStore } from '../stores/skillStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useAppRouteStore } from '../stores/appRouteStore';
import { getTrainingBonuses } from '../systems/skillSystem';
import { getTotalEquipmentStats, flattenItemsData } from '../systems/itemSystem';
import { getEffectiveChar } from '../systems/combatEngine';
import itemsRaw from '../data/items.json';

const ALL_ITEMS = flattenItemsData(itemsRaw as Parameters<typeof flattenItemsData>[0]);

const MAX_REGEN_PCT = 0.05;
const TICK_MS = 1000;

let hpRegenAccumulator = 0;
let mpRegenAccumulator = 0;

export const useMpRegen = (): void => {
    const tickRef = useRef<() => void>(() => undefined);

    const doTick = () => {
        if (useAppRouteStore.getState().isCharacterless) return;
        const charStore = useCharacterStore.getState();
        const char = charStore.character;
        if (!char) return;

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
        }

        const engineEff = getEffectiveChar(char);
        const effectiveMaxHp = Math.max(
            1,
            engineEff?.max_hp ?? (char.max_hp + eqHp + tb.max_hp),
        );
        const effectiveMaxMp = Math.max(
            1,
            engineEff?.max_mp ?? (char.max_mp + eqMp + tb.max_mp),
        );

        const hpRegenFlat = engineEff?.hp_regen ?? ((char.hp_regen ?? 0) + (tb.hp_regen ?? 0));
        const mpRegenFlat = engineEff?.mp_regen ?? ((char.mp_regen ?? 0) + (tb.mp_regen ?? 0));

        const hpRegenCapped = Math.min(effectiveMaxHp * MAX_REGEN_PCT, hpRegenFlat);
        const mpRegenCapped = Math.min(effectiveMaxMp * MAX_REGEN_PCT, mpRegenFlat);

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

        if (hpRegen === 0 && mpRegen === 0) return;

        const combat = useCombatStore.getState();
        if (combat.phase === 'fighting') {
            if (hpRegen > 0 && combat.playerCurrentHp > 0 && combat.playerCurrentHp < effectiveMaxHp) {
                combat.healPlayerHp(hpRegen, effectiveMaxHp);
            }
            return;
        }

        if (combat.phase === 'victory') {
            if (hpRegen > 0 && combat.playerCurrentHp > 0 && combat.playerCurrentHp < effectiveMaxHp) {
                combat.healPlayerHp(hpRegen, effectiveMaxHp);
            }
            return;
        }

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
