import { useMemo, useSyncExternalStore } from 'react';
import { appStore, share } from './store';

export function useStore(selector) {
  const snapshot = useMemo(() => {
    let previous;
    return () => { previous = share(previous, selector(appStore.getSnapshot())); return previous; };
  }, [selector]);
  return useSyncExternalStore(appStore.subscribe, snapshot, snapshot);
}
