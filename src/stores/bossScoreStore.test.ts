import { describe, it, expect, beforeEach } from 'vitest';
import { useBossScoreStore } from './bossScoreStore';

beforeEach(() => {
    useBossScoreStore.setState({
        totalScore: 0,
        bossKills: {},
    });
});


describe('addBossKill', () => {
    it('records the first kill with count = 1', () => {
        useBossScoreStore.getState().addBossKill('boss_25', 25);
        const entry = useBossScoreStore.getState().bossKills['boss_25'];
        expect(entry.count).toBe(1);
        expect(typeof entry.lastKill).toBe('string');
        expect(Number.isNaN(new Date(entry.lastKill).getTime())).toBe(false);
    });

    it('increments count on repeated kills for the same boss', () => {
        const store = useBossScoreStore.getState();
        store.addBossKill('boss_25', 25);
        store.addBossKill('boss_25', 25);
        store.addBossKill('boss_25', 25);
        expect(useBossScoreStore.getState().bossKills['boss_25'].count).toBe(3);
    });

    it('adds the per-kill score to totalScore', () => {
        useBossScoreStore.getState().addBossKill('boss_25', 25);
        expect(useBossScoreStore.getState().totalScore).toBe(256);
    });

    it('accumulates totalScore across multiple bosses/levels', () => {
        const store = useBossScoreStore.getState();
        store.addBossKill('boss_25', 25);
        store.addBossKill('boss_100', 100);
        expect(useBossScoreStore.getState().totalScore).toBe(256 + 1100);
    });

    it('handles level 0 cleanly (score = 0, no NaN)', () => {
        useBossScoreStore.getState().addBossKill('boss_x', 0);
        const state = useBossScoreStore.getState();
        expect(state.totalScore).toBe(0);
        expect(state.bossKills['boss_x'].count).toBe(1);
    });

    it('updates `lastKill` ISO timestamp on every kill', () => {
        const store = useBossScoreStore.getState();
        store.addBossKill('boss_25', 25);
        const firstTs = useBossScoreStore.getState().bossKills['boss_25'].lastKill;
        store.addBossKill('boss_25', 25);
        const secondTs = useBossScoreStore.getState().bossKills['boss_25'].lastKill;
        expect(new Date(secondTs).getTime()).toBeGreaterThanOrEqual(new Date(firstTs).getTime());
    });
});


describe('getTotalScore', () => {
    it('returns 0 on a fresh store', () => {
        expect(useBossScoreStore.getState().getTotalScore()).toBe(0);
    });

    it('mirrors the totalScore field', () => {
        useBossScoreStore.setState({ totalScore: 4242, bossKills: {} });
        expect(useBossScoreStore.getState().getTotalScore()).toBe(4242);
    });
});


describe('getBossKillCount', () => {
    it('returns 0 for an unrecorded boss', () => {
        expect(useBossScoreStore.getState().getBossKillCount('boss_unknown')).toBe(0);
    });

    it('returns the live count once kills are registered', () => {
        const store = useBossScoreStore.getState();
        store.addBossKill('boss_25', 25);
        store.addBossKill('boss_25', 25);
        expect(useBossScoreStore.getState().getBossKillCount('boss_25')).toBe(2);
    });
});
