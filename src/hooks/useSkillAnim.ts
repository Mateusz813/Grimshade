import { useCallback, useRef, useState } from 'react';
import { getSkillAnimation, type ISkillAnimation } from '../data/skillAnimations';

export interface ISkillAnimOverlay {
    id: number;
    anim: ISkillAnimation;
}

/**
 * Reusable skill animation overlay state. Used by Combat, Dungeon, Boss and
 * Transform views so a short visual effect plays whenever a skill is cast.
 */
export const useSkillAnim = () => {
    const [overlay, setOverlay] = useState<ISkillAnimOverlay | null>(null);
    const idRef = useRef(0);

    const trigger = useCallback((skillId: string): void => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        idRef.current += 1;
        const myId = idRef.current;
        setOverlay({ id: myId, anim: animData });
        setTimeout(() => {
            setOverlay((prev) => (prev?.id === myId ? null : prev));
        }, animData.duration);
    }, []);

    return { overlay, trigger };
};
