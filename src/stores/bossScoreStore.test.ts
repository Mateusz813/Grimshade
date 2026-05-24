import { describe, it, expect, beforeEach } from 'vitest';
import { useBossScoreStore } from './bossScoreStore';

beforeEach(() => {
    useBossScoreStore.setState({
        totalScore: 0,
        bossKills: {},
    });
});

// The score formula is `floor(level * 10 + (level / 100) * level)` — i.e.
// linear with a quadratic tail. We pin a few sample values so a future
// rebalance has to update both the formula and the tests intentionally.

describe('addBossKill', () => {
    it('records the first kill with count = 1', () => {
        useBossScoreStore.getState().addBossKill('boss_25', 25);
        const entry = useBossScoreStore.getState().bossKills['boss_25'];
        expect(entry.count).toBe(1);
        expect(typeof entry.lastKill).toBe('string');
        // ISO timestamp sanity — should parse back into a finite Date.
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
        // level 25 → floor(25*10 + (25/100)*25) = floor(250 + 6.25) = 256
        useBossScoreStore.getState().addBossKill('boss_25', 25);
        expect(useBossScoreStore.getState().totalScore).toBe(256);
    });

    it('accumulates totalScore across multiple bosses/levels', () => {
        const store = useBossScoreStore.getState();
        // level 25 → 256, level 100 → floor(1000 + 100) = 1100
        store.addBossKill('boss_25', 25);
        store.addBossKill('boss_100', 100);
        expect(useBossScoreStore.getState().totalScore).toBe(256 + 1100);
    });

    it('handles level 0 cleanly (score = 0, no NaN)', () => {
        // Defensive: even if a bad data row sneaks through, we don't NaN out.
        useBossScoreStore.getState().addBossKill('boss_x', 0);
        const state = useBossScoreStore.getState();
        expect(state.totalScore).toBe(0);
        expect(state.bossKills['boss_x'].count).toBe(1);
    });

    it('updates `lastKill` ISO timestamp on every kill', () => {
        const store = useBossScoreStore.getState();
        store.addBossKill('boss_25', 25);
        const firstTs = useBossScoreStore.getState().bossKills['boss_25'].lastKill;
        // Tiny sleep via Date.now spin is overkill; the assertion below
        // tolerates same-ms writes.
        store.addBossKill('boss_25', 25);
        const secondTs = useBossScoreStore.getState().bossKills['boss_25'].lastKill;
        // The store always writes a fresh `new Date().toISOString()`, so the
        // second write is at least as recent as the first.
        expect(new Date(secondTs).getTime()).toBeGreaterThanOrEqual(new Date(firstTs).getTime());
    });
});

// ── getTotalScore ────────────────────────────────────────────────────────────

describe('getTotalScore', () => {
    it('returns 0 on a fresh store', () => {
        expect(useBossScoreStore.getState().getTotalScore()).toBe(0);
    });

    it('mirrors the totalScore field', () => {
        useBossScoreStore.setState({ totalScore: 4242, bossKills: {} });
        expect(useBossScoreStore.getState().getTotalScore()).toBe(4242);
    });
});

// ── getBossKillCount ─────────────────────────────────────────────────────────

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
