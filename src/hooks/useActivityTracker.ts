import { useEffect, useRef, useCallback } from 'react';
import { useSkillStore } from '../stores/skillStore';

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * How often (ms) to collect accumulated training XP and apply it to skill levels.
 * Without this, the XP only gets applied on skill change or session resume.
 * 30s is a good balance — frequent enough to see progress, rare enough to be cheap.
 */
const TRAINING_COLLECT_INTERVAL_MS = 30_000;

/**
 * Tracks user activity (clicks, mouse movement, key presses, touches).
 * Controls training speed based on activity:
 *   - Active play → 2x training speed
 *   - 2+ minutes of inactivity → 1x training speed
 *   - Tab hidden / beforeunload → 1x training speed (flush segment)
 *
 * Also periodically collects training XP so skill levels update in real-time.
 * Training runs ALWAYS when a skill is selected — never pauses.
 * Must be mounted once inside <BrowserRouter> so hooks work.
 */
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
      // Switch training to 1x (inactive) speed
      useSkillStore.getState().onActivityChange(false);
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    const markActive = () => {
      isInactiveRef.current = false;
      // ALWAYS ensure training is at 2x when user is active.
      // Check current multiplier to avoid unnecessary store writes on every mouse move.
      const store = useSkillStore.getState();
      if (store.trainingCurrentSpeedMultiplier !== 2) {
        store.onActivityChange(true);
      }
      resetInactivityTimer();
    };

    // Activity events
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true });
    }

    // On mount, ALWAYS force training to 2x speed (user just opened/returned to app).
    useSkillStore.getState().onActivityChange(true);
    resetInactivityTimer();

    // ── Periodic XP collection ────────────────────────────────────────────
    // Collect accumulated training XP every 30s so skill levels update live.
    collectIntervalRef.current = setInterval(() => {
      const state = useSkillStore.getState();
      if (state.offlineTrainingSkillId && state.trainingSegmentStartedAt) {
        state.collectOfflineTraining();
      }
    }, TRAINING_COLLECT_INTERVAL_MS);

    // On beforeunload, flush segment at 1x speed (user is leaving)
    const handleBeforeUnload = () => {
      useSkillStore.getState().onActivityChange(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // visibilitychange: hidden → 1x, visible → 2x
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
