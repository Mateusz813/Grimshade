import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import { useCombatStore } from '../stores/combatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { usePartyCombatSyncStore } from '../stores/partyCombatSyncStore';
import { usePartyDamageStore } from '../stores/partyDamageStore';
import { handleMonsterDeath, applyMonsterKillRewardsForMember, stopCombat } from '../systems/combatEngine';


export const usePartyCombatSync = (): void => {
    const navigate  = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party     = usePartyStore((s) => s.party);
    const subscribe = usePartyCombatSyncStore((s) => s.subscribe);
    const clear     = usePartyCombatSyncStore((s) => s.clear);

    const cleanupRef = useRef<(() => void) | null>(null);
    const reviveProtectUntilRef = useRef<number>(0);

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
    }, [party?.id, character?.id, party?.members.length]);

    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId !== character.id) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;

        const sendCurrent = () => {
            const s = useCombatStore.getState();
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

        const unsubDamage = usePartyDamageStore.subscribe((s, prev) => {
            if (s.damage === prev.damage) return;
            sendCurrent();
        });

        return () => {
            unsub();
            unsubDamage();
        };
    }, [party?.id, party?.leaderId, character?.id, party?.members]);

    useEffect(() => {
        if (!party?.id || !character) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;
        if (party.leaderId === character.id) return;
        let lastSeen = 0;
        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            if (s.lastCombatEndAt === prev.lastCombatEndAt) return;
            if (s.lastCombatEndAt <= lastSeen) return;
            lastSeen = s.lastCombatEndAt;
            stopCombat();
            navigate('/');
        });
        return () => { unsub(); };
    }, [party?.id, party?.leaderId, character?.id, navigate, party?.members]);

    const combatSpeed = useSettingsStore((s) => s.combatSpeed);
    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId !== character.id) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;
        usePartyCombatSyncStore.getState().publishCombatSpeed(combatSpeed);
    }, [party?.id, party?.leaderId, character?.id, party?.members, combatSpeed]);

    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId === character.id) return;

        let lastKillSeq = 0;
        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const k = s.lastMonsterKilled;
            if (!k) return;
            if (k === prev.lastMonsterKilled) return;
            if (lastKillSeq > 0 && k.seq > lastKillSeq + 1) {
                console.warn(
                    `[party-combat] missed ${k.seq - lastKillSeq - 1} kill broadcast(s) (last=${lastKillSeq}, got=${k.seq})`,
                );
            }
            lastKillSeq = k.seq;
            applyMonsterKillRewardsForMember(k.monsterId, k.monsterLevel, k.monsterRarity, k.finalXp);
        });
        return () => { unsub(); };
    }, [party?.id, party?.leaderId, character?.id]);

    useEffect(() => {
        if (!party?.id || !character) return;

        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const hit = s.lastMemberHit;
            if (!hit) return;
            if (hit === prev.lastMemberHit) return;

            if (hit.memberId === character.id) {
                if (Date.now() < reviveProtectUntilRef.current) return;
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
                        hpDamage: hit.damage,
                        mpDamage: 0,
                        attackerWaveIdx: hit.sourceMonsterIdx,
                    },
                    timestamp: Date.now(),
                });
            }
        });
        return () => { unsub(); };
    }, [party?.id, character?.id]);

    useEffect(() => {
        if (!party?.id || !character) return;

        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const revive = s.lastMemberRevive;
            if (!revive) return;
            if (revive === prev.lastMemberRevive) return;
            if (revive.memberId !== character.id) return;

            const cs = useCombatStore.getState();
            if (cs.playerCurrentHp > 0) return;

            const ch = useCharacterStore.getState().character;
            const maxHp = ch?.max_hp ?? 0;
            if (maxHp <= 0) return;
            const restoredHp = Math.max(1, Math.floor(maxHp * revive.hpPct));
            reviveProtectUntilRef.current = Date.now() + revive.protectMs;
            useCombatStore.getState().setHps(cs.monsterCurrentHp, restoredHp);
            useCharacterStore.getState().updateCharacter({ hp: restoredHp });
            useCombatStore.getState().addLog(
                `:sparkles: Zostajesz wskrzeszony! +${restoredHp} HP (ochrona ${Math.round(revive.protectMs / 1000)}s)`,
                'system',
            );
        });
        return () => { unsub(); };
    }, [party?.id, character?.id]);

    useEffect(() => {
        if (!party?.id || !character) return;
        if (party.leaderId !== character.id) return;
        const otherHumans = party.members.filter((m) => m.id !== character.id && !m.isBot);
        if (otherHumans.length === 0) return;

        const unsub = usePartyCombatSyncStore.subscribe((s, prev) => {
            const action = s.lastAttackAction;
            if (!action) return;
            if (action === prev.lastAttackAction) return;
            const cs = useCombatStore.getState();
            if (cs.phase !== 'fighting') return;
            const tgtIdx = cs.activeTargetIdx;
            cs.dealToMonster(action.damage);
            usePartyCombatSyncStore.getState().publishDamageEvent({
                attackerId:   action.attackerId,
                attackerName: action.attackerName,
                damage:       action.damage,
                isCrit:       action.isCrit,
                targetIdx:    tgtIdx,
                hand:         action.hand ?? null,
            });
            const afterCs = useCombatStore.getState();
            if (afterCs.monsterCurrentHp <= 0 && afterCs.phase === 'fighting') {
                handleMonsterDeath(afterCs.monsterRarity);
            }
        });
        return () => { unsub(); };
    }, [party?.id, party?.leaderId, character?.id, party?.members]);
};
