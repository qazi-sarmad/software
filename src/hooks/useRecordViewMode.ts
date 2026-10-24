import { useEffect, useState } from 'react';
import { DEFAULT_RECORD_VIEW_MODE, getRecordViewMode, type RecordViewMode } from '../data/preferences';

/**
 * The signed-in user's record-view mode (§27.5, H3). Defaults to full_page until the stored
 * preference loads, so a record never flashes a window the user did not ask for.
 */
export function useRecordViewMode(): [RecordViewMode, (mode: RecordViewMode) => void] {
  const [mode, setMode] = useState<RecordViewMode>(DEFAULT_RECORD_VIEW_MODE);

  useEffect(() => {
    let alive = true;
    getRecordViewMode()
      .then((m) => {
        if (alive) setMode(m);
      })
      .catch(() => {
        /* keep the default; the preference is not fatal */
      });
    return () => {
      alive = false;
    };
  }, []);

  return [mode, setMode];
}
