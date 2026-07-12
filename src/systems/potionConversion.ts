import { getPotionImage } from './spriteAssets';
import { getPotionMinLevel } from './potionGating';

const PI = (id: string, fallback: string): string => getPotionImage(id) ?? fallback;


export interface IPotionConversion {
    tier: number;
    family: 'hp' | 'mp';
    inputId: string;
    inputName: string;
    inputIcon: string;
    inputCount: number;
    outputId: string;
    outputName: string;
    outputIcon: string;
    outputMinLevel: number;
}

const RAW_POTION_CONVERSIONS: IPotionConversion[] = [
    {
        tier: 1, family: 'hp',
        inputId: 'hp_potion_sm', inputName: 'Maly Eliksir HP', inputIcon: PI('hp_potion_sm', 'red-heart'),
        inputCount: 5,
        outputId: 'hp_potion_md', outputName: 'Eliksir HP', outputIcon: PI('hp_potion_md', 'red-heart'),
        outputMinLevel: 20,
    },
    {
        tier: 2, family: 'hp',
        inputId: 'hp_potion_md', inputName: 'Eliksir HP', inputIcon: PI('hp_potion_md', 'red-heart'),
        inputCount: 4,
        outputId: 'hp_potion_lg', outputName: 'Silny Eliksir HP', outputIcon: PI('hp_potion_lg', 'red-heart'),
        outputMinLevel: 50,
    },
    {
        tier: 3, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: PI('hp_potion_lg', 'red-heart'),
        inputCount: 334,
        outputId: 'hp_potion_great', outputName: 'Wielki Eliksir HP', outputIcon: PI('hp_potion_great', 'red-heart'),
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'hp',
        inputId: 'hp_potion_great', inputName: 'Wielki Eliksir HP', inputIcon: PI('hp_potion_great', 'red-heart'),
        inputCount: 2,
        outputId: 'hp_potion_super', outputName: 'Super Eliksir HP', outputIcon: PI('hp_potion_super', 'red-heart'),
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'hp',
        inputId: 'hp_potion_super', inputName: 'Super Eliksir HP', inputIcon: PI('hp_potion_super', 'red-heart'),
        inputCount: 2,
        outputId: 'hp_potion_ultimate', outputName: 'Ultimatywny Eliksir HP', outputIcon: PI('hp_potion_ultimate', 'red-heart'),
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'hp',
        inputId: 'hp_potion_ultimate', inputName: 'Ultimatywny Eliksir HP', inputIcon: PI('hp_potion_ultimate', 'red-heart'),
        inputCount: 2,
        outputId: 'hp_potion_divine', outputName: 'Boski Eliksir HP', outputIcon: PI('hp_potion_divine', 'red-heart'),
        outputMinLevel: 600,
    },
    {
        tier: 7, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: PI('hp_potion_lg', 'red-heart'),
        inputCount: 25,
        outputId: 'hp_potion_mega', outputName: 'Mega Eliksir HP', outputIcon: PI('hp_potion_mega', 'heart-on-fire'),
        outputMinLevel: 100,
    },
    {
        tier: 1, family: 'mp',
        inputId: 'mp_potion_sm', inputName: 'Maly Eliksir MP', inputIcon: PI('mp_potion_sm', 'droplet'),
        inputCount: 5,
        outputId: 'mp_potion_md', outputName: 'Eliksir MP', outputIcon: PI('mp_potion_md', 'droplet'),
        outputMinLevel: 20,
    },
    {
        tier: 2, family: 'mp',
        inputId: 'mp_potion_md', inputName: 'Eliksir MP', inputIcon: PI('mp_potion_md', 'droplet'),
        inputCount: 4,
        outputId: 'mp_potion_lg', outputName: 'Silny Eliksir MP', outputIcon: PI('mp_potion_lg', 'droplet'),
        outputMinLevel: 50,
    },
    {
        tier: 3, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: PI('mp_potion_lg', 'droplet'),
        inputCount: 334,
        outputId: 'mp_potion_great', outputName: 'Wielki Eliksir MP', outputIcon: PI('mp_potion_great', 'droplet'),
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'mp',
        inputId: 'mp_potion_great', inputName: 'Wielki Eliksir MP', inputIcon: PI('mp_potion_great', 'droplet'),
        inputCount: 2,
        outputId: 'mp_potion_super', outputName: 'Super Eliksir MP', outputIcon: PI('mp_potion_super', 'droplet'),
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'mp',
        inputId: 'mp_potion_super', inputName: 'Super Eliksir MP', inputIcon: PI('mp_potion_super', 'droplet'),
        inputCount: 2,
        outputId: 'mp_potion_ultimate', outputName: 'Ultimatywny Eliksir MP', outputIcon: PI('mp_potion_ultimate', 'droplet'),
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'mp',
        inputId: 'mp_potion_ultimate', inputName: 'Ultimatywny Eliksir MP', inputIcon: PI('mp_potion_ultimate', 'droplet'),
        inputCount: 2,
        outputId: 'mp_potion_divine', outputName: 'Boski Eliksir MP', outputIcon: PI('mp_potion_divine', 'droplet'),
        outputMinLevel: 600,
    },
    {
        tier: 7, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: PI('mp_potion_lg', 'droplet'),
        inputCount: 25,
        outputId: 'mp_potion_mega', outputName: 'Mega Eliksir MP', outputIcon: PI('mp_potion_mega', 'gem-stone'),
        outputMinLevel: 100,
    },
];

const FAMILY_ORDER: Record<IPotionConversion['family'], number> = { hp: 0, mp: 1 };

export const POTION_CONVERSIONS: IPotionConversion[] = RAW_POTION_CONVERSIONS
    .map((c) => ({
        ...c,
        outputMinLevel: getPotionMinLevel(c.outputId),
    }))
    .sort((a, b) =>
        FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family]
        || a.outputMinLevel - b.outputMinLevel
        || a.tier - b.tier,
    );

export const getMaxConversions = (
    conv: IPotionConversion,
    ownedInput: number,
): number => Math.floor(ownedInput / conv.inputCount);

export interface IConversionAvailability {
    canConvert: boolean;
    maxBatches: number;
    levelLocked: boolean;
    requiredLevel: number;
}

export const checkConversionAvailability = (
    conv: IPotionConversion,
    ownedInput: number,
    characterLevel: number = Number.POSITIVE_INFINITY,
): IConversionAvailability => {
    const maxBatches = getMaxConversions(conv, ownedInput);
    const requiredLevel = getPotionMinLevel(conv.outputId);
    const levelLocked = characterLevel < requiredLevel;
    return { canConvert: !levelLocked && maxBatches > 0, maxBatches, levelLocked, requiredLevel };
};
