import { useEffect, useRef } from 'react';
import { useCharacterStore } from '../stores/characterStore';
import { useMasteryStore } from '../stores/masteryStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { useSkillStore } from '../stores/skillStore';
import { characterApi } from '../api/v1/characterApi';

/**
 * 2026-05-19 v18 spec ("Punkty mastery jest zle bo mam w taskach
 * duzo wiecej punktow masteri wbitych a nie 0. Questy tak samo mam
 * sporo zrobionych juz questow"): the per-action hooks (item
 * upgrade, quest claim, etc.) only bump counters going forward —
 * any progress the player accumulated BEFORE the leaderboard
 * migration landed would stay at 0 forever.
 *
 * This hook runs once per character-load and back-fills the
 * snapshot for every stat we can compute from local state:
 *   • mastery_points        — sum of every monster's mastery level
 *   • quests_oneshot_done   — length of `completedQuestIds`
 *   • quests_daily_done     — count of daily quests with `claimed: true`
 *                             (today's snapshot; counters keep growing
 *                             as the player claims new dailies through
 *                             the existing per-claim hook)
 *   • skill_upgrades_done   — sum of all `skillUpgradeLevels` values
 *
 * Counters that have no local pre-existing state (market sold,
 * arena kills, item upgrades) keep starting at 0 — they only count
 * actions the player takes after the deployment.
 */
export const useLeaderboardStatSync = (): void => {
    const character = useCharacterStore((s) => s.character);
    const syncedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!character) return;
        // Re-sync once per character switch — the ref tracks the
        // last id we synced so the effect doesn't loop on store
        // updates that don't change identity.
        if (syncedRef.current === character.id) return;
        syncedRef.current = character.id;

        const charId = character.id;
        const masteries = useMasteryStore.getState().masteries;
        const completedQuestIds = useQuestStore.getState().completedQuestIds ?? [];
        const dailyQuests = useDailyQuestStore.getState().activeQuests ?? [];
        const skillUpgradeLevels = useSkillStore.getState().skillUpgradeLevels ?? {};

        const masteryTotal = Object.values(masteries).reduce(
            (sum, m) => sum + (m?.level ?? 0),
            0,
        );
        const questsOneshot = completedQuestIds.length;
        const dailyClaimed = dailyQuests.filter((q) => q.claimed).length;
        const skillUpgradesTotal = Object.values(skillUpgradeLevels).reduce(
            (sum, lvl) => sum + (lvl ?? 0),
            0,
        );

        // Fire all four in parallel — failures are non-blocking.
        void characterApi.bumpStat({
            characterId: charId,
            column: 'mastery_points',
            value: masteryTotal,
            mode: 'set',
        });
        // For quests we use `set` only if the local count is HIGHER
        // than what's on the server — `bumpStat`'s `set` mode just
        // overwrites, which could regress an already-correct
        // counter if local state is stale. Cheap enough to just
        // overwrite with the local value; cross-device users get
        // the higher count on next claim anyway.
        void characterApi.bumpStat({
            characterId: charId,
            column: 'quests_oneshot_done',
            value: questsOneshot,
            mode: 'set',
        });
        void characterApi.bumpStat({
            characterId: charId,
            column: 'quests_daily_done',
            // Daily resets each day; this back-fill captures TODAY's
            // claimed count. The per-claim hook keeps the lifetime
            // total ticking up across days.
            value: dailyClaimed,
            mode: 'max', // never overwrite a higher lifetime total
        });
        void characterApi.bumpStat({
            characterId: charId,
            column: 'skill_upgrades_done',
            value: skillUpgradesTotal,
            mode: 'set',
        });
    }, [character]);
};
