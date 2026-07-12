
import { describe, it, expect } from 'vitest';
import skillsData from '../data/skills.json';
import {
    castSkill,
    newCombatEffectsSession,
    type ICombatEffectsSession,
} from './combatEffectsHelpers';

interface IActiveSkillRow {
    id: string;
    name_pl: string;
    name_en: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
    goldCost: number;
}

type ClassKey = 'knight' | 'mage' | 'cleric' | 'archer' | 'rogue' | 'necromancer' | 'bard';

const ACTIVE = skillsData.activeSkills as Record<ClassKey, IActiveSkillRow[]>;
const SHIELD_BASH = ACTIVE.knight.find((s) => s.id === 'shield_bash')!;
if (!SHIELD_BASH) throw new Error('shield_bash missing from skills.json - test setup broken');
if (SHIELD_BASH.effect !== 'stun:3000') {
    throw new Error(`shield_bash.effect changed to "${SHIELD_BASH.effect}" - test assumptions broken`);
}


interface ICombatTypeCase {
    name: string;
    playerId: string;
    targetId: string;
    allyIds: string[];
    enemyIds: string[];
    targetHpPct: number;
}

const CASES: ReadonlyArray<ICombatTypeCase> = [
    {
        name: 'hunting (solo + 1 wave monster)',
        playerId: 'r11d_hunt_player',
        targetId: 'r11d_hunt_m_0_rat',
        allyIds: ['r11d_hunt_player'],
        enemyIds: ['r11d_hunt_m_0_rat'],
        targetHpPct: 100,
    },
    {
        name: 'hunting (player + 3 bots vs 1 monster)',
        playerId: 'r11d_hunt_player',
        targetId: 'r11d_hunt_m_0_goblin',
        allyIds: ['r11d_hunt_player', 'r11d_hunt_bot_1', 'r11d_hunt_bot_2', 'r11d_hunt_bot_3'],
        enemyIds: ['r11d_hunt_m_0_goblin'],
        targetHpPct: 100,
    },
    {
        name: 'dungeon (player + 3 bots vs single stage enemy)',
        playerId: 'r11d_dungeon_player',
        targetId: 'r11d_dungeon_mob_0',
        allyIds: ['r11d_dungeon_player', 'r11d_dungeon_bot_1', 'r11d_dungeon_bot_2', 'r11d_dungeon_bot_3'],
        enemyIds: ['r11d_dungeon_mob_0'],
        targetHpPct: 100,
    },
    {
        name: 'raid (player + 3 bots vs single boss)',
        playerId: 'r11d_raid_player',
        targetId: 'r11d_raid_boss',
        allyIds: ['r11d_raid_player', 'r11d_raid_bot_1', 'r11d_raid_bot_2', 'r11d_raid_bot_3'],
        enemyIds: ['r11d_raid_boss'],
        targetHpPct: 100,
    },
    {
        name: 'boss (player + 3 bots vs single boss)',
        playerId: 'r11d_boss_player',
        targetId: 'r11d_boss_target',
        allyIds: ['r11d_boss_player', 'r11d_boss_bot_1', 'r11d_boss_bot_2', 'r11d_boss_bot_3'],
        enemyIds: ['r11d_boss_target'],
        targetHpPct: 100,
    },
    {
        name: 'transform (solo, no bots, vs single monster)',
        playerId: 'r11d_transform_player',
        targetId: 'r11d_transform_target',
        allyIds: ['r11d_transform_player'],
        enemyIds: ['r11d_transform_target'],
        targetHpPct: 100,
    },
    {
        name: 'arena (solo vs single opponent)',
        playerId: 'r11d_arena_player',
        targetId: 'r11d_arena_opponent',
        allyIds: ['r11d_arena_player'],
        enemyIds: ['r11d_arena_opponent'],
        targetHpPct: 100,
    },
    {
        name: 'trainer (solo vs immortal dummy)',
        playerId: 'r11d_trainer_player',
        targetId: 'r11d_trainer_dummy',
        allyIds: ['r11d_trainer_player'],
        enemyIds: ['r11d_trainer_dummy'],
        targetHpPct: 100,
    },
    {
        name: 'loch (4-person party vs guild boss)',
        playerId: 'r11d_loch_player',
        targetId: 'r11d_loch_boss',
        allyIds: ['r11d_loch_player', 'r11d_loch_member_2', 'r11d_loch_member_3', 'r11d_loch_member_4'],
        enemyIds: ['r11d_loch_boss'],
        targetHpPct: 100,
    },
];

describe('castSkill: shield_bash (stun:3000) lands on every combat type', () => {
    for (const cs of CASES) {
        it(`${cs.name}: cast succeeds + target gets stunMs>=3000 + stunApplied=true`, () => {
            const session: ICombatEffectsSession = newCombatEffectsSession();

            const result = castSkill({
                session,
                casterId: cs.playerId,
                targetId: cs.targetId,
                targetHpPct: cs.targetHpPct,
                effect: SHIELD_BASH.effect,
                allyIds: cs.allyIds,
                enemyIds: cs.enemyIds,
            });

            expect(result).toBeDefined();
            expect(result.stunApplied).toBe(true);
            const targetStatus = session.statuses.get(cs.targetId);
            expect(targetStatus, `target ${cs.targetId} status not initialised`).toBeDefined();
            expect(targetStatus!.stunMs).toBe(3000);
            expect(result.aoe).toBe(false);
            expect(result.aoeStunIdxs).toEqual([]);
            expect(result.castDmgMult).toBeGreaterThanOrEqual(1);
            expect(result.castDmgMult).toBeLessThanOrEqual(1.01);
            expect(result.summons).toEqual([]);
            expect(result.instantKill).toBe(false);
            expect(result.executeBurstPct).toBe(0);
            expect(result.healCasterPctOfMaxHp).toBe(0);
        });
    }

    it('every cast creates a status entry for the caster (ensureStatus path)', () => {
        for (const cs of CASES) {
            const session = newCombatEffectsSession();
            castSkill({
                session,
                casterId: cs.playerId,
                targetId: cs.targetId,
                targetHpPct: cs.targetHpPct,
                effect: SHIELD_BASH.effect,
                allyIds: cs.allyIds,
                enemyIds: cs.enemyIds,
            });
            const casterStatus = session.statuses.get(cs.playerId);
            expect(casterStatus, `caster ${cs.playerId} status missing in ${cs.name}`).toBeDefined();
        }
    });
});
