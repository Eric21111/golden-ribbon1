import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** Tabs remain mounted. Refresh both on returning to POS and resuming Android. */
export function usePosStockRefresh(enabled: boolean, refresh: () => unknown) {
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    void refresh();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') void refresh();
      previous = next;
    });
    return () => subscription.remove();
  }, [enabled, refresh]));
}
