import { useEffect, useState } from 'react';
import { useSkillStore } from '../stores/skillStore';
import { SKILL_NAMES_PL } from '../systems/skillSystem';

export interface IOfflineReward {
  skillName: string;
  earnedXp: number;
  timeElapsed: number; // effective seconds
}

/**
 * On mount, checks if the player was INACTIVE (1x speed) for 10+ minutes.
 * If so, collects accumulated training XP and shows a reward popup.
 *
 * If the player was active (2x speed) or inactive for less than 10 minutes,
 * no popup is shown — training just continues silently in the background.
 */
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

    // Only show popup if player was INACTIVE (1x speed) — meaning they were away
    if (trainingCurrentSpeedMultiplier !== 1) return;

    // Calculate total effective seconds (accumulated + current segment at 1x)
    const segmentSeconds = Math.max(
      0,
      (Date.now() - new Date(trainingSegmentStartedAt).getTime()) / 1000,
    );
    const totalEffective = trainingAccumulatedEffectiveSeconds + segmentSeconds * trainingCurrentSpeedMultiplier;

    // Only show popup if at least 10 minutes of effective training
    if (totalEffective < 600) return;

    const earned = collectOfflineTraining();
    if (earned <= 0) return;

    const skillName =
      SKILL_NAMES_PL[offlineTrainingSkillId] ?? offlineTrainingSkillId;

    setReward({ skillName, earnedXp: earned, timeElapsed: totalEffective });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearReward = () => setReward(null);

  return { reward, clearReward };
};
