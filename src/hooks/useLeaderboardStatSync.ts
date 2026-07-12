import { useEffect, useRef } from 'react';
import { useCharacterStore } from '../stores/characterStore';
import { useMasteryStore } from '../stores/masteryStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { useSkillStore } from '../stores/skillStore';
import { characterApi } from '../api/v1/characterApi';

export const useLeaderboardStatSync = (): void => {
    const character = useCharacterStore((s) => s.character);
    const syncedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!character) return;
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

        void characterApi.bumpStat({
            characterId: charId,
            column: 'mastery_points',
            value: masteryTotal,
            mode: 'set',
        });
        void characterApi.bumpStat({
            characterId: charId,
            column: 'quests_oneshot_done',
            value: questsOneshot,
            mode: 'set',
        });
        void characterApi.bumpStat({
            characterId: charId,
            column: 'quests_daily_done',
            value: dailyClaimed,
            mode: 'max',
        });
        void characterApi.bumpStat({
            characterId: charId,
            column: 'skill_upgrades_done',
            value: skillUpgradesTotal,
            mode: 'set',
        });
    }, [character]);
};
