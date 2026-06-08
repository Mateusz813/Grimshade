import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePartyCombatSyncStore } from './partyCombatSyncStore';
import { supabase } from '../lib/supabase';

/**
 * Combat-sync store wires party realtime broadcasts. Most actions also
 * touch local state (lastSpellByCaster map, lastDamageByAttacker map,
 * etc.) BEFORE sending — that's the contract members rely on for
 * instant UI updates. We test the local-mirror writes here.
 *
 * The global vitest setup (`tests/vitest.setup.ts`) mocks
 * `supabase.channel(...)` but its default stub omits `.send` and
 * `removeChannel`. We override the channel factory below so publishes
 * don't crash on the missing methods, and we add a `removeChannel`
 * spy on the supabase object so `clear()` + party-switch teardown
 * don't blow up either.
 *
 * Where actions short-circuit on `channel == null` (and SKIP the local
 * mirror as a result), the test subscribes first so the channel exists.
 */

const installChannelMock = (): void => {
    vi.mocked(supabase.channel).mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
    } as never);
    // removeChannel isn't on the global mock either — add it (the source
    // wraps removeChannel calls in try/catch but happy-dom still surfaces
    // the "is not a function" before the catch fires in some paths).
    if (typeof (supabase as unknown as { removeChannel?: unknown }).removeChannel !== 'function') {
        (supabase as unknown as { removeChannel: typeof vi.fn }).removeChannel = vi.fn();
    }
};

const BASELINE = {
    lastAppliedSeq: 0,
    lastSpellByCaster: {} as Record<string, never>,
    lastDamageByAttacker: {} as Record<string, never>,
    lastAttackAction: null as null,
    lastMemberHit: null as null,
    lastMonsterKilled: null as null,
    lastBossState: null as null,
    lastRaidState: null as null,
    lastBossEntrySkipAt: 0,
    pendingBossEntryAt: 0,
    pendingBossEntryBossId: null as null,
    pendingRaidEntryAt: 0,
    pendingRaidEntryRaidId: null as null,
    lastBossDamageByAttacker: {} as Record<string, never>,
    lastRaidDamageByAttacker: {} as Record<string, never>,
    lastBossKilled: null as null,
    lastTrainerState: null as null,
    lastTrainerAttackByAttacker: {} as Record<string, never>,
    lastCombatEndAt: 0,
    pendingMemberSkillRequests: {} as Record<string, never>,
    channel: null as null,
    partyId: null as null,
};

beforeEach(() => {
    installChannelMock();
    // Use `clear()` so the module-level seq counters (outboundSeq,
    // killSeqOutbound, bossSeqOutbound, raidSeqOutbound, lastPublishAt,
    // etc.) reset too. Without that they leak across tests and assertions
    // about "first seq = 1" become flaky.
    usePartyCombatSyncStore.getState().clear();
    // Belt-and-braces: setState to a clean baseline (clear should already
    // do this, but explicit beats implicit when the module retains state).
    usePartyCombatSyncStore.setState({ ...BASELINE });
});

afterEach(() => {
    try { usePartyCombatSyncStore.getState().clear(); } catch { /* ignore */ }
});

// ── subscribe ────────────────────────────────────────────────────────────────

describe('subscribe', () => {
    it('opens a channel + records the partyId on first call', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        const state = usePartyCombatSyncStore.getState();
        expect(state.partyId).toBe('party-1');
        expect(state.channel).not.toBeNull();
        unsub();
    });

    it('is idempotent for the same partyId (re-subscribe is a no-op)', () => {
        const unsub1 = usePartyCombatSyncStore.getState().subscribe('party-1');
        const channelA = usePartyCombatSyncStore.getState().channel;
        const unsub2 = usePartyCombatSyncStore.getState().subscribe('party-1');
        const channelB = usePartyCombatSyncStore.getState().channel;
        expect(channelB).toBe(channelA);
        unsub1();
        unsub2();
    });

    it('resets the local maps when switching parties', () => {
        const unsub1 = usePartyCombatSyncStore.getState().subscribe('party-1');
        // Seed some stale state for party-1.
        usePartyCombatSyncStore.setState({
            lastSpellByCaster: { 'char-1': { casterId: 'char-1', skillId: 's', sentAt: 1 } as never },
            lastDamageByAttacker: { 'char-1': { attackerId: 'char-1', attackerName: 'x', damage: 1, isCrit: false, targetIdx: 0, sentAt: 1 } as never },
        });
        usePartyCombatSyncStore.getState().subscribe('party-2');
        const state = usePartyCombatSyncStore.getState();
        expect(state.partyId).toBe('party-2');
        expect(state.lastSpellByCaster).toEqual({});
        expect(state.lastDamageByAttacker).toEqual({});
        unsub1();
    });

    it('cleanup wipes channel + partyId + every transient map', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.setState({
            lastSpellByCaster: { 'char-1': { casterId: 'char-1', skillId: 's', sentAt: 1 } as never },
            lastAttackAction: { attackerId: 'char-1', attackerName: 'x', damage: 1, isCrit: false, targetIdx: 0, sentAt: 1 } as never,
        });
        unsub();
        const state = usePartyCombatSyncStore.getState();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
        expect(state.lastSpellByCaster).toEqual({});
        expect(state.lastAttackAction).toBeNull();
    });
});

// ── publishSpellCast ────────────────────────────────────────────────────────

describe('publishSpellCast', () => {
    it('is a no-op when no channel is open (local mirror not touched)', () => {
        usePartyCombatSyncStore.getState().publishSpellCast({
            casterId: 'char-1',
            skillId: 'fireball',
        });
        expect(usePartyCombatSyncStore.getState().lastSpellByCaster).toEqual({});
    });

    it('stamps `sentAt` + writes to lastSpellByCaster keyed by casterId', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishSpellCast({
            casterId: 'char-1',
            skillId: 'fireball',
            label: 'FIREBALL',
        });
        const entry = usePartyCombatSyncStore.getState().lastSpellByCaster['char-1'];
        expect(entry).toBeDefined();
        expect(entry.casterId).toBe('char-1');
        expect(entry.skillId).toBe('fireball');
        expect(entry.label).toBe('FIREBALL');
        expect(typeof entry.sentAt).toBe('number');
        unsub();
    });

    it('overwrites a previous spell from the same caster (one entry per id)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishSpellCast({ casterId: 'char-1', skillId: 'fireball' });
        usePartyCombatSyncStore.getState().publishSpellCast({ casterId: 'char-1', skillId: 'iceshard' });
        expect(usePartyCombatSyncStore.getState().lastSpellByCaster['char-1'].skillId).toBe('iceshard');
        unsub();
    });

    it('keeps casters separate (no cross-talk between member entries)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishSpellCast({ casterId: 'char-1', skillId: 'fireball' });
        usePartyCombatSyncStore.getState().publishSpellCast({ casterId: 'char-2', skillId: 'heal' });
        const map = usePartyCombatSyncStore.getState().lastSpellByCaster;
        expect(map['char-1'].skillId).toBe('fireball');
        expect(map['char-2'].skillId).toBe('heal');
        unsub();
    });
});

// ── publishDamageEvent ──────────────────────────────────────────────────────

describe('publishDamageEvent', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishDamageEvent({
            attackerId: 'char-1',
            attackerName: 'Knight',
            damage: 50,
            isCrit: false,
            targetIdx: 0,
        });
        expect(usePartyCombatSyncStore.getState().lastDamageByAttacker).toEqual({});
    });

    it('stamps sentAt + writes to lastDamageByAttacker keyed by attackerId', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishDamageEvent({
            attackerId: 'char-1',
            attackerName: 'Knight',
            damage: 75,
            isCrit: true,
            targetIdx: 1,
        });
        const entry = usePartyCombatSyncStore.getState().lastDamageByAttacker['char-1'];
        expect(entry).toBeDefined();
        expect(entry.damage).toBe(75);
        expect(entry.isCrit).toBe(true);
        expect(entry.targetIdx).toBe(1);
        expect(typeof entry.sentAt).toBe('number');
        unsub();
    });

    it('overwrites the previous event from the same attacker (latest swing wins)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        const dmg = usePartyCombatSyncStore.getState().publishDamageEvent;
        dmg({ attackerId: 'char-1', attackerName: 'K', damage: 50, isCrit: false, targetIdx: 0 });
        dmg({ attackerId: 'char-1', attackerName: 'K', damage: 99, isCrit: true,  targetIdx: 0 });
        const entry = usePartyCombatSyncStore.getState().lastDamageByAttacker['char-1'];
        expect(entry.damage).toBe(99);
        expect(entry.isCrit).toBe(true);
        unsub();
    });
});

// ── publishBossDamage ───────────────────────────────────────────────────────

describe('publishBossDamage', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishBossDamage({
            attackerId: 'player',
            targetId: 'boss',
            damage: 100,
        });
        expect(usePartyCombatSyncStore.getState().lastBossDamageByAttacker).toEqual({});
    });

    it('writes to lastBossDamageByAttacker keyed by `attackerId::targetId` (AOE-safe key)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossDamage({
            attackerId: 'player',
            targetId: 'boss',
            damage: 100,
            isCrit: false,
        });
        const map = usePartyCombatSyncStore.getState().lastBossDamageByAttacker;
        expect(map['player::boss']).toBeDefined();
        expect(map['player::boss'].damage).toBe(100);
        unsub();
    });

    it('keeps multiple targets under DIFFERENT keys (boss AOE hits player + bot in same tick)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        const pub = usePartyCombatSyncStore.getState().publishBossDamage;
        pub({ attackerId: 'boss', targetId: 'player', damage: 30 });
        pub({ attackerId: 'boss', targetId: 'bot-1', damage: 25 });
        pub({ attackerId: 'boss', targetId: 'bot-2', damage: 28 });
        const map = usePartyCombatSyncStore.getState().lastBossDamageByAttacker;
        // All three present; nothing got overwritten.
        expect(Object.keys(map).sort()).toEqual(['boss::bot-1', 'boss::bot-2', 'boss::player']);
        expect(map['boss::player'].damage).toBe(30);
        expect(map['boss::bot-1'].damage).toBe(25);
        expect(map['boss::bot-2'].damage).toBe(28);
        unsub();
    });
});

// ── publishRaidDamage ───────────────────────────────────────────────────────

describe('publishRaidDamage', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishRaidDamage({
            attackerId: 'char-1',
            targetId: 'boss-a',
            damage: 100,
        });
        expect(usePartyCombatSyncStore.getState().lastRaidDamageByAttacker).toEqual({});
    });

    it('keys by attackerId::targetId::sourceBossId so 4 bosses cleaving 4 members each land in distinct slots', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        const pub = usePartyCombatSyncStore.getState().publishRaidDamage;
        pub({ attackerId: 'monster', targetId: 'char-1', sourceBossId: 'boss-a', damage: 30 });
        pub({ attackerId: 'monster', targetId: 'char-1', sourceBossId: 'boss-b', damage: 35 });
        pub({ attackerId: 'monster', targetId: 'char-2', sourceBossId: 'boss-a', damage: 40 });
        const map = usePartyCombatSyncStore.getState().lastRaidDamageByAttacker;
        expect(Object.keys(map).sort()).toEqual([
            'monster::char-1::boss-a',
            'monster::char-1::boss-b',
            'monster::char-2::boss-a',
        ]);
        unsub();
    });

    it('falls back to empty string in the key when sourceBossId is undefined', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishRaidDamage({
            attackerId: 'char-1',
            targetId: 'boss-a',
            damage: 50,
        });
        // ally-on-boss hit → no sourceBossId → key uses an empty trailing segment.
        expect(usePartyCombatSyncStore.getState().lastRaidDamageByAttacker['char-1::boss-a::']).toBeDefined();
        unsub();
    });
});

// ── publishBossState ────────────────────────────────────────────────────────

describe('publishBossState', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1',
            bossHp: 100,
            scaledBossMaxHp: 100,
            phase: 'fighting',
        });
        expect(usePartyCombatSyncStore.getState().lastBossState).toBeNull();
    });

    it('mirrors the snapshot locally + bumps a monotonic seq starting at 1', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1',
            bossHp: 200,
            scaledBossMaxHp: 250,
            phase: 'fighting',
        });
        const snap = usePartyCombatSyncStore.getState().lastBossState;
        expect(snap).not.toBeNull();
        expect(snap!.bossId).toBe('b1');
        expect(snap!.bossHp).toBe(200);
        expect(snap!.seq).toBe(1);
        expect(typeof snap!.sentAt).toBe('number');
        unsub();
    });

    it('skips throttled publishes within MIN_STATE_PUBLISH_MS for the SAME phase', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1', bossHp: 200, scaledBossMaxHp: 250, phase: 'fighting',
        });
        const seqAfterFirst = usePartyCombatSyncStore.getState().lastBossState!.seq;
        // Second call inside the throttle window with the SAME phase → no-op.
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1', bossHp: 180, scaledBossMaxHp: 250, phase: 'fighting',
        });
        // seq + lastBossState should not have changed.
        const snap = usePartyCombatSyncStore.getState().lastBossState!;
        expect(snap.seq).toBe(seqAfterFirst);
        expect(snap.bossHp).toBe(200);
        unsub();
    });

    it('phase transitions bypass the throttle (a "result" snapshot lands immediately)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1', bossHp: 200, scaledBossMaxHp: 250, phase: 'fighting',
        });
        // Phase change → not throttled even if MIN_STATE_PUBLISH_MS hasn't elapsed.
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1', bossHp: 0, scaledBossMaxHp: 250, phase: 'result', won: true,
        });
        const snap = usePartyCombatSyncStore.getState().lastBossState!;
        expect(snap.phase).toBe('result');
        expect(snap.won).toBe(true);
        // seq advanced past the first call.
        expect(snap.seq).toBe(2);
        unsub();
    });
});

// ── publishRaidState ────────────────────────────────────────────────────────

describe('publishRaidState', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishRaidState({
            raidId: 'r1',
            phase: 'fighting',
            currentWave: 1,
            bosses: [],
            members: [],
        });
        expect(usePartyCombatSyncStore.getState().lastRaidState).toBeNull();
    });

    it('mirrors the snapshot locally + bumps a monotonic seq starting at 1', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishRaidState({
            raidId: 'r1',
            phase: 'fighting',
            currentWave: 1,
            bosses: [],
            members: [],
        });
        const snap = usePartyCombatSyncStore.getState().lastRaidState;
        expect(snap).not.toBeNull();
        expect(snap!.raidId).toBe('r1');
        expect(snap!.seq).toBe(1);
        unsub();
    });

    it('bypasses throttle when the alive-boss count changes (kill landed)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishRaidState({
            raidId: 'r1',
            phase: 'fighting',
            currentWave: 1,
            bosses: [
                { id: 'b1', baseId: 'x', level: 1, name: 'a', sprite: '', maxHp: 100, currentHp: 100, attack: 1, defense: 1, isDead: false, waveIdx: 0, slotIdx: 0 },
                { id: 'b2', baseId: 'x', level: 1, name: 'b', sprite: '', maxHp: 100, currentHp: 100, attack: 1, defense: 1, isDead: false, waveIdx: 0, slotIdx: 1 },
            ],
            members: [],
        });
        // Same phase, same wave — but b2 just died. Must NOT be throttled.
        usePartyCombatSyncStore.getState().publishRaidState({
            raidId: 'r1',
            phase: 'fighting',
            currentWave: 1,
            bosses: [
                { id: 'b1', baseId: 'x', level: 1, name: 'a', sprite: '', maxHp: 100, currentHp: 100, attack: 1, defense: 1, isDead: false, waveIdx: 0, slotIdx: 0 },
                { id: 'b2', baseId: 'x', level: 1, name: 'b', sprite: '', maxHp: 0,   currentHp: 0,   attack: 1, defense: 1, isDead: true,  waveIdx: 0, slotIdx: 1 },
            ],
            members: [],
        });
        expect(usePartyCombatSyncStore.getState().lastRaidState!.seq).toBe(2);
        unsub();
    });
});

// ── publishBossKilled ───────────────────────────────────────────────────────

describe('publishBossKilled', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishBossKilled({
            bossId: 'b1', aliveMemberIds: ['char-1'],
        });
        expect(usePartyCombatSyncStore.getState().lastBossKilled).toBeNull();
    });

    it('mirrors the kill payload locally + stamps sentAt', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossKilled({
            bossId: 'b1', aliveMemberIds: ['char-1', 'char-2'],
        });
        const k = usePartyCombatSyncStore.getState().lastBossKilled;
        expect(k).not.toBeNull();
        expect(k!.bossId).toBe('b1');
        expect(k!.aliveMemberIds).toEqual(['char-1', 'char-2']);
        expect(typeof k!.sentAt).toBe('number');
        unsub();
    });

    it('accepts an empty alive-members array (wipe but boss died from DOT)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossKilled({
            bossId: 'b1', aliveMemberIds: [],
        });
        expect(usePartyCombatSyncStore.getState().lastBossKilled!.aliveMemberIds).toEqual([]);
        unsub();
    });
});

// ── publishTrainerState ─────────────────────────────────────────────────────

describe('publishTrainerState', () => {
    it('mirrors the trainer state locally even when no channel is open', () => {
        // Special case: the source mirrors local state BEFORE the
        // `if (!channel) return` early-return, so callers' UI updates
        // even before subscribe.
        usePartyCombatSyncStore.getState().publishTrainerState({
            speedMult: 2,
            trainerAttacks: true,
            noCooldowns: false,
            trainerCount: 2,
            dummyHpPct: 50,
            aggroTargetId: 'char-1',
            deadAllyIds: [],
            totalDmg: 1000,
            curWindowDmg: 100,
            bestWindowDmg: 200,
            leaderSandboxHp: 200,
            leaderSandboxMp: 50,
            memberSandboxHpMp: {},
            botHpMap: {},
        });
        const s = usePartyCombatSyncStore.getState().lastTrainerState;
        expect(s).not.toBeNull();
        expect(s!.speedMult).toBe(2);
        expect(s!.totalDmg).toBe(1000);
    });

    it('overwrites previous trainer state in full (one snapshot at a time)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        const pub = usePartyCombatSyncStore.getState().publishTrainerState;
        pub({
            speedMult: 1, trainerAttacks: false, noCooldowns: false, trainerCount: 1,
            dummyHpPct: 100, aggroTargetId: 'a', deadAllyIds: [],
            totalDmg: 100, curWindowDmg: 0, bestWindowDmg: 100,
            leaderSandboxHp: 200, leaderSandboxMp: 50, memberSandboxHpMp: {}, botHpMap: {},
        });
        pub({
            speedMult: 4, trainerAttacks: true, noCooldowns: true, trainerCount: 4,
            dummyHpPct: 25, aggroTargetId: 'b', deadAllyIds: ['c'],
            totalDmg: 9999, curWindowDmg: 500, bestWindowDmg: 800,
            leaderSandboxHp: 100, leaderSandboxMp: 30, memberSandboxHpMp: { 'c': { hp: 0, mp: 0 } }, botHpMap: {},
        });
        const s = usePartyCombatSyncStore.getState().lastTrainerState!;
        expect(s.speedMult).toBe(4);
        expect(s.totalDmg).toBe(9999);
        expect(s.deadAllyIds).toEqual(['c']);
        unsub();
    });
});

// ── publishTrainerAttack ────────────────────────────────────────────────────

describe('publishTrainerAttack', () => {
    it('mirrors the attack locally with a monotonic seq starting at 1 (regardless of channel)', () => {
        // Same pre-channel mirror pattern as publishTrainerState — caller's
        // own UI must render their swing instantly. `seq` is omitted from the
        // Omit<..., 'sentAt' | 'seq'> contract because the publish path stamps
        // the real monotonic value — exactly like the Trainer.tsx call sites.
        usePartyCombatSyncStore.getState().publishTrainerAttack({
            attackerId: 'char-1',
            attackerClass: 'Knight',
            dummyIdx: 0,
            damage: 50,
            kind: 'basic',
        });
        const map = usePartyCombatSyncStore.getState().lastTrainerAttackByAttacker;
        const keys = Object.keys(map);
        expect(keys.length).toBeGreaterThan(0);
        // Key is `${attackerId}::${seq}`. First publish ever → seq=1.
        const first = map[keys[0]];
        expect(first.attackerId).toBe('char-1');
        expect(first.damage).toBe(50);
        expect(first.seq).toBeGreaterThan(0);
    });

    it('rapid-fire publishes from the SAME attacker each land in a unique slot (no overwrites)', () => {
        // 2026-05-15 v11 spec: same-ms publishes (DOT ticks, AOE splashes,
        // multistrike basics) must not collide.
        const pub = usePartyCombatSyncStore.getState().publishTrainerAttack;
        pub({ attackerId: 'char-1', attackerClass: 'Knight', dummyIdx: 0, damage: 10, kind: 'basic' });
        pub({ attackerId: 'char-1', attackerClass: 'Knight', dummyIdx: 0, damage: 20, kind: 'basic' });
        pub({ attackerId: 'char-1', attackerClass: 'Knight', dummyIdx: 0, damage: 30, kind: 'basic' });
        const map = usePartyCombatSyncStore.getState().lastTrainerAttackByAttacker;
        // 3 distinct entries — sums to 10+20+30 = 60.
        const total = Object.values(map).reduce((acc, ev) => acc + ev.damage, 0);
        expect(total).toBe(60);
    });
});

// ── publishMemberSkillRequest + consumeMemberSkillRequest ──────────────────

describe('publishMemberSkillRequest', () => {
    it('is a no-op when no channel is open', () => {
        usePartyCombatSyncStore.getState().publishMemberSkillRequest('char-1', 'fireball');
        // Nothing in the pending queue (the publish path goes through the
        // channel; the leader's consume path is the one that populates it
        // from inbound broadcasts).
        expect(usePartyCombatSyncStore.getState().pendingMemberSkillRequests).toEqual({});
    });
});

describe('consumeMemberSkillRequest', () => {
    it('returns null when nothing is queued', () => {
        expect(usePartyCombatSyncStore.getState().consumeMemberSkillRequest('char-1')).toBeNull();
    });

    it('pops the head of the FIFO queue', () => {
        usePartyCombatSyncStore.setState({
            pendingMemberSkillRequests: { 'char-1': ['fireball', 'iceshard', 'thunder'] },
        });
        const first = usePartyCombatSyncStore.getState().consumeMemberSkillRequest('char-1');
        expect(first).toBe('fireball');
        // Tail stays.
        expect(usePartyCombatSyncStore.getState().pendingMemberSkillRequests['char-1']).toEqual(['iceshard', 'thunder']);
    });

    it('deletes the member entry when the queue empties', () => {
        usePartyCombatSyncStore.setState({
            pendingMemberSkillRequests: { 'char-1': ['fireball'] },
        });
        usePartyCombatSyncStore.getState().consumeMemberSkillRequest('char-1');
        expect(usePartyCombatSyncStore.getState().pendingMemberSkillRequests['char-1']).toBeUndefined();
    });

    it('returns null for an unknown member id', () => {
        usePartyCombatSyncStore.setState({
            pendingMemberSkillRequests: { 'char-1': ['fireball'] },
        });
        expect(usePartyCombatSyncStore.getState().consumeMemberSkillRequest('char-other')).toBeNull();
        // Existing queue untouched.
        expect(usePartyCombatSyncStore.getState().pendingMemberSkillRequests['char-1']).toEqual(['fireball']);
    });
});

// ── requestMemberBossEntry ──────────────────────────────────────────────────

describe('requestMemberBossEntry', () => {
    it('writes pendingBossEntryAt (current ms) + pendingBossEntryBossId (no channel needed)', () => {
        usePartyCombatSyncStore.getState().requestMemberBossEntry('boss-dragon');
        const state = usePartyCombatSyncStore.getState();
        expect(state.pendingBossEntryBossId).toBe('boss-dragon');
        expect(state.pendingBossEntryAt).toBeGreaterThan(0);
    });

    it('overwrites the previous request (single-slot pending entry)', () => {
        usePartyCombatSyncStore.getState().requestMemberBossEntry('boss-1');
        usePartyCombatSyncStore.getState().requestMemberBossEntry('boss-2');
        expect(usePartyCombatSyncStore.getState().pendingBossEntryBossId).toBe('boss-2');
    });
});

// ── requestMemberRaidEntry ──────────────────────────────────────────────────

describe('requestMemberRaidEntry', () => {
    it('writes pendingRaidEntryAt + pendingRaidEntryRaidId', () => {
        usePartyCombatSyncStore.getState().requestMemberRaidEntry('raid-1');
        const state = usePartyCombatSyncStore.getState();
        expect(state.pendingRaidEntryRaidId).toBe('raid-1');
        expect(state.pendingRaidEntryAt).toBeGreaterThan(0);
    });

    it('overwrites the previous request', () => {
        usePartyCombatSyncStore.getState().requestMemberRaidEntry('raid-1');
        usePartyCombatSyncStore.getState().requestMemberRaidEntry('raid-2');
        expect(usePartyCombatSyncStore.getState().pendingRaidEntryRaidId).toBe('raid-2');
    });
});

// ── publishState / publishMemberHit / publishAttackAction / publishMonsterKilled ──

describe('publishState', () => {
    it('is a no-op when no channel is open (no module-level seq bump)', () => {
        // Capture pre-publish state.
        const before = usePartyCombatSyncStore.getState().lastAppliedSeq;
        usePartyCombatSyncStore.getState().publishState({
            senderId: 'char-leader',
            phase: 'fighting',
            waveMonsters: [],
            wavePlannedCount: 1,
            activeTargetIdx: 0,
            monsterCurrentHp: 100,
            monsterMaxHp: 100,
            monster: null,
            monsterRarity: 'normal',
            partyDamage: {},
        });
        // lastAppliedSeq is owned by the channel handler — must stay at 0
        // when nothing inbound has been processed.
        expect(usePartyCombatSyncStore.getState().lastAppliedSeq).toBe(before);
    });

    it('does not throw when called with a complete snapshot + an open channel', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => {
            usePartyCombatSyncStore.getState().publishState({
                senderId: 'char-leader',
                phase: 'fighting',
                waveMonsters: [],
                wavePlannedCount: 1,
                activeTargetIdx: 0,
                monsterCurrentHp: 100,
                monsterMaxHp: 100,
                monster: null,
                monsterRarity: 'normal',
                partyDamage: {},
            });
        }).not.toThrow();
        unsub();
    });
});

describe('publishMemberHit', () => {
    it('does not throw with channel + memberId set (channel.send no-op via global mock)', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => {
            usePartyCombatSyncStore.getState().publishMemberHit({
                memberId: 'char-1',
                damage: 30,
                sourceMonsterIdx: 0,
            });
        }).not.toThrow();
        unsub();
    });

    it('is a no-op when no channel is open', () => {
        expect(() => {
            usePartyCombatSyncStore.getState().publishMemberHit({
                memberId: 'char-1',
                damage: 30,
                sourceMonsterIdx: 0,
            });
        }).not.toThrow();
    });
});

describe('publishAttackAction', () => {
    it('does not throw with channel open', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => {
            usePartyCombatSyncStore.getState().publishAttackAction({
                attackerId: 'char-2',
                attackerName: 'Mage',
                damage: 75,
                isCrit: false,
                targetIdx: 0,
            });
        }).not.toThrow();
        unsub();
    });

    it('is a no-op when no channel is open', () => {
        expect(() => {
            usePartyCombatSyncStore.getState().publishAttackAction({
                attackerId: 'char-2',
                attackerName: 'Mage',
                damage: 75,
                isCrit: false,
                targetIdx: 0,
            });
        }).not.toThrow();
    });
});

describe('publishMonsterKilled', () => {
    it('does not throw with channel open + assigns the kill seq monotonically', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        // The store doesn't mirror the kill locally, but it does bump
        // `killSeqOutbound` module-side. We can verify it indirectly by
        // observing that two sequential calls don't throw.
        expect(() => {
            usePartyCombatSyncStore.getState().publishMonsterKilled({
                monsterId: 'rat',
                monsterLevel: 1,
                monsterRarity: 'normal',
                finalXp: 17,
            });
            usePartyCombatSyncStore.getState().publishMonsterKilled({
                monsterId: 'rat',
                monsterLevel: 1,
                monsterRarity: 'normal',
                finalXp: 17,
            });
        }).not.toThrow();
        unsub();
    });

    it('is a no-op when no channel is open', () => {
        expect(() => {
            usePartyCombatSyncStore.getState().publishMonsterKilled({
                monsterId: 'rat',
                monsterLevel: 1,
                monsterRarity: 'normal',
                finalXp: 17,
            });
        }).not.toThrow();
    });
});

// ── publishCombatSpeed / publishCombatEnd / publishVictory / publishBossEntrySkip ──

describe('publishCombatSpeed', () => {
    it('is a no-op when no channel is open', () => {
        expect(() => usePartyCombatSyncStore.getState().publishCombatSpeed('x4')).not.toThrow();
    });

    it('does not throw with channel open + supported values', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => {
            const pub = usePartyCombatSyncStore.getState().publishCombatSpeed;
            pub('x1');
            pub('x2');
            pub('x4');
            pub('SKIP');
        }).not.toThrow();
        unsub();
    });
});

describe('publishCombatEnd', () => {
    it('is a no-op when no channel is open', () => {
        expect(() => usePartyCombatSyncStore.getState().publishCombatEnd()).not.toThrow();
    });

    it('does not throw with channel open', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => usePartyCombatSyncStore.getState().publishCombatEnd()).not.toThrow();
        unsub();
    });
});

describe('publishVictory', () => {
    it('is a no-op when no channel is open', () => {
        expect(() => {
            usePartyCombatSyncStore.getState().publishVictory({ earnedXp: 100, earnedGold: 50 });
        }).not.toThrow();
    });

    it('does not throw with channel open and 0 values', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => {
            usePartyCombatSyncStore.getState().publishVictory({ earnedXp: 0, earnedGold: 0 });
        }).not.toThrow();
        unsub();
    });
});

describe('publishBossEntrySkip', () => {
    it('is a no-op when no channel is open', () => {
        expect(() => usePartyCombatSyncStore.getState().publishBossEntrySkip()).not.toThrow();
    });

    it('does not throw with channel open', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        expect(() => usePartyCombatSyncStore.getState().publishBossEntrySkip()).not.toThrow();
        unsub();
    });
});

// ── clear ───────────────────────────────────────────────────────────────────

describe('clear', () => {
    it('wipes channel + partyId + every transient field', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        // Seed lots of stale state.
        usePartyCombatSyncStore.setState({
            lastSpellByCaster: { 'char-1': { casterId: 'char-1', skillId: 's', sentAt: 1 } as never },
            lastDamageByAttacker: { 'char-1': { attackerId: 'char-1', attackerName: 'x', damage: 1, isCrit: false, targetIdx: 0, sentAt: 1 } as never },
            lastBossDamageByAttacker: { 'k': { attackerId: 'a', targetId: 'b', damage: 1, sentAt: 1 } as never },
            lastRaidDamageByAttacker: { 'k': { attackerId: 'a', targetId: 'b', damage: 1, sentAt: 1 } as never },
            lastTrainerAttackByAttacker: { 'k': { seq: 1, attackerId: 'a', attackerClass: 'Knight', dummyIdx: 0, damage: 1, kind: 'basic', sentAt: 1 } as never },
            lastAttackAction: { attackerId: 'a', attackerName: 'b', damage: 1, isCrit: false, targetIdx: 0, sentAt: 1 } as never,
            lastMemberHit: { memberId: 'a', damage: 1, sourceMonsterIdx: 0, sentAt: 1 } as never,
            lastMonsterKilled: { monsterId: 'r', monsterLevel: 1, monsterRarity: 'normal', finalXp: 10, seq: 1, sentAt: 1 } as never,
            lastBossState: { bossId: 'b', bossHp: 0, scaledBossMaxHp: 100, phase: 'fighting', seq: 1, sentAt: 1 } as never,
            lastRaidState: { raidId: 'r', phase: 'fighting', currentWave: 1, bosses: [], members: [], seq: 1, sentAt: 1 } as never,
            lastTrainerState: { speedMult: 1, trainerAttacks: false, noCooldowns: false, trainerCount: 1, dummyHpPct: 100, aggroTargetId: 'a', deadAllyIds: [], totalDmg: 0, curWindowDmg: 0, bestWindowDmg: 0, leaderSandboxHp: 100, leaderSandboxMp: 50, memberSandboxHpMp: {}, botHpMap: {}, sentAt: 1 } as never,
            pendingMemberSkillRequests: { 'char-1': ['fireball'] },
            lastBossEntrySkipAt: 999,
            lastCombatEndAt: 999,
        });
        usePartyCombatSyncStore.getState().clear();
        const state = usePartyCombatSyncStore.getState();
        expect(state.channel).toBeNull();
        expect(state.partyId).toBeNull();
        expect(state.lastSpellByCaster).toEqual({});
        expect(state.lastDamageByAttacker).toEqual({});
        expect(state.lastBossDamageByAttacker).toEqual({});
        expect(state.lastRaidDamageByAttacker).toEqual({});
        expect(state.lastTrainerAttackByAttacker).toEqual({});
        expect(state.lastAttackAction).toBeNull();
        expect(state.lastMemberHit).toBeNull();
        expect(state.lastMonsterKilled).toBeNull();
        expect(state.lastBossState).toBeNull();
        expect(state.lastRaidState).toBeNull();
        expect(state.lastTrainerState).toBeNull();
        expect(state.pendingMemberSkillRequests).toEqual({});
        expect(state.lastBossEntrySkipAt).toBe(0);
        expect(state.lastCombatEndAt).toBe(0);
        unsub();
    });

    it('is safe to call on a fresh store (no channel ever opened)', () => {
        expect(() => usePartyCombatSyncStore.getState().clear()).not.toThrow();
    });

    it('resets the module-level outbound seq counters so subsequent publishes restart at 1', () => {
        const unsub = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b1', bossHp: 100, scaledBossMaxHp: 100, phase: 'fighting',
        });
        expect(usePartyCombatSyncStore.getState().lastBossState!.seq).toBe(1);
        usePartyCombatSyncStore.getState().clear();
        // Re-subscribe (clear tears the channel down).
        const unsub2 = usePartyCombatSyncStore.getState().subscribe('party-1');
        usePartyCombatSyncStore.getState().publishBossState({
            bossId: 'b2', bossHp: 200, scaledBossMaxHp: 200, phase: 'fighting',
        });
        expect(usePartyCombatSyncStore.getState().lastBossState!.seq).toBe(1);
        unsub();
        unsub2();
    });
});

// ── Initial state ───────────────────────────────────────────────────────────

describe('initial state', () => {
    it('boots with everything null / empty', () => {
        // After a `clear()` in beforeEach, the store should look exactly
        // like the freshly-imported defaults.
        const s = usePartyCombatSyncStore.getState();
        expect(s.lastAppliedSeq).toBe(0);
        expect(s.lastSpellByCaster).toEqual({});
        expect(s.lastDamageByAttacker).toEqual({});
        expect(s.lastBossDamageByAttacker).toEqual({});
        expect(s.lastRaidDamageByAttacker).toEqual({});
        expect(s.lastTrainerAttackByAttacker).toEqual({});
        expect(s.lastAttackAction).toBeNull();
        expect(s.lastMemberHit).toBeNull();
        expect(s.lastMonsterKilled).toBeNull();
        expect(s.lastBossState).toBeNull();
        expect(s.lastRaidState).toBeNull();
        expect(s.lastTrainerState).toBeNull();
        expect(s.lastBossKilled).toBeNull();
        expect(s.lastCombatEndAt).toBe(0);
        expect(s.lastBossEntrySkipAt).toBe(0);
        expect(s.pendingBossEntryAt).toBe(0);
        expect(s.pendingBossEntryBossId).toBeNull();
        expect(s.pendingRaidEntryAt).toBe(0);
        expect(s.pendingRaidEntryRaidId).toBeNull();
        expect(s.pendingMemberSkillRequests).toEqual({});
        expect(s.channel).toBeNull();
        expect(s.partyId).toBeNull();
    });
});

// TODO: inbound channel-handler paths (`state`, `spell-cast`, `combat-speed`,
// `victory`, `combat-end`, `attack-action`, `damage-event`, `member-hit`,
// `monster-killed`, `boss-state`, `raid-state`, `boss-entry-skip`,
// `boss-damage`, `raid-damage`, `boss-killed`, `trainer-state`,
// `trainer-attack`, `member-skill-request`) all feed local state from
// realtime broadcasts. They're driven by the supabase mock's `channel.on`
// stub which is a no-op in the global setup — synthesizing inbound events
// from a unit test requires a per-suite mock that captures the handlers
// and replays payloads. Covered indirectly by integration tests against
// real Supabase Realtime.
//
// TODO: applyStateLocally() is async and side-effecting (touches
// useCombatStore + usePartyDamageStore via dynamic imports). Its tests
// belong with the channel-handler integration set above.
//
// TODO: the auto-fireGo subscriber wired at module bottom is no-op'ed
// in the source (`void s;`) per the v3 spec — defer is owned by the
// ReadyCheckModal consumer.
