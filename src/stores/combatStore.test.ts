import { describe, it, expect, beforeEach } from 'vitest';
import { useCombatStore, MAX_WAVE_MONSTERS, type IMonster } from './combatStore';
import type { TMonsterRarity } from '../systems/lootSystem';
import type { IDropDisplay, ICombatEvent } from '../systems/combatEngine';

// -- Fixtures ----------------------------------------------------------------

const makeMonster = (overrides: Partial<IMonster> = {}): IMonster => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    level: 1,
    hp: 30,
    attack: 7,
    defense: 2,
    speed: 5,
    xp: 3,
    gold: [1, 1],
    dropTable: [],
    sprite: 'rat',
    ...overrides,
});

const makeDrop = (overrides: Partial<IDropDisplay> = {}): IDropDisplay => ({
    icon: 'crossed-swords',
    name: 'Sword',
    rarity: 'common',
    ...overrides,
});

// -- Helpers -----------------------------------------------------------------

const resetStore = (): void => {
    useCombatStore.getState().resetCombat();
};

// -- Tests -------------------------------------------------------------------

describe('combatStore — initial state', () => {
    beforeEach(resetStore);

    it('starts in idle phase with no monster', () => {
        const s = useCombatStore.getState();
        expect(s.phase).toBe('idle');
        expect(s.monster).toBeNull();
        expect(s.monsterCurrentHp).toBe(0);
        expect(s.monsterMaxHp).toBe(0);
        expect(s.log).toEqual([]);
        expect(s.waveMonsters).toEqual([]);
    });

    it('has empty session kill tally', () => {
        const s = useCombatStore.getState();
        expect(s.sessionKills).toEqual({
            normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0,
        });
    });

    it('defaults autoFight to true and wavePlannedCount to 1', () => {
        const s = useCombatStore.getState();
        expect(s.autoFight).toBe(true);
        expect(s.wavePlannedCount).toBe(1);
    });
});

describe('combatStore — setPhase', () => {
    beforeEach(resetStore);

    it('transitions to fighting', () => {
        useCombatStore.getState().setPhase('fighting');
        expect(useCombatStore.getState().phase).toBe('fighting');
    });

    it('transitions to victory', () => {
        useCombatStore.getState().setPhase('victory');
        expect(useCombatStore.getState().phase).toBe('victory');
    });

    it('transitions to dead', () => {
        useCombatStore.getState().setPhase('dead');
        expect(useCombatStore.getState().phase).toBe('dead');
    });

    it('returns to idle from any phase', () => {
        useCombatStore.getState().setPhase('victory');
        useCombatStore.getState().setPhase('idle');
        expect(useCombatStore.getState().phase).toBe('idle');
    });
});

describe('combatStore — setSelectedMonster (setMonster equivalent)', () => {
    beforeEach(resetStore);

    it('stores the pre-selected monster', () => {
        const monster = makeMonster({ id: 'goblin' });
        useCombatStore.getState().setSelectedMonster(monster);
        expect(useCombatStore.getState().selectedMonster?.id).toBe('goblin');
    });

    it('accepts null to clear the selection', () => {
        useCombatStore.getState().setSelectedMonster(makeMonster());
        useCombatStore.getState().setSelectedMonster(null);
        expect(useCombatStore.getState().selectedMonster).toBeNull();
    });

    it('initCombat sets monster + monsterCurrentHp at full health', () => {
        const monster = makeMonster({ id: 'orc', hp: 120 });
        useCombatStore.getState().initCombat(monster, 100, 50, 'strong');
        const s = useCombatStore.getState();
        expect(s.phase).toBe('fighting');
        expect(s.monster?.id).toBe('orc');
        expect(s.monsterCurrentHp).toBe(120);
        expect(s.monsterMaxHp).toBe(120);
        expect(s.playerCurrentHp).toBe(100);
        expect(s.playerCurrentMp).toBe(50);
    });

    it('initCombat clamps negative HP/MP to 0', () => {
        useCombatStore.getState().initCombat(makeMonster(), -50, -10);
        const s = useCombatStore.getState();
        expect(s.playerCurrentHp).toBe(0);
        expect(s.playerCurrentMp).toBe(0);
    });
});

describe('combatStore — monsterRarity (setMonsterRarity via initCombat)', () => {
    beforeEach(resetStore);

    it('defaults to "normal" when omitted', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50);
        expect(useCombatStore.getState().monsterRarity).toBe('normal');
    });

    it.each<TMonsterRarity>(['normal', 'strong', 'epic', 'legendary', 'boss'])(
        'accepts rarity %s',
        (rarity) => {
            useCombatStore.getState().initCombat(makeMonster(), 100, 50, rarity);
            expect(useCombatStore.getState().monsterRarity).toBe(rarity);
        },
    );

    it('seeds the first wave monster with the same rarity', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50, 'epic');
        const wave = useCombatStore.getState().waveMonsters;
        expect(wave).toHaveLength(1);
        expect(wave[0].rarity).toBe('epic');
        expect(wave[0].isDead).toBe(false);
    });
});

describe('combatStore — recordKill / incrementSessionKill', () => {
    beforeEach(resetStore);

    it('increments the count for the given rarity', () => {
        useCombatStore.getState().incrementSessionKill('normal');
        useCombatStore.getState().incrementSessionKill('normal');
        useCombatStore.getState().incrementSessionKill('boss');
        const kills = useCombatStore.getState().sessionKills;
        expect(kills.normal).toBe(2);
        expect(kills.boss).toBe(1);
        expect(kills.strong).toBe(0);
    });

    it('treats each rarity tally independently', () => {
        useCombatStore.getState().incrementSessionKill('strong');
        useCombatStore.getState().incrementSessionKill('epic');
        useCombatStore.getState().incrementSessionKill('legendary');
        const kills = useCombatStore.getState().sessionKills;
        expect(kills.strong).toBe(1);
        expect(kills.epic).toBe(1);
        expect(kills.legendary).toBe(1);
        expect(kills.normal).toBe(0);
        expect(kills.boss).toBe(0);
    });
});

describe('combatStore — addSessionKill (addSessionStats)', () => {
    beforeEach(resetStore);

    it('accumulates session XP and gold', () => {
        useCombatStore.getState().addSessionStats(50, 10);
        useCombatStore.getState().addSessionStats(20, 5);
        const s = useCombatStore.getState();
        expect(s.sessionXpEarned).toBe(70);
        expect(s.sessionGoldEarned).toBe(15);
    });

    it('accepts 0 increments without affecting totals', () => {
        useCombatStore.getState().addSessionStats(100, 100);
        useCombatStore.getState().addSessionStats(0, 0);
        const s = useCombatStore.getState();
        expect(s.sessionXpEarned).toBe(100);
        expect(s.sessionGoldEarned).toBe(100);
    });
});

describe('combatStore — clearCombatSession', () => {
    beforeEach(resetStore);

    it('wipes session log, drops, and tallies', () => {
        useCombatStore.getState().addLog('hit', 'player');
        useCombatStore.getState().addSessionStats(100, 50);
        useCombatStore.getState().incrementSessionKill('normal');
        useCombatStore.getState().setLastDrops([makeDrop()]);
        useCombatStore.getState().clearCombatSession();
        const s = useCombatStore.getState();
        expect(s.sessionLog).toEqual([]);
        expect(s.lastDrops).toEqual([]);
        expect(s.sessionDrops).toEqual([]);
        expect(s.sessionXpEarned).toBe(0);
        expect(s.sessionGoldEarned).toBe(0);
        expect(s.sessionKills).toEqual({
            normal: 0, strong: 0, epic: 0, legendary: 0, boss: 0,
        });
    });

    it('preserves the current monster + phase (only session-tracking clears)', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50);
        useCombatStore.getState().clearCombatSession();
        const s = useCombatStore.getState();
        expect(s.phase).toBe('fighting');
        expect(s.monster).not.toBeNull();
    });

    it('resets sessionStartedAt to a fresh timestamp', () => {
        const oldStart = useCombatStore.getState().sessionStartedAt;
        // Force a small wait to guarantee Date.now() advances
        const before = Date.now();
        useCombatStore.getState().clearCombatSession();
        const newStart = useCombatStore.getState().sessionStartedAt;
        expect(newStart).toBeGreaterThanOrEqual(before);
        expect(newStart).toBeGreaterThanOrEqual(oldStart);
    });
});

describe('combatStore — dealToMonster / dealToPlayer / setHps', () => {
    beforeEach(resetStore);

    it('dealToMonster floors HP at 0 (no negatives)', () => {
        useCombatStore.getState().initCombat(makeMonster({ hp: 30 }), 100, 50);
        useCombatStore.getState().dealToMonster(9999);
        expect(useCombatStore.getState().monsterCurrentHp).toBe(0);
    });

    it('dealToMonster mirrors damage into the active wave monster', () => {
        useCombatStore.getState().initCombat(makeMonster({ hp: 30 }), 100, 50);
        useCombatStore.getState().dealToMonster(10);
        const s = useCombatStore.getState();
        expect(s.monsterCurrentHp).toBe(20);
        expect(s.waveMonsters[0].currentHp).toBe(20);
    });

    it('dealToPlayer floors HP at 0', () => {
        useCombatStore.getState().initCombat(makeMonster(), 50, 30);
        useCombatStore.getState().dealToPlayer(9999);
        expect(useCombatStore.getState().playerCurrentHp).toBe(0);
    });

    it('setHps clamps both monster and player HP to non-negative', () => {
        useCombatStore.getState().setHps(-5, -5);
        const s = useCombatStore.getState();
        expect(s.monsterCurrentHp).toBe(0);
        expect(s.playerCurrentHp).toBe(0);
    });
});

describe('combatStore — heal/spend helpers', () => {
    beforeEach(resetStore);

    it('healPlayerHp caps at maxHp', () => {
        useCombatStore.getState().initCombat(makeMonster(), 10, 50);
        useCombatStore.getState().healPlayerHp(9999, 100);
        expect(useCombatStore.getState().playerCurrentHp).toBe(100);
    });

    it('healPlayerHp rejects negative amounts (treats as 0)', () => {
        useCombatStore.getState().initCombat(makeMonster(), 50, 50);
        useCombatStore.getState().healPlayerHp(-20, 100);
        expect(useCombatStore.getState().playerCurrentHp).toBe(50);
    });

    it('healPlayerMp caps at maxMp', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 5);
        useCombatStore.getState().healPlayerMp(9999, 80);
        expect(useCombatStore.getState().playerCurrentMp).toBe(80);
    });

    it('spendPlayerMp floors at 0', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 5);
        useCombatStore.getState().spendPlayerMp(9999);
        expect(useCombatStore.getState().playerCurrentMp).toBe(0);
    });
});

describe('combatStore — addLog / bulkAddLog', () => {
    beforeEach(resetStore);

    it('adds a single log entry to both inline + session logs', () => {
        useCombatStore.getState().addLog('Atak za 10', 'player');
        const s = useCombatStore.getState();
        expect(s.log).toHaveLength(1);
        expect(s.log[0].text).toBe('Atak za 10');
        expect(s.log[0].type).toBe('player');
        expect(s.sessionLog).toHaveLength(1);
    });

    it('caps the inline log at 50 entries', () => {
        for (let i = 0; i < 60; i++) {
            useCombatStore.getState().addLog(`msg ${i}`, 'player');
        }
        expect(useCombatStore.getState().log).toHaveLength(50);
    });

    it('bulkAddLog appends multiple entries at once', () => {
        useCombatStore.getState().bulkAddLog([
            { text: 'a', type: 'player' },
            { text: 'b', type: 'monster' },
            { text: 'c', type: 'crit' },
        ]);
        expect(useCombatStore.getState().log).toHaveLength(3);
    });

    it('caps the session log at 1000 entries when entries come via addLog', () => {
        // Note: only addLog / bulkAddLog enforce the 1000-entry cap on
        // sessionLog. The standalone addSessionLog appends unconditionally.
        for (let i = 0; i < 1100; i++) {
            useCombatStore.getState().addLog(`msg ${i}`, 'player');
        }
        expect(useCombatStore.getState().sessionLog.length).toBeLessThanOrEqual(1000);
    });
});

describe('combatStore — addReward', () => {
    beforeEach(resetStore);

    it('accumulates earnedXp and earnedGold', () => {
        useCombatStore.getState().addReward(50, 10);
        useCombatStore.getState().addReward(25, 5);
        const s = useCombatStore.getState();
        expect(s.earnedXp).toBe(75);
        expect(s.earnedGold).toBe(15);
    });
});

describe('combatStore — emitCombatEvent', () => {
    beforeEach(resetStore);

    it('stores the latest combat event', () => {
        const event: ICombatEvent = {
            type: 'playerHit',
            data: { dmg: 12 },
            timestamp: Date.now(),
        };
        useCombatStore.getState().emitCombatEvent(event);
        expect(useCombatStore.getState().lastCombatEvent).toEqual(event);
    });
});

describe('combatStore — setLastDrops / appendDrops', () => {
    beforeEach(resetStore);

    it('setLastDrops overwrites lastDrops and appends to sessionDrops', () => {
        const d1 = makeDrop({ name: 'A' });
        const d2 = makeDrop({ name: 'B' });
        useCombatStore.getState().setLastDrops([d1]);
        useCombatStore.getState().setLastDrops([d2]);
        const s = useCombatStore.getState();
        expect(s.lastDrops).toEqual([d2]);
        expect(s.sessionDrops).toEqual([d1, d2]);
    });

    it('setLastDrops with empty array clears lastDrops without polluting sessionDrops', () => {
        useCombatStore.getState().setLastDrops([makeDrop()]);
        const before = useCombatStore.getState().sessionDrops.length;
        useCombatStore.getState().setLastDrops([]);
        const s = useCombatStore.getState();
        expect(s.lastDrops).toEqual([]);
        expect(s.sessionDrops.length).toBe(before);
    });

    it('appendDrops merges drops into both lastDrops and sessionDrops', () => {
        useCombatStore.getState().appendDrops([makeDrop({ name: 'A' })]);
        useCombatStore.getState().appendDrops([makeDrop({ name: 'B' })]);
        const s = useCombatStore.getState();
        expect(s.lastDrops.map((d) => d.name)).toEqual(['A', 'B']);
        expect(s.sessionDrops.map((d) => d.name)).toEqual(['A', 'B']);
    });
});

describe('combatStore — wave actions', () => {
    beforeEach(resetStore);

    it('addWaveMonster appends up to MAX_WAVE_MONSTERS', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50);
        // Already 1 monster in wave from initCombat
        for (let i = 0; i < MAX_WAVE_MONSTERS - 1; i++) {
            const ok = useCombatStore.getState().addWaveMonster(makeMonster(), 'normal');
            expect(ok).toBe(true);
        }
        // Trying past the cap should return false
        const overflow = useCombatStore.getState().addWaveMonster(makeMonster(), 'normal');
        expect(overflow).toBe(false);
        expect(useCombatStore.getState().waveMonsters).toHaveLength(MAX_WAVE_MONSTERS);
    });

    it('addWaveMonster refuses if phase is not "fighting"', () => {
        // No initCombat -> phase stays idle
        const ok = useCombatStore.getState().addWaveMonster(makeMonster(), 'normal');
        expect(ok).toBe(false);
    });

    it('setWavePlannedCount clamps between 1 and MAX_WAVE_MONSTERS', () => {
        useCombatStore.getState().setWavePlannedCount(0);
        expect(useCombatStore.getState().wavePlannedCount).toBe(1);
        useCombatStore.getState().setWavePlannedCount(999);
        expect(useCombatStore.getState().wavePlannedCount).toBe(MAX_WAVE_MONSTERS);
        useCombatStore.getState().setWavePlannedCount(2);
        expect(useCombatStore.getState().wavePlannedCount).toBe(2);
    });

    it('incrementWavePlannedCount stops at MAX_WAVE_MONSTERS', () => {
        useCombatStore.getState().setWavePlannedCount(MAX_WAVE_MONSTERS);
        const next = useCombatStore.getState().incrementWavePlannedCount();
        expect(next).toBe(MAX_WAVE_MONSTERS);
    });

    it('decrementWavePlannedCount stops at 1', () => {
        useCombatStore.getState().setWavePlannedCount(1);
        const next = useCombatStore.getState().decrementWavePlannedCount();
        expect(next).toBe(1);
    });

    it('damageWaveMonster reduces HP for the targeted wave monster only', () => {
        useCombatStore.getState().initCombat(makeMonster({ hp: 50 }), 100, 50);
        useCombatStore.getState().addWaveMonster(makeMonster({ hp: 50 }), 'normal');
        useCombatStore.getState().damageWaveMonster(1, 20);
        const s = useCombatStore.getState();
        expect(s.waveMonsters[0].currentHp).toBe(50);
        expect(s.waveMonsters[1].currentHp).toBe(30);
    });

    it('resetWave clears wave monsters and active idx', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50);
        useCombatStore.getState().resetWave();
        const s = useCombatStore.getState();
        expect(s.waveMonsters).toEqual([]);
        expect(s.activeTargetIdx).toBe(0);
    });

    it('advanceToNextWaveTarget returns false when all monsters are dead', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50);
        useCombatStore.getState().markActiveWaveMonsterDead();
        const ok = useCombatStore.getState().advanceToNextWaveTarget();
        expect(ok).toBe(false);
    });

    it('advanceToNextWaveTarget promotes the next alive monster', () => {
        useCombatStore.getState().initCombat(makeMonster({ id: 'a' }), 100, 50);
        useCombatStore.getState().addWaveMonster(makeMonster({ id: 'b' }), 'strong');
        useCombatStore.getState().markActiveWaveMonsterDead();
        const ok = useCombatStore.getState().advanceToNextWaveTarget();
        expect(ok).toBe(true);
        const s = useCombatStore.getState();
        expect(s.activeTargetIdx).toBe(1);
        expect(s.monster?.id).toBe('b');
        expect(s.monsterRarity).toBe('strong');
    });

    it('removeLastWaveMonster removes the last non-active alive monster', () => {
        useCombatStore.getState().initCombat(makeMonster({ id: 'a' }), 100, 50);
        useCombatStore.getState().addWaveMonster(makeMonster({ id: 'b' }), 'normal');
        useCombatStore.getState().addWaveMonster(makeMonster({ id: 'c' }), 'normal');
        const removed = useCombatStore.getState().removeLastWaveMonster();
        expect(removed).toBe(true);
        const s = useCombatStore.getState();
        expect(s.waveMonsters).toHaveLength(2);
        // active stays at 0, last (idx 2) was removed
        expect(s.waveMonsters.map((w) => w.monster.id)).toEqual(['a', 'b']);
    });

    it('removeLastWaveMonster returns false when only 1 monster left', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50);
        const removed = useCombatStore.getState().removeLastWaveMonster();
        expect(removed).toBe(false);
    });
});

describe('combatStore — resetCombat', () => {
    beforeEach(resetStore);

    it('returns store to its initial state', () => {
        useCombatStore.getState().initCombat(makeMonster(), 100, 50, 'epic');
        useCombatStore.getState().addLog('something', 'player');
        useCombatStore.getState().addSessionStats(100, 50);
        useCombatStore.getState().resetCombat();
        const s = useCombatStore.getState();
        expect(s.phase).toBe('idle');
        expect(s.monster).toBeNull();
        expect(s.log).toEqual([]);
        expect(s.waveMonsters).toEqual([]);
        expect(s.sessionXpEarned).toBe(0);
        expect(s.sessionGoldEarned).toBe(0);
        expect(s.wavePlannedCount).toBe(1);
    });
});
