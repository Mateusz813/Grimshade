export type TCombatPhase = 'idle' | 'fighting' | 'victory' | 'dead';

export type TCombatSpeed = 'x1' | 'x2' | 'x4' | 'SKIP';

export interface ICombatParams {
    baseAtk: number;
    weaponAtk: number;
    skillBonus: number;
    classModifier: number;
    enemyDefense: number;
    isCrit?: boolean;
    isBlocked?: boolean;
    critChance?: number;
    blockChance?: number;
}

export interface ICombatResult {
    damage: number;
    isCrit: boolean;
    isBlocked: boolean;
    finalDamage: number;
}

export interface ICombatLogEntry {
    id: number;
    text: string;
    type: 'player' | 'monster' | 'crit' | 'system' | 'loot';
}

export interface ICombatState {
    phase: TCombatPhase;
    monster: import('./monster').IMonster | null;
    monsterCurrentHp: number;
    playerCurrentHp: number;
    playerCurrentMp: number;
    log: ICombatLogEntry[];
    earnedXp: number;
    earnedGold: number;
    selectedMonster: import('./monster').IMonster | null;
}
