import { useCallback, useRef, useState } from 'react';
import { getSkillAnimation, type ISkillAnimation } from '../data/skillAnimations';
import { getSkillIcon } from '../data/skillIcons';
import { isImageUrl } from '../systems/spriteAssets';

export interface ISkillAnimOverlay {
    id: number;
    anim: ISkillAnimation;
}

/**
 * Reusable skill animation overlay state. Used by Combat, Dungeon, Boss and
 * Transform views so a short visual effect plays whenever a skill is cast.
 *
 * The overlay's `anim.emoji` is swapped for the per-class spell artwork
 * URL (e.g. archer-1.png) when one is registered. The render sites then
 * branch on `isImageUrl(emoji)` to draw an `<img>` instead of a glyph,
 * so the actual spell image flies across the screen during casts.
 * Falls back to the legacy emoji if the PNG isn't available yet.
 */
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
