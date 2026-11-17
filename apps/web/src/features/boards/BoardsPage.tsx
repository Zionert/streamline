import { zodResolver } from '@hookform/resolvers/zod';
import { createBoardSchema, type Board, type CreateBoardInput } from '@streamline/shared';
import { Plus, SquareKanban } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardStore } from '@/stores/board';

import { BoardActionsMenu } from './BoardActionsMenu';
import { getBoardErrorMessage } from './boardErrorMessage';
import { ROLE_LABELS } from './labels';
import { boardPath } from './paths';

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3';

/** Board list of the current user with create, rename and delete. */
export function BoardsPage() {
  const boards = useBoardStore((state) => state.boards);
  const status = useBoardStore((state) => state.boardsStatus);
  const error = useBoardStore((state) => state.boardsError);
  const loadBoards = useBoardStore((state) => state.loadBoards);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Your boards</h1>
          <Button onClick={() => setIsCreating(true)}>
            <Plus strokeWidth={2} />
            Create board
          </Button>
        </div>
        {(status === 'idle' || status === 'loading') && boards.length === 0 && (
          <BoardGridSkeleton />
        )}
        {status === 'error' && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-danger bg-danger-subtle px-3 py-2 text-destructive"
          >
            <span>Could not load your boards. {error}</span>
            <Button variant="outline" size="sm" onClick={() => void loadBoards()}>
              Retry
            </Button>
          </div>
        )}
        {status === 'ready' && boards.length === 0 && (
          <EmptyBoards onCreate={() => setIsCreating(true)} />
        )}
        {boards.length > 0 && (
          <ul aria-label="Boards" className={GRID_CLASS}>
            {boards.map((board) => (
              <BoardListItem key={board.id} board={board} />
            ))}
          </ul>
        )}
      </div>
      <CreateBoardDialog open={isCreating} onOpenChange={setIsCreating} />
    </main>
  );
}

function BoardGridSkeleton() {
  return (
    <div role="status" className={GRID_CLASS}>
      <span className="sr-only">Loading boards...</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          data-testid="board-skeleton"
          className="flex flex-col gap-3 rounded-lg border bg-surface p-4"
        >
          <Skeleton className="h-5 w-10 rounded-sm" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyBoards({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <SquareKanban aria-hidden="true" className="size-8 text-muted" strokeWidth={2} />
      <p className="text-base font-semibold">You don&apos;t have any boards yet</p>
      <p className="text-subtle">Create a board to start organizing your work.</p>
      <Button onClick={onCreate}>
        <Plus strokeWidth={2} />
        Create your first board
      </Button>
    </div>
  );
}

interface CreateBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateBoardDialog({ open, onOpenChange }: CreateBoardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create board</DialogTitle>
          <DialogDescription>Give the new board a name. You can rename it later.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form starts empty every time. */}
        {open && <CreateBoardForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateBoardForm({ onDone }: { onDone: () => void }) {
  const createBoard = useBoardStore((state) => state.createBoard);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createBoardSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = async ({ name }: CreateBoardInput) => {
    try {
      await createBoard(name);
      reset();
      onDone();
    } catch (error) {
      setError('root.server', { message: getBoardErrorMessage(error) });
    }
  };

  const fieldError = errors.name?.message ?? errors.root?.server?.message;
  return (
    <form
      noValidate
      aria-label="Create board"
      className="grid gap-4"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <div className="grid gap-2">
        <Label htmlFor="new-board-name">New board name</Label>
        <Input
          id="new-board-name"
          placeholder="e.g. Sprint 12"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'new-board-name-error' : undefined}
          {...register('name')}
        />
        {fieldError && (
          <p id="new-board-name-error" role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          Create board
        </Button>
      </DialogFooter>
    </form>
  );
}

function BoardListItem({ board }: { board: Board }) {
  return (
    <li className="relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors focus-within:border-border-strong hover:border-border-strong">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Badge>
          <span className="sr-only">Board key:</span>
          {board.key}
        </Badge>
        {/* The link covers the whole tile; the menu button sits above it. */}
        <BoardActionsMenu board={board} className="relative z-10 -mr-1.5" />
      </div>
      <Link
        to={boardPath(board.id)}
        className="min-w-0 truncate text-base font-semibold outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        {board.name}
      </Link>
      <p className="font-mono text-xs text-subtle">
        <span className="sr-only">Your role: </span>
        <span>{ROLE_LABELS[board.role]}</span>
      </p>
    </li>
  );
}
