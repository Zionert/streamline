import { Link, useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { boardPath } from '@/features/boards/paths';

/**
 * Shown in place of the Flow page when its code failed to load (e.g. a new deployment removed
 * the old chunk, or the network dropped) or the page failed to render; the rest of the app stays.
 */
export function FlowRouteError() {
  const { boardId = '' } = useParams();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="text-destructive">
        Could not load the Flow page.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button variant="link" asChild>
          <Link to={boardPath(boardId)}>Back to the board</Link>
        </Button>
      </div>
    </main>
  );
}
