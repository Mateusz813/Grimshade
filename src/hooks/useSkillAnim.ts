import { useCallback, useRef, useState } from 'react';
import { getSkillAnimation, type ISkillAnimation } from '../data/skillAnimations';
import { getSkillIcon } from '../data/skillIcons';
import { isImageUrl } from '../systems/spriteAssets';

export interface ISkillAnimOverlay {
    id: number;
    anim: ISkillAnimation;
}

export const useSkillAnim = () => {
    const [overlay, setOverlay] = useState<ISkillAnimOverlay | null>(null);
    const idRef = useRef(0);

    const trigger = useCallback((skillId: string): void => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        idRef.current += 1;
        const myId = idRef.current;
        const ic = getSkillIcon(skillId);
        const emoji = isImageUrl(ic) ? ic : animData.emoji;
        setOverlay({ id: myId, anim: { ...animData, emoji } });
        setTimeout(() => {
            setOverlay((prev) => (prev?.id === myId ? null : prev));
        }, animData.duration);
    }, []);

    return { overlay, trigger };
};
