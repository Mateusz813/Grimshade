// Shared class avatar registry.
// Returns a transform avatar (based on the highest completed transform) when
// available, otherwise the base class avatar. Used by Combat, Dungeon, Boss,
// Transform, Inventory and CharacterStats so an active transform's look is
// reflected everywhere.

import knightImg from '../assets/images/classes/knight.png';
import mageImg from '../assets/images/classes/mage.png';
import archerImg from '../assets/images/classes/archer.png';
import clericImg from '../assets/images/classes/cleric.png';
import bardImg from '../assets/images/classes/bard.png';
import rogueImg from '../assets/images/classes/rogue.png';
import necromancerImg from '../assets/images/classes/necromancer.png';

import knight1 from '../assets/images/classes/knight-1.png';
import knight2 from '../assets/images/classes/knight-2.png';
import knight3 from '../assets/images/classes/knight-3.png';
import knight4 from '../assets/images/classes/knight-4.png';
import knight5 from '../assets/images/classes/knight-5.png';
import knight6 from '../assets/images/classes/knight-6.png';
import knight7 from '../assets/images/classes/knight-7.png';
import knight8 from '../assets/images/classes/knight-8.png';
import knight9 from '../assets/images/classes/knight-9.png';
import knight10 from '../assets/images/classes/knight-10.png';
import knight11 from '../assets/images/classes/knight-11.png';

import mage1 from '../assets/images/classes/mage-1.png';
import mage2 from '../assets/images/classes/mage-2.png';
import mage3 from '../assets/images/classes/mage-3.png';
import mage4 from '../assets/images/classes/mage-4.png';
import mage5 from '../assets/images/classes/mage-5.png';
import mage6 from '../assets/images/classes/mage-6.png';
import mage7 from '../assets/images/classes/mage-7.png';
import mage8 from '../assets/images/classes/mage-8.png';
import mage9 from '../assets/images/classes/mage-9.png';
import mage10 from '../assets/images/classes/mage-10.png';
import mage11 from '../assets/images/classes/mage-11.png';

import archer1 from '../assets/images/classes/archer-1.png';
import archer2 from '../assets/images/classes/archer-2.png';
import archer3 from '../assets/images/classes/archer-3.png';
import archer4 from '../assets/images/classes/archer-4.png';
import archer5 from '../assets/images/classes/archer-5.png';
import archer6 from '../assets/images/classes/archer-6.png';
import archer7 from '../assets/images/classes/archer-7.png';
import archer8 from '../assets/images/classes/archer-8.png';
import archer9 from '../assets/images/classes/archer-9.png';
import archer10 from '../assets/images/classes/archer-10.png';
import archer11 from '../assets/images/classes/archer-11.png';

import cleric1 from '../assets/images/classes/cleric-1.png';
import cleric2 from '../assets/images/classes/cleric-2.png';
import cleric3 from '../assets/images/classes/cleric-3.png';
import cleric4 from '../assets/images/classes/cleric-4.png';
import cleric5 from '../assets/images/classes/cleric-5.png';
import cleric6 from '../assets/images/classes/cleric-6.png';
import cleric7 from '../assets/images/classes/cleric-7.png';
import cleric8 from '../assets/images/classes/cleric-8.png';
import cleric9 from '../assets/images/classes/cleric-9.png';
import cleric10 from '../assets/images/classes/cleric-10.png';
import cleric11 from '../assets/images/classes/cleric-11.png';

import rogue1 from '../assets/images/classes/rogue-1.png';
import rogue2 from '../assets/images/classes/rogue-2.png';
import rogue3 from '../assets/images/classes/rogue-3.png';
import rogue4 from '../assets/images/classes/rogue-4.png';
import rogue5 from '../assets/images/classes/rogue-5.png';
import rogue6 from '../assets/images/classes/rogue-6.png';
import rogue7 from '../assets/images/classes/rogue-7.png';
import rogue8 from '../assets/images/classes/rogue-8.png';
import rogue9 from '../assets/images/classes/rogue-9.png';
import rogue10 from '../assets/images/classes/rogue-10.png';
import rogue11 from '../assets/images/classes/rogue-11.png';

import necromancer1 from '../assets/images/classes/necromancer-1.png';
import necromancer2 from '../assets/images/classes/necromancer-2.png';
import necromancer3 from '../assets/images/classes/necromancer-3.png';
import necromancer4 from '../assets/images/classes/necromancer-4.png';
import necromancer5 from '../assets/images/classes/necromancer-5.png';
import necromancer6 from '../assets/images/classes/necromancer-6.png';
import necromancer7 from '../assets/images/classes/necromancer-7.png';
import necromancer8 from '../assets/images/classes/necromancer-8.png';
import necromancer9 from '../assets/images/classes/necromancer-9.png';
import necromancer10 from '../assets/images/classes/necromancer-10.png';
import necromancer11 from '../assets/images/classes/necromancer-11.png';

import bard1 from '../assets/images/classes/bard-1.png';
import bard2 from '../assets/images/classes/bard-2.png';
import bard3 from '../assets/images/classes/bard-3.png';
import bard4 from '../assets/images/classes/bard-4.png';
import bard5 from '../assets/images/classes/bard-5.png';
import bard6 from '../assets/images/classes/bard-6.png';
import bard7 from '../assets/images/classes/bard-7.png';
import bard8 from '../assets/images/classes/bard-8.png';
import bard9 from '../assets/images/classes/bard-9.png';
import bard10 from '../assets/images/classes/bard-10.png';
import bard11 from '../assets/images/classes/bard-11.png';

import { getHighestCompletedTransform } from '../systems/transformSystem';

/** Base avatar per class (no transform). */
export const BASE_CLASS_AVATARS: Record<string, string> = {
    Knight: knightImg,
    Mage: mageImg,
    Cleric: clericImg,
    Archer: archerImg,
    Rogue: rogueImg,
    Necromancer: necromancerImg,
    Bard: bardImg,
};

/** Transform avatars per class → transform id (1..11). */
export const TRANSFORM_AVATARS: Record<string, Record<number, string>> = {
    Knight: { 1: knight1, 2: knight2, 3: knight3, 4: knight4, 5: knight5, 6: knight6, 7: knight7, 8: knight8, 9: knight9, 10: knight10, 11: knight11 },
    Mage: { 1: mage1, 2: mage2, 3: mage3, 4: mage4, 5: mage5, 6: mage6, 7: mage7, 8: mage8, 9: mage9, 10: mage10, 11: mage11 },
    Cleric: { 1: cleric1, 2: cleric2, 3: cleric3, 4: cleric4, 5: cleric5, 6: cleric6, 7: cleric7, 8: cleric8, 9: cleric9, 10: cleric10, 11: cleric11 },
    Archer: { 1: archer1, 2: archer2, 3: archer3, 4: archer4, 5: archer5, 6: archer6, 7: archer7, 8: archer8, 9: archer9, 10: archer10, 11: archer11 },
    Rogue: { 1: rogue1, 2: rogue2, 3: rogue3, 4: rogue4, 5: rogue5, 6: rogue6, 7: rogue7, 8: rogue8, 9: rogue9, 10: rogue10, 11: rogue11 },
    Necromancer: { 1: necromancer1, 2: necromancer2, 3: necromancer3, 4: necromancer4, 5: necromancer5, 6: necromancer6, 7: necromancer7, 8: necromancer8, 9: necromancer9, 10: necromancer10, 11: necromancer11 },
    Bard: { 1: bard1, 2: bard2, 3: bard3, 4: bard4, 5: bard5, 6: bard6, 7: bard7, 8: bard8, 9: bard9, 10: bard10, 11: bard11 },
};

/**
 * Returns the correct avatar image URL for a character, using the highest
 * completed transform avatar when available, otherwise the base class avatar.
 */
export const getCharacterAvatar = (
    characterClass: string,
    completedTransformIds: number[] = [],
): string => {
    const highest = getHighestCompletedTransform(completedTransformIds);
    if (highest > 0) {
        const transformAvatar = TRANSFORM_AVATARS[characterClass]?.[highest];
        if (transformAvatar) return transformAvatar;
    }
    return BASE_CLASS_AVATARS[characterClass] ?? BASE_CLASS_AVATARS.Mage;
};
