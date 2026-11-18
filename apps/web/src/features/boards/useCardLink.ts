import { useCallback } from 'react';
import { useLocation, useMatch } from 'react-router';

import { FLOW_PATH_PATTERN, cardPath, flowCardPath } from './paths';

/**
 * Address of a card opened from the current page: over the Flow page (keeping its query, e.g. the
 * date range) while it is shown, over the board otherwise.
 */
export function useCardLink(): (boardId: string, cardKey: string) => string {
  const isFlow = useMatch({ path: FLOW_PATH_PATTERN, end: false }) !== null;
  const { search } = useLocation();
  return useCallback(
    (boardId: string, cardKey: string) =>
      isFlow ? `${flowCardPath(boardId, cardKey)}${search}` : cardPath(boardId, cardKey),
    [isFlow, search],
  );
}
