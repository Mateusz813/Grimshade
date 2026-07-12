import { useEffect, useRef } from 'react';
import { useCombatStore } from '../stores/combatStore';
import { useCharacterStore } from '../stores/characterStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useCooldownStore } from '../stores/cooldownStore';
import { useBotStore } from '../stores/botStore';
import { useAppRouteStore } from '../stores/appRouteStore';
import { usePartyStore } from '../stores/partyStore';
import { isBackendMode } from '../config/backendMode';
import { commitCombatEventNow } from '../stores/characterScope';
import {
    doPlayerAttackTick,
    doMonsterAttackTick,
    doBotAttackTick,
    startAutoNextFight,
    resolveInstantFight,
    stopCombat,
    getAttackMs,
    getEffectiveChar,
    tryAutoPotion,
    simulateOfflineCombat,
    advanceSkillCooldowns,
    huntStatusTick,
    SPEED_MULT,
} from '../systems/combatEngine';
import { xpToNextLevel } from '../systems/levelSystem';
import { formatGoldShort } from '../systems/goldFormat';

export const AUTO_FIGHT_DELAY_MS = 1000;
const MAX_BACKGROUND_COMBAT_MS = 10 * 60 * 60 * 1000;
const OFFLINE_GAP_THRESHOLD_MS = 10_000;

export const useBackgroundCombat = () => {
    const character = useCharacterStore((s) => s.character);
    const phase = useCombatStore((s) => s.phase);
    const combatSpeed = useSettingsStore((s) => s.combatSpeed);
    const autoFight = useCombatStore((s) => s.autoFight);
    const backgroundStartedAt = useCombatStore((s) => s.backgroundStartedAt);
    const monster = useCombatStore((s) => s.monster);

    const backgroundActive = useCombatStore((s) => s.backgroundActive);
    const totalKills = useCombatStore((s) => {
        const sk = s.sessionKills as Record<string, number> | undefined;
        return sk ? Object.values(sk).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    });
    const huntCommittedRef = useRef(0);
    const wasAutoHuntingRef = useRef(false);
    useEffect(() => {
        if (!isBackendMode()) return;
        if (totalKills < huntCommittedRef.current) huntCommittedRef.current = 0;
        if (totalKills > 0 && totalKills - huntCommittedRef.current >= 25) {
            huntCommittedRef.current = totalKills;
            commitCombatEventNow({ type: 'hunt', outcome: 'settled', wavesCompleted: totalKills });
        }
    }, [totalKills]);
    useEffect(() => {
        const autoHunting = ((phase === 'fighting' || phase === 'victory') && autoFight) || backgroundActive;
        if (isBackendMode() && wasAutoHuntingRef.current && !autoHunting) {
            const sk = useCombatStore.getState().sessionKills as Record<string, number> | undefined;
            const total = sk ? Object.values(sk).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
            const died = phase === 'dead';
            if (total > huntCommittedRef.current || died) {
                huntCommittedRef.current = total;
                commitCombatEventNow({ type: 'hunt', outcome: died ? 'lost' : 'settled', died, wavesCompleted: total });
            }
        }
        wasAutoHuntingRef.current = autoHunting;
    }, [phase, autoFight, backgroundActive]);

    const botsKey = useBotStore((s) => s.bots.map((b) => b.id).join(','));
    const partyId = usePartyStore((s) => s.party?.id);
    const partyLeaderId = usePartyStore((s) => s.party?.leaderId);
    const otherHumansKey = usePartyStore((s) => {
        if (!s.party) return '';
        return s.party.members
            .filter((m) => !m.isBot && m.id !== character?.id)
            .map((m) => m.id)
            .join(',');
    });
    const isNonLeaderMember = !!(
        partyId &&
        partyLeaderId &&
        character?.id &&
        partyLeaderId !== character.id &&
        otherHumansKey.length > 0
    );
    const isCharacterlessRoute = useAppRouteStore((s) => s.isCharacterless);

    const offlineCatchUpDone = useRef(false);

    useEffect(() => {
        const doCatchUp = (): void => {
            const cs = useCombatStore.getState();
            if (!cs.lastCombatTickAt) return;
            if (cs.phase !== 'fighting' && cs.phase !== 'victory') return;
            if (!cs.baseMonster) return;

            const psParty = usePartyStore.getState().party;
            const meChar = useCharacterStore.getState().character;
            const otherH = psParty?.members.filter((m) => !m.isBot && m.id !== meChar?.id) ?? [];
            const isMember = !!(psParty && meChar && otherH.length > 0 && psParty.leaderId !== meChar.id);
            if (isMember) return;

            const gapMs = Date.now() - new Date(cs.lastCombatTickAt).getTime();
            if (gapMs >= OFFLINE_GAP_THRESHOLD_MS) {
                const result = simulateOfflineCombat(gapMs);
                if (result && result.kills > 0) {
                    useCombatStore.getState().addLog(
                        `:alarm-clock: Walka offline: ${result.kills} killi, +${result.xpEarned.toLocaleString('pl-PL')} XP, +${formatGoldShort(result.goldEarned)} (${result.elapsedMinutes} min)`,
                        'system',
                    );
                    if (result.levelUps > 0) {
                        useCombatStore.getState().addLog(
                            `:party-popper: Awans! Zdobyłeś ${result.levelUps} poziomów podczas walki offline!`,
                            'system',
                        );
                    }
                    if (result.died) {
                        useCombatStore.getState().addLog(':skull: Zginąłeś podczas walki offline!', 'system');
                    }
                }
            }
        };

        if (!offlineCatchUpDone.current) {
            offlineCatchUpDone.current = true;
            doCatchUp();
        }

        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'visible') {
                doCatchUp();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (phase !== 'fighting' || combatSpeed === 'SKIP' || !character) return;
        if (isCharacterlessRoute) return;
        const effChar = getEffectiveChar(character);
        if (!effChar) return;
        const mult = SPEED_MULT[combatSpeed] ?? 1;
        const attackIntervalMs = Math.max(200, getAttackMs(effChar.attack_speed ?? 1) / mult);

        let lastPlayerTickAt = Date.now();

        const tickMs = Math.min(attackIntervalMs, 1000);

        const id = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastPlayerTickAt;
            const ticksToProcess = Math.max(1, Math.floor(elapsed / attackIntervalMs));

            const maxBatch = Math.min(ticksToProcess, 200);
            for (let i = 0; i < maxBatch; i++) {
                if (useCombatStore.getState().phase !== 'fighting') break;
                if (i > 0) {
                    useCooldownStore.getState().tick(attackIntervalMs);
                    advanceSkillCooldowns(attackIntervalMs);
                }
                doPlayerAttackTick();
            }

            lastPlayerTickAt = now;
            useCombatStore.getState().setLastCombatTickAt(new Date(now).toISOString());
        }, tickMs);

        useCombatStore.getState().setLastCombatTickAt(new Date().toISOString());

        return () => clearInterval(id);
    }, [phase, combatSpeed, character?.id, character?.attack_speed, monster?.id, isCharacterlessRoute, isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'fighting' || combatSpeed === 'SKIP' || !monster) return;
        if (isCharacterlessRoute) return;
        if (isNonLeaderMember) return;
        const mult = SPEED_MULT[combatSpeed] ?? 1;
        const monsterIntervalMs = Math.max(200, getAttackMs(monster.speed) / mult);

        let lastMonsterTickAt = Date.now();
        const tickMs = Math.min(monsterIntervalMs, 1000);

        const id = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastMonsterTickAt;
            const ticksToProcess = Math.max(1, Math.floor(elapsed / monsterIntervalMs));

            const maxBatch = Math.min(ticksToProcess, 200);
            for (let i = 0; i < maxBatch; i++) {
                if (useCombatStore.getState().phase !== 'fighting') break;
                if (i > 0) {
                    useCooldownStore.getState().tick(monsterIntervalMs);
                    advanceSkillCooldowns(monsterIntervalMs);
                }
                doMonsterAttackTick();
            }

            lastMonsterTickAt = now;
        }, tickMs);

        return () => clearInterval(id);
    }, [phase, combatSpeed, monster?.id, monster?.speed, isCharacterlessRoute, isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'fighting' || combatSpeed === 'SKIP') return;
        if (!botsKey) return;
        if (isCharacterlessRoute) return;
        if (isNonLeaderMember) return;
        const mult = SPEED_MULT[combatSpeed] ?? 1;
        const botIntervalMs = Math.max(300, Math.floor(1800 / mult));
        const id = setInterval(() => {
            if (useCombatStore.getState().phase !== 'fighting') return;
            doBotAttackTick();
        }, botIntervalMs);
        return () => clearInterval(id);
    }, [phase, combatSpeed, botsKey, isCharacterlessRoute, isNonLeaderMember]);

    useEffect(() => {
        if (phase !== 'fighting') return;
        if (isCharacterlessRoute) return;
        const id = setInterval(() => huntStatusTick(), 250);
        return () => clearInterval(id);
    }, [phase, isCharacterlessRoute]);

    useEffect(() => {
        if (phase !== 'fighting') return;
        if (combatSpeed === 'SKIP') return;
        if (isCharacterlessRoute) return;
        const id = setInterval(() => {
            const live = useCombatStore.getState();
            if (live.phase !== 'fighting') return;
            doPlayerAttackTick(true);
        }, 250);
        return () => clearInterval(id);
    }, [phase, combatSpeed, isCharacterlessRoute]);

    useEffect(() => {
        if ((phase !== 'fighting' && phase !== 'victory') || combatSpeed === 'SKIP') return;
        if (isCharacterlessRoute) return;
        const speedMult = SPEED_MULT[combatSpeed] ?? 1;
        const decPerTick = 100 * speedMult;
        let lastTickAt = Date.now();
        const interval = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastTickAt;
            lastTickAt = now;
            const realDec = Math.floor(elapsed * speedMult);
            useCooldownStore.getState().tick(Math.min(realDec, decPerTick * 20));
        }, 100);
        return () => clearInterval(interval);
    }, [phase, combatSpeed, isCharacterlessRoute]);

    useEffect(() => {
        if (phase !== 'victory') return;
        if (!autoFight) return;
        if (isCharacterlessRoute) return;
        if (isNonLeaderMember) return;
        const { baseMonster } = useCombatStore.getState();
        if (!baseMonster) return;

        if (combatSpeed === 'SKIP') {
            const timer = setTimeout(() => startAutoNextFight(), 10);
            return () => clearTimeout(timer);
        }

        const potionTick = (): void => {
            const s = useCombatStore.getState();
            const ch = useCharacterStore.getState().character;
            if (!ch) return;
            const effChar = getEffectiveChar(ch);
            tryAutoPotion(
                s.playerCurrentHp, effChar?.max_hp ?? ch.max_hp,
                s.playerCurrentMp, effChar?.max_mp ?? ch.max_mp,
            );
        };
        potionTick();
        const potionInterval = setInterval(potionTick, 200);

        const timer = setTimeout(() => {
            clearInterval(potionInterval);
            startAutoNextFight();
        }, AUTO_FIGHT_DELAY_MS);

        return () => {
            clearInterval(potionInterval);
            clearTimeout(timer);
        };
    }, [phase, combatSpeed, autoFight, isCharacterlessRoute, isNonLeaderMember]);

    useEffect(() => {
        if (combatSpeed !== 'SKIP' || phase !== 'fighting' || !monster || !character) return;
        if (isCharacterlessRoute) return;
        if (isNonLeaderMember) return;
        const rarity = useCombatStore.getState().monsterRarity;
        const s = useCombatStore.getState();
        resolveInstantFight(monster, s.playerCurrentHp, s.playerCurrentMp, rarity);
    }, [combatSpeed]);

    useEffect(() => {
        if (!backgroundStartedAt) return;
        const elapsed = Date.now() - new Date(backgroundStartedAt).getTime();
        const remaining = MAX_BACKGROUND_COMBAT_MS - elapsed;
        if (remaining <= 0) {
            stopCombat();
            return;
        }
        const timer = setTimeout(() => {
            stopCombat();
        }, remaining);
        return () => clearTimeout(timer);
    }, [backgroundStartedAt]);

    const xpSessionRef = useRef({
        startedAt: Date.now(),
        totalEarned: 0,
        lastXp: 0,
        lastLevel: 0,
        initialized: false,
    });
    useEffect(() => {
        if (!character) return;
        const s = xpSessionRef.current;
        if (!s.initialized) {
            s.startedAt = Date.now();
            s.totalEarned = 0;
            s.lastXp = character.xp;
            s.lastLevel = character.level;
            s.initialized = true;
            return;
        }
        if (character.level > s.lastLevel) {
            let earned = xpToNextLevel(s.lastLevel) - s.lastXp;
            for (let lv = s.lastLevel + 1; lv < character.level; lv++) {
                earned += xpToNextLevel(lv);
            }
            earned += character.xp;
            s.totalEarned += Math.max(0, earned);
        } else if (character.xp > s.lastXp) {
            s.totalEarned += character.xp - s.lastXp;
        }
        s.lastXp = character.xp;
        s.lastLevel = character.level;
    }, [character?.xp, character?.level, character]);

    useEffect(() => {
        const id = setInterval(() => {
            const s = xpSessionRef.current;
            if (!s.initialized) return;
            const elapsedH = (Date.now() - s.startedAt) / 3600000;
            if (elapsedH < 1 / 600) return;
            useCombatStore.getState().setSessionXpPerHour(Math.floor(s.totalEarned / elapsedH));
        }, 1000);
        return () => clearInterval(id);
    }, []);

};
