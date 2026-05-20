/**
 * Global combat hook that runs the combat loop independently of routing.
 * Mounted in App.tsx (above BrowserRouter) so combat persists across navigation.
 *
 * Key features:
 * - Timestamp-based catch-up: when browser throttles background tabs, processes
 *   multiple attack cycles per tick based on real elapsed time.
 * - Offline simulation: when computer sleeps/wakes, detects the time gap and
 *   mathematically simulates all fights that would have happened.
 */
import { useEffect, useRef } from 'react';
import { useCombatStore } from '../stores/combatStore';
import { useCharacterStore } from '../stores/characterStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useCooldownStore } from '../stores/cooldownStore';
import { useBotStore } from '../stores/botStore';
import { useAppRouteStore } from '../stores/appRouteStore';
import { usePartyStore } from '../stores/partyStore';
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

/** Delay between victory and the next auto-fight kicking off (normal speeds).
 *  Exported so the in-fight UI can render a matching countdown bar above the
 *  "Walcz ponownie" button — single source of truth for the wait window. */
export const AUTO_FIGHT_DELAY_MS = 1000;
const MAX_BACKGROUND_COMBAT_MS = 10 * 60 * 60 * 1000; // 10 hours
/** If more than 10s passed since last tick, trigger offline simulation */
const OFFLINE_GAP_THRESHOLD_MS = 10_000;

export const useBackgroundCombat = () => {
    const character = useCharacterStore((s) => s.character);
    const phase = useCombatStore((s) => s.phase);
    const combatSpeed = useSettingsStore((s) => s.combatSpeed);
    const autoFight = useCombatStore((s) => s.autoFight);
    const backgroundStartedAt = useCombatStore((s) => s.backgroundStartedAt);
    const monster = useCombatStore((s) => s.monster);
    const botsKey = useBotStore((s) => s.bots.map((b) => b.id).join(','));
    // 2026-05-11 spec ("to sa kopie walki to jest blad — ma byc JEDNA
    // wspolna walka"): in a multi-human party the leader's engine is
    // the single source of truth for monster state. Members are pure
    // spectators — their engine NEVER ticks during shared combat, so
    // they can't double-simulate the fight or race with the leader's
    // broadcasts. The leader keeps ticking normally; members paint
    // what arrives via `partyCombatSyncStore`.
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
    // 2026-05-09: pause the engine entirely on login / register /
    // character-select — without this, a fight left mid-flight in
    // localStorage keeps ticking on those screens, firing
    // `saveCurrentCharacterStores()` (3 Supabase writes / kill) every
    // ~second and drowning the API. AppShell flips this flag from its
    // route effect; the engine resumes when we land on a real game
    // route again.
    const isCharacterlessRoute = useAppRouteStore((s) => s.isCharacterless);

    // ── Offline catch-up on mount / visibility change ───────────────────────
    const offlineCatchUpDone = useRef(false);

    useEffect(() => {
        const doCatchUp = (): void => {
            const cs = useCombatStore.getState();
            if (!cs.lastCombatTickAt) return;
            if (cs.phase !== 'fighting' && cs.phase !== 'victory') return;
            if (!cs.baseMonster) return;

            // 2026-05-12 CRITICAL FIX ("wyszedłem z walki jako sojusznik
            // to zginalem"): simulateOfflineCombat runs the engine
            // standalone — for non-leader members in a multi-human
            // party that means simulating a fight where the member
            // has no leader-broadcast HP recovery. The engine kills
            // them in the sim, fires handlePlayerDeath, takes -18
            // levels. Disastrous when the member just briefly tabbed
            // away (their HP is leader-authoritative anyway). Skip
            // the catch-up for members; leader's broadcasts handle
            // their state on return.
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
                        `⏰ Walka offline: ${result.kills} killi, +${result.xpEarned.toLocaleString('pl-PL')} XP, +${formatGoldShort(result.goldEarned)} (${result.elapsedMinutes} min)`,
                        'system',
                    );
                    if (result.levelUps > 0) {
                        useCombatStore.getState().addLog(
                            `🎉 Awans! Zdobyłeś ${result.levelUps} poziomów podczas walki offline!`,
                            'system',
                        );
                    }
                    if (result.died) {
                        useCombatStore.getState().addLog('💀 Zginąłeś podczas walki offline!', 'system');
                    }
                }
            }
        };

        // Run once on mount (page reload / computer wake)
        if (!offlineCatchUpDone.current) {
            offlineCatchUpDone.current = true;
            doCatchUp();
        }

        // Also run when tab becomes visible again
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'visible') {
                doCatchUp();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // ── Player attack interval (timestamp-based catch-up) ──────────────────
    useEffect(() => {
        if (phase !== 'fighting' || combatSpeed === 'SKIP' || !character) return;
        if (isCharacterlessRoute) return;
        // 2026-05-11: members STILL run this tick — but `doPlayerAttackTick`
        // detects party-membership internally and diverts the damage to an
        // `attack-action` broadcast instead of applying locally. The leader
        // resolves on their authoritative state. This is how Knight
        // contributes to the shared monster.
        const effChar = getEffectiveChar(character);
        if (!effChar) return;
        const mult = SPEED_MULT[combatSpeed] ?? 1;
        const attackIntervalMs = Math.max(200, getAttackMs(effChar.attack_speed ?? 1) / mult);

        let lastPlayerTickAt = Date.now();

        // Tick at whichever is smaller: attack interval or 1s (browser throttle floor)
        const tickMs = Math.min(attackIntervalMs, 1000);

        const id = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastPlayerTickAt;
            const ticksToProcess = Math.max(1, Math.floor(elapsed / attackIntervalMs));

            // Process multiple attack cycles if time gap is large (browser throttling)
            const maxBatch = Math.min(ticksToProcess, 200); // safety cap
            for (let i = 0; i < maxBatch; i++) {
                if (useCombatStore.getState().phase !== 'fighting') break;
                // Between batch iterations, advance cooldowns so auto-potions and
                // skills work correctly during catch-up processing
                if (i > 0) {
                    useCooldownStore.getState().tick(attackIntervalMs);
                    advanceSkillCooldowns(attackIntervalMs);
                }
                doPlayerAttackTick();
            }

            lastPlayerTickAt = now;
            // Update last tick timestamp for offline detection
            useCombatStore.getState().setLastCombatTickAt(new Date(now).toISOString());
        }, tickMs);

        // Set initial tick timestamp
        useCombatStore.getState().setLastCombatTickAt(new Date().toISOString());

        return () => clearInterval(id);
    }, [phase, combatSpeed, character?.id, character?.attack_speed, monster?.id, isCharacterlessRoute, isNonLeaderMember]);

    // ── Monster attack interval (timestamp-based catch-up) ─────────────────
    useEffect(() => {
        if (phase !== 'fighting' || combatSpeed === 'SKIP' || !monster) return;
        if (isCharacterlessRoute) return;
        // Members are spectators — leader simulates the whole fight.
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
                // Advance potion cooldowns between batch iterations so auto-potions
                // fire correctly after monster hits in background tabs
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

    // ── Bot attack interval ─────────────────────────────────────────────────
    // All alive party bots share one interval — they attack roughly every
    // 1800ms (divided by the combat speed multiplier). Simple and readable.
    // Interval resets when bots change or combat state changes.
    useEffect(() => {
        if (phase !== 'fighting' || combatSpeed === 'SKIP') return;
        if (!botsKey) return; // no bots in party
        if (isCharacterlessRoute) return;
        // Members are spectators — leader simulates the whole fight.
        if (isNonLeaderMember) return;
        const mult = SPEED_MULT[combatSpeed] ?? 1;
        const botIntervalMs = Math.max(300, Math.floor(1800 / mult));
        const id = setInterval(() => {
            if (useCombatStore.getState().phase !== 'fighting') return;
            doBotAttackTick();
        }, botIntervalMs);
        return () => clearInterval(id);
    }, [phase, combatSpeed, botsKey, isCharacterlessRoute, isNonLeaderMember]);

    // ── Skill effects status tick (DOT, stun timers, marks) ──────────────────
    // Runs at 250 ms while fighting — drains stun / DOT / mark / immortal
    // timers and applies DOT damage to player + every alive wave monster.
    // Independent of combat speed because the effect runtime already takes
    // wall-clock deltas internally.
    useEffect(() => {
        if (phase !== 'fighting') return;
        if (isCharacterlessRoute) return;
        const id = setInterval(() => huntStatusTick(), 250);
        return () => clearInterval(id);
    }, [phase, isCharacterlessRoute]);

    // ── Auto-skill fast poller (250 ms) ──────────────────────────────────────
    // 2026-05-11 spec ("auto spelle slabo dzialaja, mija strasznie duzo
    // czasu zanim sie uzyja"): the auto-skill cast logic lives inside
    // `doPlayerAttackTick`, so before this tick it only ran at the
    // player's attack-speed cadence (1-2 s typically). With a 8 s
    // cooldown that meant up to a full attack-interval of extra delay
    // after the spell came off cooldown. Running `doPlayerAttackTick`
    // with `autoSkillOnly=true` at 250 ms polls all auto-slots much
    // closer to cooldown reset — basic-attack damage is skipped on
    // these polls so we don't 4× the player's swings.
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

    // ── Cooldown tick timer (smooth UI in foreground) ────────────────────────
    // Runs during fighting AND victory so cooldowns continue draining during
    // the ~1s gap between waves. Previously the tick paused on victory, which
    // made cooldowns appear to "never reach zero" and "jump backward" when the
    // next wave started (if AUTO recast immediately on the first tick).
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
            // Use real elapsed time to handle browser throttling of this timer
            const realDec = Math.floor(elapsed * speedMult);
            useCooldownStore.getState().tick(Math.min(realDec, decPerTick * 20)); // cap at 2s worth
        }, 100);
        return () => clearInterval(interval);
    }, [phase, combatSpeed, isCharacterlessRoute]);

    // ── Auto-fight after victory ────────────────────────────────────────────
    useEffect(() => {
        if (phase !== 'victory') return;
        if (!autoFight) return;
        if (isCharacterlessRoute) return;
        // Members never trigger their own next fight — leader does it
        // and broadcasts the new state.
        if (isNonLeaderMember) return;
        const { baseMonster } = useCombatStore.getState();
        if (!baseMonster) return;

        if (combatSpeed === 'SKIP') {
            // SKIP: instant next fight with small delay to prevent stack overflow
            const timer = setTimeout(() => startAutoNextFight(), 10);
            return () => clearTimeout(timer);
        }

        // Auto-potion tick during victory gap
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

    // ── SKIP mode trigger: if SKIP is activated mid-fight ───────────────────
    useEffect(() => {
        if (combatSpeed !== 'SKIP' || phase !== 'fighting' || !monster || !character) return;
        if (isCharacterlessRoute) return;
        // Members never resolve SKIP locally — leader does and broadcasts.
        if (isNonLeaderMember) return;
        const rarity = useCombatStore.getState().monsterRarity;
        const s = useCombatStore.getState();
        resolveInstantFight(monster, s.playerCurrentHp, s.playerCurrentMp, rarity);
    }, [combatSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 10h cap ─────────────────────────────────────────────────────────────
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

    // ── XP/h calculation (runs every second) ────────────────────────────────
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
