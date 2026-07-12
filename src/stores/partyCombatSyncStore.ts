import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { IWaveMonster, CombatPhase, IMonster } from './combatStore';
import type { TMonsterRarity } from '../systems/lootSystem';


export interface IPartyCombatStateSnapshot {
    senderId: string;
    seq: number;
    phase: CombatPhase;
    waveMonsters: IWaveMonster[];
    wavePlannedCount: number;
    activeTargetIdx: number;
    monsterCurrentHp: number;
    monsterMaxHp: number;
    monster: IMonster | null;
    monsterRarity: TMonsterRarity;
    partyDamage: Record<string, number>;
    sentAt: number;
}

export interface IPartySpellCast {
    casterId: string;
    skillId: string;
    label?: string;
    targetIdx?: number;
    isDamageHit?: boolean;
    casterName?: string;
    sentAt: number;
}

export interface IPartyCombatSpeed {
    speed: 'x1' | 'x2' | 'x4' | 'SKIP';
    sentAt: number;
}

export interface IPartyAttackAction {
    attackerId: string;
    attackerName: string;
    damage: number;
    isCrit: boolean;
    targetIdx: number;
    hand?: 'left' | 'right' | null;
    sentAt: number;
}

export interface IPartyDamageEvent {
    attackerId: string;
    attackerName: string;
    damage: number;
    isCrit: boolean;
    targetIdx: number;
    hand?: 'left' | 'right' | null;
    sentAt: number;
}

export interface IPartyMemberHit {
    memberId: string;
    damage: number;
    sourceMonsterIdx: number;
    sentAt: number;
}

export interface IPartyBossDamageEvent {
    attackerId: 'player' | 'boss' | string;
    attackerClass?: import('../types/character').TCharacterClass;
    targetId: 'player' | 'boss' | string;
    damage: number;
    isCrit?: boolean;
    kind?: 'basic' | 'spell' | 'ally-basic' | 'ally-spell' | 'monster' | 'monster-spell' | 'heal';
    icon?: string;
    label?: string;
    skillId?: string;
    sentAt: number;
}

export interface IPartyRaidState {
    raidId: string;
    phase: 'lobby' | 'countdown' | 'fighting' | 'victory' | 'wipe';
    currentWave: number;
    bosses: import('../types/raid').IRaidBossState[];
    members: import('../types/raid').IRaidMemberState[];
    speedMode?: 'x1' | 'x2' | 'x4';
    aggroTargetIds?: Record<string, string>;
    partyDamage?: Record<string, number>;
    dropsByMember?: Record<string, import('../types/raid').IRaidDropLine[]>;
    itemsByMember?: Record<string, import('../types/item').IInventoryItem[]>;
    sentAt: number;
    seq: number;
}

export interface IPartyRaidDamageEvent {
    attackerId: 'monster' | string;
    attackerClass?: import('../types/character').TCharacterClass;
    targetId: string;
    sourceBossId?: string;
    damage: number;
    isCrit?: boolean;
    kind?: 'basic' | 'spell' | 'ally-basic' | 'ally-spell' | 'monster' | 'monster-spell' | 'heal';
    icon?: string;
    label?: string;
    skillId?: string;
    sentAt: number;
}

export interface IPartyBossAlly {
    id: string;
    class: import('../types/character').TCharacterClass;
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    isDead: boolean;
    isLeader: boolean;
    representsCharacterId?: string;
}

export interface IPartyBossState {
    bossId: string;
    bossHp: number;
    scaledBossMaxHp: number;
    phase: 'list' | 'fighting' | 'result';
    won?: boolean;
    allies?: IPartyBossAlly[];
    aggroTargetId?: string;
    earnedXp?: number;
    earnedGold?: number;
    partyDamage?: Record<string, number>;
    speedMode?: 'x1' | 'x2' | 'x4';
    sentAt: number;
    seq: number;
}

export interface IPartyMonsterKilled {
    monsterId: string;
    monsterLevel: number;
    monsterRarity: import('../systems/lootSystem').TMonsterRarity;
    finalXp: number;
    seq: number;
    sentAt: number;
}

export interface IPartyTrainerState {
    speedMult: 1 | 2 | 4;
    trainerAttacks: boolean;
    noCooldowns: boolean;
    trainerCount: number;
    dummyHpPct: number;
    aggroTargetId: string;
    deadAllyIds: string[];
    totalDmg: number;
    curWindowDmg: number;
    bestWindowDmg: number;
    leaderSandboxHp: number;
    leaderSandboxMp: number;
    memberSandboxHpMp: Record<string, { hp: number; mp: number }>;
    botHpMap: Record<string, number>;
    sentAt: number;
}

export interface IPartyTrainerAttack {
    seq: number;
    attackerId: string;
    attackerClass: import('../types/character').TCharacterClass;
    dummyIdx: number;
    damage: number;
    isCrit?: boolean;
    kind: 'basic' | 'spell' | 'ally-basic' | 'ally-spell' | 'monster';
    icon?: string;
    label?: string;
    skillId?: string;
    targetAllyId?: string;
    sentAt: number;
}

interface IPartyCombatSyncState {
    lastAppliedSeq: number;
    lastSpellByCaster: Record<string, IPartySpellCast>;
    lastDamageByAttacker: Record<string, IPartyDamageEvent>;
    lastAttackAction: IPartyAttackAction | null;
    lastMemberHit: IPartyMemberHit | null;
    lastMonsterKilled: IPartyMonsterKilled | null;
    lastBossState: IPartyBossState | null;
    lastRaidState: IPartyRaidState | null;
    channel: RealtimeChannel | null;
    partyId: string | null;

    subscribe: (partyId: string) => () => void;
    publishState: (snapshot: Omit<IPartyCombatStateSnapshot, 'seq' | 'sentAt'>) => void;
    publishSpellCast: (cast: Omit<IPartySpellCast, 'sentAt'>) => void;
    publishCombatSpeed: (speed: IPartyCombatSpeed['speed']) => void;
    publishVictory: (payload: { earnedXp: number; earnedGold: number }) => void;
    publishAttackAction: (action: Omit<IPartyAttackAction, 'sentAt'>) => void;
    publishDamageEvent: (event: Omit<IPartyDamageEvent, 'sentAt'>) => void;
    publishMemberHit: (hit: Omit<IPartyMemberHit, 'sentAt'>) => void;
    publishMonsterKilled: (k: Omit<IPartyMonsterKilled, 'sentAt' | 'seq'>) => void;
    publishBossState: (s: Omit<IPartyBossState, 'sentAt' | 'seq'>) => void;
    publishBossEntrySkip: () => void;
    lastBossEntrySkipAt: number;
    pendingBossEntryAt: number;
    pendingBossEntryBossId: string | null;
    requestMemberBossEntry: (bossId: string) => void;
    pendingRaidEntryAt: number;
    pendingRaidEntryRaidId: string | null;
    requestMemberRaidEntry: (raidId: string) => void;
    lastBossDamageByAttacker: Record<string, IPartyBossDamageEvent>;
    publishBossDamage: (ev: Omit<IPartyBossDamageEvent, 'sentAt'>) => void;
    lastBossKilled: { bossId: string; aliveMemberIds: string[]; sentAt: number } | null;
    publishBossKilled: (payload: { bossId: string; aliveMemberIds: string[] }) => void;
    publishRaidState: (s: Omit<IPartyRaidState, 'sentAt' | 'seq'>) => void;
    lastRaidDamageByAttacker: Record<string, IPartyRaidDamageEvent>;
    publishRaidDamage: (ev: Omit<IPartyRaidDamageEvent, 'sentAt'>) => void;
    lastTrainerState: IPartyTrainerState | null;
    publishTrainerState: (s: Omit<IPartyTrainerState, 'sentAt'>) => void;
    lastTrainerAttackByAttacker: Record<string, IPartyTrainerAttack>;
    publishTrainerAttack: (ev: Omit<IPartyTrainerAttack, 'sentAt' | 'seq'>) => void;
    publishCombatEnd: () => void;
    lastCombatEndAt: number;

    pendingMemberSkillRequests: Record<string, string[]>;
    publishMemberSkillRequest: (memberId: string, skillId: string) => void;
    consumeMemberSkillRequest: (memberId: string) => string | null;

    clear: () => void;
}

const MIN_STATE_PUBLISH_MS = 120;
let lastPublishAt = 0;
let outboundSeq = 0;
let killSeqOutbound = 0;
let lastBossPublishAt = 0;
let bossSeqOutbound = 0;
let lastRaidPublishAt = 0;
let raidSeqOutbound = 0;
let trainerAttackSeq = 0;

const applyStateLocally = async (snap: IPartyCombatStateSnapshot): Promise<void> => {
    const { useCombatStore } = await import('./combatStore');
    useCombatStore.setState({
        phase:             snap.phase,
        waveMonsters:      snap.waveMonsters,
        wavePlannedCount:  snap.wavePlannedCount,
        activeTargetIdx:   snap.activeTargetIdx,
        monsterCurrentHp:  snap.monsterCurrentHp,
        monsterMaxHp:      snap.monsterMaxHp,
        monster:           snap.monster,
        monsterRarity:     snap.monsterRarity,
    });
    if (snap.partyDamage) {
        const { usePartyDamageStore } = await import('./partyDamageStore');
        const dmgState = usePartyDamageStore.getState();
        for (const [memberId, total] of Object.entries(snap.partyDamage)) {
            dmgState.setMemberDamage(memberId, total);
        }
    }
};

export const usePartyCombatSyncStore = create<IPartyCombatSyncState>()((set, get) => ({
    lastAppliedSeq: 0,
    lastSpellByCaster: {},
    lastDamageByAttacker: {},
    lastAttackAction: null,
    lastMemberHit: null,
    lastMonsterKilled: null,
    lastBossState: null,
    lastRaidState: null,
    lastBossEntrySkipAt: 0,
    pendingBossEntryAt: 0,
    pendingBossEntryBossId: null,
    pendingRaidEntryAt: 0,
    pendingRaidEntryRaidId: null,
    lastBossDamageByAttacker: {},
    lastRaidDamageByAttacker: {},
    lastBossKilled: null,
    lastTrainerState: null,
    lastTrainerAttackByAttacker: {},
    lastCombatEndAt: 0,
    pendingMemberSkillRequests: {},
    channel: null,
    partyId: null,

    subscribe: (partyId) => {
        const current = get();
        if (current.partyId === partyId && current.channel) return () => {};
        if (current.channel) {
            try { void supabase.removeChannel(current.channel); } catch { }
        }

        const channel = supabase.channel(`party-combat-${partyId}`, {
            config: { broadcast: { self: false } },
        });

        channel.on('broadcast', { event: 'state' }, ({ payload }) => {
            const snap = payload as IPartyCombatStateSnapshot;
            if (!snap || typeof snap.seq !== 'number') return;
            const { lastAppliedSeq } = get();
            if (snap.seq <= lastAppliedSeq) return;
            set({ lastAppliedSeq: snap.seq });
            void applyStateLocally(snap);
        });

        channel.on('broadcast', { event: 'spell-cast' }, ({ payload }) => {
            const cast = payload as IPartySpellCast;
            if (!cast?.casterId || !cast?.skillId) return;
            set((s) => ({
                lastSpellByCaster: { ...s.lastSpellByCaster, [cast.casterId]: cast },
            }));
        });

        channel.on('broadcast', { event: 'combat-speed' }, async ({ payload }) => {
            const data = payload as IPartyCombatSpeed;
            if (!data?.speed) return;
            const { useSettingsStore } = await import('./settingsStore');
            useSettingsStore.getState().setCombatSpeed(data.speed);
        });

        channel.on('broadcast', { event: 'victory' }, async ({ payload }) => {
            const { earnedXp, earnedGold } = payload as { earnedXp: number; earnedGold: number };
            const { useCombatStore } = await import('./combatStore');
            useCombatStore.setState({
                phase: 'victory',
                earnedXp: earnedXp ?? 0,
                earnedGold: earnedGold ?? 0,
            });
        });

        channel.on('broadcast', { event: 'combat-end' }, () => {
            set({ lastCombatEndAt: Date.now() });
        });

        channel.on('broadcast', { event: 'attack-action' }, ({ payload }) => {
            const action = payload as IPartyAttackAction;
            if (!action?.attackerId) return;
            set({ lastAttackAction: action });
        });

        channel.on('broadcast', { event: 'damage-event' }, ({ payload }) => {
            const ev = payload as IPartyDamageEvent;
            if (!ev?.attackerId) return;
            set((s) => ({
                lastDamageByAttacker: { ...s.lastDamageByAttacker, [ev.attackerId]: ev },
            }));
        });

        channel.on('broadcast', { event: 'member-hit' }, ({ payload }) => {
            const hit = payload as IPartyMemberHit;
            if (!hit?.memberId) return;
            set({ lastMemberHit: hit });
        });

        channel.on('broadcast', { event: 'monster-killed' }, ({ payload }) => {
            const k = payload as IPartyMonsterKilled;
            if (!k?.monsterId) return;
            set({ lastMonsterKilled: k });
        });

        channel.on('broadcast', { event: 'boss-state' }, ({ payload }) => {
            const s = payload as IPartyBossState;
            if (!s?.bossId || typeof s.seq !== 'number') return;
            const prev = get().lastBossState;
            if (prev && s.seq <= prev.seq) return;
            set({ lastBossState: s });
        });

        channel.on('broadcast', { event: 'raid-state' }, ({ payload }) => {
            const s = payload as IPartyRaidState;
            if (!s?.raidId || typeof s.seq !== 'number') return;
            const prev = get().lastRaidState;
            if (prev && s.seq <= prev.seq) return;
            set({ lastRaidState: s });
        });

        channel.on('broadcast', { event: 'boss-entry-skip' }, () => {
            set({ lastBossEntrySkipAt: Date.now() });
        });

        channel.on('broadcast', { event: 'boss-damage' }, ({ payload }) => {
            const ev = payload as IPartyBossDamageEvent;
            if (!ev?.attackerId || !ev?.targetId) return;
            const key = `${ev.attackerId}::${ev.targetId}`;
            set((s) => ({
                lastBossDamageByAttacker: { ...s.lastBossDamageByAttacker, [key]: ev },
            }));
        });

        channel.on('broadcast', { event: 'raid-damage' }, ({ payload }) => {
            const ev = payload as IPartyRaidDamageEvent;
            if (!ev?.attackerId || !ev?.targetId) return;
            const key = `${ev.attackerId}::${ev.targetId}::${ev.sourceBossId ?? ''}`;
            set((s) => ({
                lastRaidDamageByAttacker: { ...s.lastRaidDamageByAttacker, [key]: ev },
            }));
        });

        channel.on('broadcast', { event: 'boss-killed' }, ({ payload }) => {
            const ev = payload as { bossId: string; aliveMemberIds: string[]; sentAt: number };
            if (!ev?.bossId) return;
            set({ lastBossKilled: ev });
        });

        channel.on('broadcast', { event: 'trainer-state' }, ({ payload }) => {
            const s = payload as IPartyTrainerState;
            if (!s || typeof s.speedMult !== 'number') return;
            set({ lastTrainerState: s });
        });

        channel.on('broadcast', { event: 'trainer-attack' }, ({ payload }) => {
            const ev = payload as IPartyTrainerAttack;
            if (!ev?.attackerId || typeof ev.dummyIdx !== 'number') return;
            const key = `${ev.attackerId}::${ev.seq ?? ev.sentAt}`;
            set((s) => ({
                lastTrainerAttackByAttacker: { ...s.lastTrainerAttackByAttacker, [key]: ev },
            }));
        });

        channel.on('broadcast', { event: 'member-skill-request' }, ({ payload }) => {
            const ev = payload as { memberId: string; skillId: string; sentAt: number };
            if (!ev?.memberId || !ev?.skillId) return;
            set((s) => {
                const prev = s.pendingMemberSkillRequests[ev.memberId] ?? [];
                return {
                    pendingMemberSkillRequests: {
                        ...s.pendingMemberSkillRequests,
                        [ev.memberId]: [...prev, ev.skillId],
                    },
                };
            });
        });

        channel.subscribe();
        set({
            channel, partyId,
            lastAppliedSeq: 0,
            lastSpellByCaster: {},
            lastDamageByAttacker: {},
            lastBossDamageByAttacker: {},
            lastRaidDamageByAttacker: {},
            lastAttackAction: null,
            lastMemberHit: null,
            lastBossState: null,
            lastRaidState: null,
            lastTrainerState: null,
            lastTrainerAttackByAttacker: {},
            pendingMemberSkillRequests: {},
        });

        return () => {
            const c = get().channel;
            if (c) {
                try { void supabase.removeChannel(c); } catch { }
            }
            set({
                channel: null, partyId: null,
                lastAppliedSeq: 0,
                lastSpellByCaster: {},
                lastDamageByAttacker: {},
                lastBossDamageByAttacker: {},
                lastAttackAction: null,
                lastMemberHit: null,
                lastBossState: null,
                lastRaidState: null,
                lastTrainerState: null,
                lastTrainerAttackByAttacker: {},
                pendingMemberSkillRequests: {},
            });
        };
    },

    publishState: (snapshot) => {
        const now = Date.now();
        if (now - lastPublishAt < MIN_STATE_PUBLISH_MS) return;
        const { channel } = get();
        if (!channel) return;
        lastPublishAt = now;
        outboundSeq += 1;
        void channel.send({
            type: 'broadcast',
            event: 'state',
            payload: { ...snapshot, seq: outboundSeq, sentAt: now } satisfies IPartyCombatStateSnapshot,
        });
    },

    publishSpellCast: (cast) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        const full: IPartySpellCast = { ...cast, sentAt: now };
        set((s) => ({
            lastSpellByCaster: { ...s.lastSpellByCaster, [cast.casterId]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'spell-cast',
            payload: full,
        });
    },

    publishCombatSpeed: (speed) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'combat-speed',
            payload: { speed, sentAt: Date.now() } satisfies IPartyCombatSpeed,
        });
    },

    publishCombatEnd: () => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'combat-end',
            payload: { sentAt: Date.now() },
        });
    },

    publishVictory: ({ earnedXp, earnedGold }) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'victory',
            payload: { earnedXp, earnedGold },
        });
    },

    publishAttackAction: (action) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        void channel.send({
            type: 'broadcast',
            event: 'attack-action',
            payload: { ...action, sentAt: now } satisfies IPartyAttackAction,
        });
    },

    publishDamageEvent: (event) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        const full: IPartyDamageEvent = { ...event, sentAt: now };
        set((s) => ({
            lastDamageByAttacker: { ...s.lastDamageByAttacker, [event.attackerId]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'damage-event',
            payload: full,
        });
    },

    publishMemberHit: (hit) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        void channel.send({
            type: 'broadcast',
            event: 'member-hit',
            payload: { ...hit, sentAt: now } satisfies IPartyMemberHit,
        });
    },

    publishMonsterKilled: (k) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        killSeqOutbound += 1;
        void channel.send({
            type: 'broadcast',
            event: 'monster-killed',
            payload: { ...k, seq: killSeqOutbound, sentAt: now } satisfies IPartyMonsterKilled,
        });
    },

    publishBossState: (snapshot) => {
        const now = Date.now();
        const prev = get().lastBossState;
        const phaseChanged = !prev || prev.phase !== snapshot.phase;
        if (!phaseChanged && now - lastBossPublishAt < MIN_STATE_PUBLISH_MS) return;
        const { channel } = get();
        if (!channel) return;
        lastBossPublishAt = now;
        bossSeqOutbound += 1;
        const full: IPartyBossState = { ...snapshot, seq: bossSeqOutbound, sentAt: now };
        set({ lastBossState: full });
        void channel.send({
            type: 'broadcast',
            event: 'boss-state',
            payload: full,
        });
    },

    requestMemberBossEntry: (bossId) => {
        set({ pendingBossEntryAt: Date.now(), pendingBossEntryBossId: bossId });
    },

    requestMemberRaidEntry: (raidId) => {
        set({ pendingRaidEntryAt: Date.now(), pendingRaidEntryRaidId: raidId });
    },

    publishBossDamage: (ev) => {
        const { channel } = get();
        if (!channel) return;
        const full: IPartyBossDamageEvent = { ...ev, sentAt: Date.now() };
        const key = `${ev.attackerId}::${ev.targetId}`;
        set((s) => ({
            lastBossDamageByAttacker: { ...s.lastBossDamageByAttacker, [key]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'boss-damage',
            payload: full,
        });
    },

    publishRaidDamage: (ev) => {
        const { channel } = get();
        if (!channel) return;
        const full: IPartyRaidDamageEvent = { ...ev, sentAt: Date.now() };
        const key = `${ev.attackerId}::${ev.targetId}::${ev.sourceBossId ?? ''}`;
        set((s) => ({
            lastRaidDamageByAttacker: { ...s.lastRaidDamageByAttacker, [key]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'raid-damage',
            payload: full,
        });
    },

    publishBossKilled: ({ bossId, aliveMemberIds }) => {
        const { channel } = get();
        if (!channel) return;
        const full = { bossId, aliveMemberIds, sentAt: Date.now() };
        set({ lastBossKilled: full });
        void channel.send({
            type: 'broadcast',
            event: 'boss-killed',
            payload: full,
        });
    },

    publishBossEntrySkip: () => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'boss-entry-skip',
            payload: { sentAt: Date.now() },
        });
    },

    publishRaidState: (snapshot) => {
        const now = Date.now();
        const prev = get().lastRaidState;
        const phaseChanged = !prev || prev.phase !== snapshot.phase;
        const waveChanged = !prev || prev.currentWave !== snapshot.currentWave;
        const prevAliveBosses = (prev?.bosses ?? []).filter((b) => !b.isDead).length;
        const nextAliveBosses = (snapshot.bosses ?? []).filter((b) => !b.isDead).length;
        const aliveBossesChanged = prevAliveBosses !== nextAliveBosses;
        const prevDeadMembers = (prev?.members ?? []).filter((m) => m.isDead).length;
        const nextDeadMembers = (snapshot.members ?? []).filter((m) => m.isDead).length;
        const deadMembersChanged = prevDeadMembers !== nextDeadMembers;
        if (
            !phaseChanged && !waveChanged &&
            !aliveBossesChanged && !deadMembersChanged &&
            now - lastRaidPublishAt < MIN_STATE_PUBLISH_MS
        ) return;
        const { channel } = get();
        if (!channel) return;
        lastRaidPublishAt = now;
        raidSeqOutbound += 1;
        const full: IPartyRaidState = { ...snapshot, seq: raidSeqOutbound, sentAt: now };
        set({ lastRaidState: full });
        void channel.send({
            type: 'broadcast',
            event: 'raid-state',
            payload: full,
        });
    },

    publishTrainerState: (s) => {
        const now = Date.now();
        const { channel } = get();
        const full: IPartyTrainerState = { ...s, sentAt: now };
        set({ lastTrainerState: full });
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'trainer-state',
            payload: full,
        });
    },

    publishTrainerAttack: (ev) => {
        const now = Date.now();
        const { channel } = get();
        trainerAttackSeq += 1;
        const full: IPartyTrainerAttack = { ...ev, sentAt: now, seq: trainerAttackSeq };
        const key = `${ev.attackerId}::${full.seq}`;
        set((s) => ({
            lastTrainerAttackByAttacker: { ...s.lastTrainerAttackByAttacker, [key]: full },
        }));
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'trainer-attack',
            payload: full,
        });
    },

    publishMemberSkillRequest: (memberId, skillId) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'member-skill-request',
            payload: { memberId, skillId, sentAt: Date.now() },
        });
    },

    consumeMemberSkillRequest: (memberId) => {
        const queue = get().pendingMemberSkillRequests[memberId];
        if (!queue || queue.length === 0) return null;
        const [head, ...rest] = queue;
        set((s) => {
            const next = { ...s.pendingMemberSkillRequests };
            if (rest.length === 0) {
                delete next[memberId];
            } else {
                next[memberId] = rest;
            }
            return { pendingMemberSkillRequests: next };
        });
        return head;
    },

    clear: () => {
        const { channel } = get();
        if (channel) {
            try { void supabase.removeChannel(channel); } catch { }
        }
        outboundSeq = 0;
        lastPublishAt = 0;
        killSeqOutbound = 0;
        lastBossPublishAt = 0;
        bossSeqOutbound = 0;
        lastRaidPublishAt = 0;
        raidSeqOutbound = 0;
        set({
            channel: null,
            partyId: null,
            lastAppliedSeq: 0,
            lastSpellByCaster: {},
            lastDamageByAttacker: {},
            lastBossDamageByAttacker: {},
            lastRaidDamageByAttacker: {},
            lastAttackAction: null,
            lastMemberHit: null,
            lastMonsterKilled: null,
            lastBossState: null,
            lastRaidState: null,
            lastTrainerState: null,
            lastTrainerAttackByAttacker: {},
            lastBossEntrySkipAt: 0,
            lastCombatEndAt: 0,
            pendingMemberSkillRequests: {},
        });
    },
}));
