import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { manilaBusinessDate, msUntilNextManilaDay } from '@/features/reports/todayQuickview';

/** Small margin so the timer never lands just before midnight on a slightly fast clock. */
const ROLLOVER_MARGIN_MS = 1000;

/**
 * Calls `onRefresh` when the Asia/Manila business date changes while the screen is mounted, and whenever
 * the app returns to the foreground (timers do not run reliably in the background, so a rollover that
 * happened meanwhile is caught there too).
 */
export function useManilaDayRefresh(onRefresh: () => void) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let currentDate = manilaBusinessDate();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const nextDate = manilaBusinessDate();
        if (nextDate !== currentDate) {
          currentDate = nextDate;
          onRefreshRef.current();
        }
        arm();
      }, msUntilNextManilaDay() + ROLLOVER_MARGIN_MS);
    };
    arm();

    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const cameToForeground = nextState === 'active' && previousState !== 'active';
      previousState = nextState;
      if (!cameToForeground) return;
      currentDate = manilaBusinessDate();
      arm();
      onRefreshRef.current();
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);
}
