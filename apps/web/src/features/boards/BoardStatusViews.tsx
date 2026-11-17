import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

import { BOARDS_PATH } from './paths';

/** A board page whose board does not exist or is not shared with the user. */
export function BoardNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Board not found</h1>
      <p className="text-subtle">This board does not exist or you are not a member of it.</p>
      <Link
        to={BOARDS_PATH}
        className="rounded-sm text-primary-text underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to your boards
      </Link>
    </main>
  );
}

/** A board page whose board could not be loaded. */
export function BoardLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="text-destructive">
        Could not load the board. {message}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="link" asChild>
          <Link to={BOARDS_PATH}>Back to your boards</Link>
        </Button>
      </div>
    </main>
  );
}
