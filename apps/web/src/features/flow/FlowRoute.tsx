import { lazy, Suspense } from 'react';

import { FlowSkeleton } from './FlowSkeleton';

// The flow analytics and their chart library load on the first visit, outside the main bundle.
const FlowPage = lazy(() => import('./FlowPage'));

/** `/boards/:boardId/flow`, with the page skeleton shown while its code loads. */
export function FlowRoute() {
  return (
    <Suspense fallback={<FlowSkeleton />}>
      <FlowPage />
    </Suspense>
  );
}
