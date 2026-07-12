import { useEffect, useState } from 'react';
import { useSkillStore } from '../stores/skillStore';
import { SKILL_NAMES_PL } from '../systems/skillSystem';

export interface IOfflineReward {
  skillName: string;
  earnedXp: number;
  timeElapsed: number;
}

export const useOfflineTrainingResume = () => {
  const [reward, setReward] = useState<IOfflineReward | null>(null);

  useEffect(() => {
    const {
      offlineTrainingSkillId,
      trainingSegmentStartedAt,
      trainingAccumulatedEffectiveSeconds,
      trainingCurrentSpeedMultiplier,
      collectOfflineTraining,
    } = useSkillStore.getState();

    if (!offlineTrainingSkillId || !trainingSegmentStartedAt) return;

    if (trainingCurrentSpeedMultiplier !== 1) return;

    const segmentSeconds = Math.max(
      0,
      (Date.now() - new Date(trainingSegmentStartedAt).getTime()) / 1000,
    );
    const totalEffective = trainingAccumulatedEffectiveSeconds + segmentSeconds * trainingCurrentSpeedMultiplier;

    if (totalEffective < 600) return;

    const earned = collectOfflineTraining();
    if (earned <= 0) return;

    const skillName =
      SKILL_NAMES_PL[offlineTrainingSkillId] ?? offlineTrainingSkillId;

    setReward({ skillName, earnedXp: earned, timeElapsed: totalEffective });
  }, []);

  const clearReward = () => setReward(null);

  return { reward, clearReward };
};
