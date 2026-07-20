
import type { ReactNode } from 'react';
import type { TMonsterRarity } from '../../../systems/lootSystem';
import type { ICombatFloat, ICombatSkillAnim } from '../../../hooks/useCombatFx';

export type { ICombatFloat, ICombatSkillAnim };

export interface ICombatEnemy {
    id: string;
    name: string;
    level: number;
    sprite: string;
    kind?: 'monster' | 'boss';
    imageUrl?: string | null;
    imageObjectFit?: 'cover' | 'contain';
    currentHp: number;
    maxHp: number;
    currentMp?: number;
    maxMp?: number;
    rarity: TMonsterRarity;
    isDead: boolean;
    isTargetedByPlayer: boolean;
    isHit?: boolean;
    hitPulse?: number;
    attackingClassName?: string | null;
    floats?: ICombatFloat[];
    statusOverlay?: {
        stunMs?: number;
        paralyzeMs?: number;
        immortalMs?: number;
        markHealToDmgMs?: number;
        markAmpMs?: number;
        markAmpMult?: number;
        darkRitualMs?: number;
        darkRitualPct?: number;
        markAmpAllMs?: number;
        markAmpAllMult?: number;
        enemyAtkDownMs?: number;
        enemyAtkDownPct?: number;
        enemyNoHealMs?: number;
    };
}

export interface ICombatAlly {
    id: string;
    name: string;
    avatarUrl: string;
    accentColor: string;
    className: string;
    currentHp: number;
    maxHp: number;
    currentMp: number;
    maxMp: number;
    isDead: boolean;
    isPlayer: boolean;
    isBot?: boolean;
    level?: number;
    aggroCount: number;
    isHit?: boolean;
    hitPulse?: number;
    attackingClassName?: string | null;
    transformTier?: number;
    skillAnim?: ICombatSkillAnim | null;
    floats?: ICombatFloat[];
    summonCount?: number;
    summonsByType?: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>>;
    onSummonClick?: (type: 'skeleton' | 'ghost' | 'demon' | 'lich') => void;
    summonSpawn?: { id: number; type: 'skeleton' | 'ghost' | 'demon' | 'lich' } | null;
}

export interface ICombatSkillSlot {
    id: string;
    icon: string;
    name: string;
    mpCost: number;
    cooldownProgress: number;
    cooldownRemainingMs?: number;
    disabled: boolean;
    onClick: () => void;
}

export interface ICombatPotionSlot {
    kind: 'hp' | 'mp' | 'pct-hp' | 'pct-mp';
    icon?: string;
    count: number;
    cooldownProgress: number;
    cooldownRemainingMs?: number;
    disabled: boolean;
    onClick: () => void;
}

export interface ICombatActiveQuest {
    id: string;
    kind: 'task' | 'quest';
    label: string;
    progress: number;
    goal: number;
    completed: boolean;
}

export type TExitConfig =
    | { kind: 'hunt-popup'; onOpenDialog: () => void }
    | { kind: 'flee'; onFlee: () => void };

export type TSlotNode = ReactNode | null | undefined;
