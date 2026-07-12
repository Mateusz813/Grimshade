import { useCallback, useRef, useState } from 'react';
import { getSkillAnimation } from '../data/skillAnimations';
import { getSkillIcon } from '../data/skillIcons';
import { isImageUrl } from '../systems/spriteAssets';


export type TFloatKind =
    | 'basic'
    | 'spell'
    | 'ally-basic'
    | 'ally-spell'
    | 'monster'
    | 'monster-spell'
    | 'damage'
    | 'heal';

export interface ICombatFloat {
    id: number;
    value: number;
    kind: TFloatKind;
    isCrit?: boolean;
    icon?: string;
    label?: string;
}

export interface ICombatSkillAnim {
    id: number;
    emoji: string;
    cssClass: string;
}

export interface ICombatSummonSpawn {
    id: number;
    type: 'skeleton' | 'ghost' | 'demon' | 'lich';
}

const FLOAT_LIFETIME_MS = 1500;

export const useCombatFx = () => {
    const [enemyFloats, setEnemyFloats] = useState<Record<number, ICombatFloat[]>>({});
    const [allyFloats,  setAllyFloats]  = useState<Record<number, ICombatFloat[]>>({});
    const [enemySkill,  setEnemySkill]  = useState<Record<number, ICombatSkillAnim>>({});
    const [allySkill,   setAllySkill]   = useState<Record<number, ICombatSkillAnim>>({});
    const [allySummonSpawn, setAllySummonSpawn] = useState<Record<number, ICombatSummonSpawn>>({});
    const idRef = useRef(0);

    const nextId = () => ++idRef.current;

    const pushEnemyFloat = useCallback(
        (slot: number, value: number, kind: TFloatKind, opts?: { isCrit?: boolean; icon?: string; label?: string }) => {
            const id = nextId();
            const float: ICombatFloat = { id, value, kind, isCrit: opts?.isCrit, icon: opts?.icon, label: opts?.label };
            setEnemyFloats((prev) => ({
                ...prev,
                [slot]: [...(prev[slot] ?? []), float],
            }));
            window.setTimeout(() => {
                setEnemyFloats((prev) => {
                    const list = prev[slot];
                    if (!list) return prev;
                    const next = list.filter((f) => f.id !== id);
                    return { ...prev, [slot]: next };
                });
            }, FLOAT_LIFETIME_MS);
        },
        [],
    );

    const pushAllyFloat = useCallback(
        (slot: number, value: number, kind: TFloatKind, opts?: { isCrit?: boolean; icon?: string; label?: string }) => {
            const id = nextId();
            const float: ICombatFloat = { id, value, kind, isCrit: opts?.isCrit, icon: opts?.icon, label: opts?.label };
            setAllyFloats((prev) => ({
                ...prev,
                [slot]: [...(prev[slot] ?? []), float],
            }));
            window.setTimeout(() => {
                setAllyFloats((prev) => {
                    const list = prev[slot];
                    if (!list) return prev;
                    const next = list.filter((f) => f.id !== id);
                    return { ...prev, [slot]: next };
                });
            }, FLOAT_LIFETIME_MS);
        },
        [],
    );

    const resolveAnimEmoji = (skillId: string, fallback: string): string => {
        const ic = getSkillIcon(skillId);
        return isImageUrl(ic) ? ic : fallback;
    };
    const triggerEnemySkillAnim = useCallback((slot: number, skillId: string): void => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        const id = nextId();
        const emoji = resolveAnimEmoji(skillId, animData.emoji);
        const next: ICombatSkillAnim = { id, emoji, cssClass: animData.cssClass };
        setEnemySkill((prev) => ({ ...prev, [slot]: next }));
        window.setTimeout(() => {
            setEnemySkill((prev) => (prev[slot]?.id === id ? { ...prev, [slot]: undefined as unknown as ICombatSkillAnim } : prev));
        }, animData.duration);
    }, []);

    const triggerAllySkillAnim = useCallback((slot: number, skillId: string): void => {
        const animData = getSkillAnimation(skillId);
        if (!animData) return;
        const id = nextId();
        const emoji = resolveAnimEmoji(skillId, animData.emoji);
        const next: ICombatSkillAnim = { id, emoji, cssClass: animData.cssClass };
        setAllySkill((prev) => ({ ...prev, [slot]: next }));
        window.setTimeout(() => {
            setAllySkill((prev) => (prev[slot]?.id === id ? { ...prev, [slot]: undefined as unknown as ICombatSkillAnim } : prev));
        }, animData.duration);
    }, []);

    const SUMMON_SPAWN_MS = 2000;
    const triggerAllySummonSpawn = useCallback((slot: number, type: 'skeleton' | 'ghost' | 'demon' | 'lich'): void => {
        const id = nextId();
        const next: ICombatSummonSpawn = { id, type };
        setAllySummonSpawn((prev) => ({ ...prev, [slot]: next }));
        window.setTimeout(() => {
            setAllySummonSpawn((prev) => (prev[slot]?.id === id ? { ...prev, [slot]: undefined as unknown as ICombatSummonSpawn } : prev));
        }, SUMMON_SPAWN_MS);
    }, []);

    const resetFx = useCallback(() => {
        setEnemyFloats({});
        setAllyFloats({});
        setEnemySkill({});
        setAllySkill({});
        setAllySummonSpawn({});
    }, []);

    const resetAllyFx = useCallback(() => {
        setAllyFloats({});
        setAllySkill({});
        setAllySummonSpawn({});
    }, []);

    return {
        enemyFloats,
        allyFloats,
        enemySkill,
        allySkill,
        allySummonSpawn,
        pushEnemyFloat,
        pushAllyFloat,
        triggerEnemySkillAnim,
        triggerAllySkillAnim,
        triggerAllySummonSpawn,
        resetFx,
        resetAllyFx,
    };
};
