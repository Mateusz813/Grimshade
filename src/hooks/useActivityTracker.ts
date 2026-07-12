import { useEffect, useRef, useCallback } from 'react';
import { useSkillStore } from '../stores/skillStore';

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

const TRAINING_COLLECT_INTERVAL_MS = 30_000;

export const useActivityTracker = () => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInactiveRef = useRef(false);

  const resetInactivityTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      isInactiveRef.current = true;
      useSkillStore.getState().onActivityChange(false);
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    const markActive = () => {
      isInactiveRef.current = false;
      const store = useSkillStore.getState();
      if (store.trainingCurrentSpeedMultiplier !== 2) {
        store.onActivityChange(true);
      }
      resetInactivityTimer();
    };

    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true });
    }

    useSkillStore.getState().onActivityChange(true);
    resetInactivityTimer();

    collectIntervalRef.current = setInterval(() => {
      const state = useSkillStore.getState();
      if (state.offlineTrainingSkillId && state.trainingSegmentStartedAt) {
        state.collectOfflineTraining();
      }
    }, TRAINING_COLLECT_INTERVAL_MS);

    const handleBeforeUnload = () => {
      useSkillStore.getState().onActivityChange(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        isInactiveRef.current = true;
        useSkillStore.getState().onActivityChange(false);
      } else {
        isInactiveRef.current = false;
        useSkillStore.getState().onActivityChange(true);
        resetInactivityTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      for (const event of events) {
        window.removeEventListener(event, markActive);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (collectIntervalRef.current !== null) clearInterval(collectIntervalRef.current);
    };
  }, [resetInactivityTimer]);
};
