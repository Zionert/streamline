import { useEffect } from 'react';

import { restoreSession } from './session';

/** Restores the session from the refresh cookie when the app mounts. */
export function useSessionRestore(): void {
  useEffect(() => {
    void restoreSession();
  }, []);
}
