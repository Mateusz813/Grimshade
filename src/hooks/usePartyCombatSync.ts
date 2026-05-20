import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import { useCombatStore } from '../stores/combatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { usePartyCombatSyncStore } from '../stores/partyCombatSyncStore';
import { usePartyDamageStore } from '../stores/partyDamageStore';
import { handleMonsterDeath, applyMonsterKillRewardsForMember, stopCombat } from '../systems/combatEngine';

/**
 * Leader-authoritative combat-sync wiring.
 *
 *  • Both clients subscribe to `party-combat-<partyId>` so spell-cast
 *    cues + state snapshots flow between them.
 *  • The LEADER also watches their local combatStore and broadcasts a
 *    state snapshot on every meaningful change (monster HP, wave,
 *    phase) so members can mirror the SAME fight on their screen.
 *  • The LEADER additionally broadcasts combatSpeed changes so the
 *    members' UI runs at the same x1/x2/x4 cadence.
 *  • Members' local engine is suppressed elsewhere (`useBackgroundCombat`)
 *    — they NEVER simulate combat themselves; they paint what the
 *    leader sends.
 *
 * Solo / bots-only parties: skipped (no other human to sync with).
 */

export const usePartyCombatSync = (): void => {
    const navigate  = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party     = usePartyStore((s) => s.party);
    const subscribe = usePartyCombatSyncStore((s) => s.subscribe);
    const clear     = usePartyCombatSyncStore((s) => s.clear);

    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!party?.id || !character) {
            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
            }
            clear();
            return;
        }
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) {
            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
            }
            clear();
            return;
        }
        const cleanup = subscribe(party.id);
        cleanupRef.current = cleanup;
        return () => {
            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [party?.id, character?.id, party?.members.length]);

    // ── Leader-side broadcast of combat state ──────────────────────────────
    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId !== character.id) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;

        const sendCurrent = () => {
            const s = useCombatStore.getState();
            // 2026-05-12 spec ("damage counter wspolny dla wszystkich"):
            // ship the leader's authoritative damage tally so members
            // overwrite their local map and stay in lockstep — even if
            // a `damage-event` broadcast was lost in transit.
            const partyDamage = { ...usePartyDamageStore.getState().damage };
            usePartyCombatSyncStore.getState().publishState({
                senderId:         character.id,
                phase:            s.phase,
                waveMonsters:     s.waveMonsters,
                wavePlannedCount: s.wavePlannedCount,
                activeTargetIdx:  s.activeTargetIdx,
                monsterCurrentHp: s.monsterCurrentHp,
                monsterMaxHp:     s.monsterMaxHp,
                monster:          s.monster,
                monsterRarity:    s.monsterRarity,
                partyDamage,
            });
        };

        // Initial push so a member that just joined sees the live state.
        sendCurrent();

        const unsub = useCombatStore.subscribe((s, prev) => {
            const phaseChanged   = s.phase !== prev.phase;
            const targetChanged  = s.activeTargetIdx !== prev.activeTargetIdx;
            const plannedChanged = s.wavePlannedCount !== prev.wavePlannedCount;
            const hpChanged      = s.monsterCurrentHp !== prev.monsterCurrentHp;
            const waveChanged    = s.waveMonsters !== prev.waveMonsters;
            const monsterChanged = s.monster?.id !== prev.monster?.id;
            if (
                phaseChanged || targetChanged || plannedChanged ||
                hpChanged || waveChanged || monsterChanged
            ) {
                sendCurrent();
            }
            if (phaseChanged && s.phase === 'victory') {
                usePartyCombatSyncStore.getState().publishVictory({
                    earnedXp:   s.earnedXp,
                    earnedGold: s.earnedGold,
                });
            }
        });

        // 2026-05-12: also broadcast when the leader's damage map
        // changes — this is the high-frequency stream that drives
        // the party-widget tooltip on EVERY client. The throttle in
        // `publishState` (120 ms) keeps the channel from drowning,
        // and members SET their store from each snap (not accumulate),
        // so the counters lock-step with the leader.
        const unsubDamage = usePartyDamageStore.subscribe((s, prev) => {
            if (s.damage === prev.damage) return;
            sendCurrent();
        });

        return () => {
            unsub();
            unsubDamage();
        };
    }, [party?.id, party?.leaderId, character?.id, party?.members]);

    // ── Member-side: react to leader's "combat ended" signal ─────────────
    // 2026-05-12 spec ("lider konczy polowanie -> sojusznicy wracaja do
    // miasta"): leader's `stopCombat` broadcasts a combat-end event.
    // Member's client receives, sets `lastCombatEndAt` in the sync
    // store. This subscriber notices the change and:
    //   • Calls local `stopCombat` to wipe the member's stale combat
    //     state (was a mirror of the leader's — now obsolete).
    //   • Navigates to `/` (town) so the member visibly returns to
    //     the city instead of being stranded on /combat with a frozen
    //     monster card.
    // Leaders skip — they're the ones doing the exit, they navigate
    // themselves.
    useEffect(() => {
        if (!party?.id || !character) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;
        if (party.leaderId === character.id) return; // leader exits themselves
        let lastSeen = 0;
        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            if (s.lastCombatEndAt === prev.lastCombatEndAt) return;
            if (s.lastCombatEndAt <= lastSeen) return;
            lastSeen = s.lastCombatEndAt;
            // Stop the local engine + clear shared state.
            stopCombat();
            // Send the player to town.
            navigate('/');
        });
        return () => { unsub(); };
    }, [party?.id, party?.leaderId, character?.id, navigate, party?.members]);

    // ── Leader-side broadcast of combat-speed changes ──────────────────────
    // The settings change triggers an effect that broadcasts the new
    // setting to all members so their auto-fight / attack intervals
    // match. Members ignore their own combatSpeed input (locked UI) so
    // there's no echo back.
    const combatSpeed = useSettingsStore((s) => s.combatSpeed);
    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId !== character.id) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;
        usePartyCombatSyncStore.getState().publishCombatSpeed(combatSpeed);
    }, [party?.id, party?.leaderId, character?.id, party?.members, combatSpeed]);

    // ── Member-side: consume `monster-killed` from leader ─────────────────
    // The leader's engine resolved a kill on its authoritative state and
    // broadcast a kill announcement. Each non-leader member rolls THEIR
    // OWN rewards locally — independent drops, independent XP scaled by
    // their own mastery + party multiplier, task / quest / mastery
    // credit applied to their own character. The leader has already
    // applied their own (in handleMonsterDeath) before broadcasting.
    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId === character.id) return; // leader self-applied

        // 2026-05-11 CRITICAL FIX ("przy x4 jednego strong nie zaliczylo"):
        // the old `sentAt <= lastSeen` gate dropped any broadcast whose
        // timestamp matched the previous one. Reference inequality is
        // sufficient — Zustand fires subscribers synchronously per set.
        //
        // 2026-05-12: track seq to detect Supabase Realtime drops. If
        // the leader sent seq N but we last saw N-2, one kill was lost
        // in transit. We log a warning so we can quantify the loss
        // rate; for retry / catch-up logic see future iterations.
        let lastKillSeq = 0;
        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const k = s.lastMonsterKilled;
            if (!k) return;
            if (k === prev.lastMonsterKilled) return;
            if (lastKillSeq > 0 && k.seq > lastKillSeq + 1) {
                // eslint-disable-next-line no-console
                console.warn(
                    `[party-combat] missed ${k.seq - lastKillSeq - 1} kill broadcast(s) (last=${lastKillSeq}, got=${k.seq})`,
                );
            }
            lastKillSeq = k.seq;
            applyMonsterKillRewardsForMember(k.monsterId, k.monsterLevel, k.monsterRarity, k.finalXp);
        });
        return () => { unsub(); };
    }, [party?.id, party?.leaderId, character?.id]);

    // ── All clients: consume `member-hit` from leader ──────────────────────
    // The leader's engine decides which party human gets hit, broadcasts
    // member-hit to the channel. Two things happen on receipt:
    //   • The TARGETED member applies the damage to their own
    //     character.hp + combatStore.playerCurrentHp, and emits a
    //     local `playerHit` event so their TopHeader + ally card
    //     flash.
    //   • EVERY client (incl. the leader who doesn't get their own
    //     broadcast — they emit a parallel local event when they
    //     resolve the hit, see combatEngine.ts) renders a floating
    //     damage number on the targeted member's ally slot so the
    //     whole party visually sees who took the hit.
    useEffect(() => {
        if (!party?.id || !character) return;

        // 2026-05-11 CRITICAL FIX: same same-ms collision issue as
        // monster-killed (see comment in that subscriber). Dropped the
        // timestamp gate — reference inequality is sufficient.
        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const hit = s.lastMemberHit;
            if (!hit) return;
            if (hit === prev.lastMemberHit) return;

            // Branch 1: I am the target → apply damage + local hit anim.
            if (hit.memberId === character.id) {
                const cs = useCombatStore.getState();
                const newHp = Math.max(0, cs.playerCurrentHp - hit.damage);
                useCombatStore.getState().setHps(cs.monsterCurrentHp, newHp);
                const ch = useCharacterStore.getState().character;
                if (ch) {
                    useCharacterStore.getState().updateCharacter({
                        hp: Math.max(0, (ch.hp ?? 0) - hit.damage),
                    });
                }
                useCombatStore.getState().emitCombatEvent({
                    type: 'playerHit',
                    data: {
                        damage: hit.damage,
                        isCrit: false,
                        isBlocked: false,
                        hpDamage: hit.damage,
                        mpDamage: 0,
                        attackerWaveIdx: hit.sourceMonsterIdx,
                    },
                    timestamp: Date.now(),
                });
            }
            // Branch 2: regardless of who's the target, all clients
            // render an animation on the targeted member's ally card.
            // We piggyback on `lastMemberHit` itself — Combat.tsx
            // watches that field and draws an "ally-basic" damage
            // float on the matching ally slot (see effect there).
        });
        return () => { unsub(); };
    }, [party?.id, character?.id]);

    // ── Leader-side: consume `attack-action` requests from members ─────────
    // When a member's local engine wants to swing, it broadcasts an
    // attack-action with the rolled damage instead of touching its own
    // combatStore. The leader applies it to their authoritative monster
    // and echoes back a damage-event so every client (including the
    // attacking member) renders the floating number + hit animation.
    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId !== character.id) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;

        // 2026-05-11 CRITICAL FIX: same same-ms collision pattern.
        // Reference inequality is sufficient — Zustand fires subscriber
        // per `set` call; Supabase delivers one event per send.
        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const action = s.lastAttackAction;
            if (!action) return;
            if (action === prev.lastAttackAction) return;
            // Apply on leader's combatStore using the leader's CURRENT
            // active target (member's target idx may be stale by a
            // tick — leader's view is authoritative).
            const cs = useCombatStore.getState();
            if (cs.phase !== 'fighting') return;
            const tgtIdx = cs.activeTargetIdx;
            cs.dealToMonster(action.damage);
            // Echo as damage-event so all clients render the hit.
            usePartyCombatSyncStore.getState().publishDamageEvent({
                attackerId:   action.attackerId,
                attackerName: action.attackerName,
                damage:       action.damage,
                isCrit:       action.isCrit,
                targetIdx:    tgtIdx,
                hand:         action.hand ?? null,
            });
            // Did this hit kill the active monster? Hand off to the
            // engine's death handler so loot / wave advance fires.
            const afterCs = useCombatStore.getState();
            if (afterCs.monsterCurrentHp <= 0 && afterCs.phase === 'fighting') {
                handleMonsterDeath(afterCs.monsterRarity);
            }
        });
        return () => { unsub(); };
    }, [party?.id, party?.leaderId, character?.id, party?.members]);
};
