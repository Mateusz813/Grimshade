import { useEffect, useRef } from 'react';
import { useLevelUpStore } from '../stores/levelUpStore';
import { useCharacterStore } from '../stores/characterStore';
import { getEffectiveChar } from '../systems/combatEngine';

export function useLevelUpRefill(
    active: boolean,
    onRefill: (maxHp: number, maxMp: number) => void,
): void {
    const event = useLevelUpStore((s) => s.event);
    const handledRef = useRef<typeof event>(null);

    useEffect(() => {
        if (!active) return;
        if (!event) return;
        if (handledRef.current === event) return;
        handledRef.current = event;

        const char = useCharacterStore.getState().character;
        if (!char) return;
        const eff = getEffectiveChar(char);
        const maxHp = eff?.max_hp ?? char.max_hp;
        const maxMp = eff?.max_mp ?? char.max_mp;
        onRefill(maxHp, maxMp);
    }, [active, event, onRefill]);
}
