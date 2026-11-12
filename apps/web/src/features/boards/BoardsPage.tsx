import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBoardSchema,
  hasBoardPermission,
  renameBoardSchema,
  type Board,
  type CreateBoardInput,
  type RenameBoardInput,
} from '@streamline/shared';
import { Ellipsis, Pencil, Plus, SquareKanban, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';

import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardStore } from '@/stores/board';

import { BoardIcon } from './BoardIcon';
import { ConfirmDialog } from './ConfirmDialog';
import { RoleBadge } from './badges';
import { getBoardErrorMessage } from './boardErrorMessage';
import { boardPath } from './paths';

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4';

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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-4">
        <div className="flex flex-col gap-3">
          <Breadcrumbs items={[{ label: 'Boards' }]} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">Your boards</h1>
            <Button onClick={() => setIsCreating(true)}>
              <Plus strokeWidth={2} />
              Create board
            </Button>
          </div>
        </div>
        {(status === 'idle' || status === 'loading') && boards.length === 0 && (
          <BoardGridSkeleton />
        )}
        {status === 'error' && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md border border-danger bg-danger-subtle px-3 py-2 text-destructive"
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
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-8" />
            <Skeleton className="h-4 flex-1" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyBoards({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary">
        <SquareKanban aria-hidden="true" className="size-6" strokeWidth={2} />
      </span>
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
  const deleteBoard = useBoardStore((state) => state.deleteBoard);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const canRename = hasBoardPermission(board.role, 'board:rename');
  const canDelete = hasBoardPermission(board.role, 'board:delete');

  return (
    <li className="relative flex flex-col gap-3 rounded-md border bg-card p-4 shadow-card transition-colors hover:bg-surface-hover">
      <div className="flex items-start gap-3">
        <BoardIcon boardId={board.id} name={board.name} />
        {/* The link covers the whole card; the menu button sits above it. */}
        <Link
          to={boardPath(board.id)}
          className="min-w-0 flex-1 truncate pt-1.5 font-semibold outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
        >
          {board.name}
        </Link>
        {(canRename || canDelete) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTrigger}
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for board ${board.name}`}
                className="relative z-10 -mt-1 -mr-2 text-subtle"
              >
                <Ellipsis strokeWidth={2} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {canRename && (
                <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              )}
              {canRename && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem variant="destructive" onSelect={() => setIsDeleting(true)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs text-subtle">
        <span className="sr-only">Your role:</span>
        <RoleBadge role={board.role} />
      </div>
      {canRename && (
        <RenameBoardDialog
          board={board}
          open={isRenaming}
          onOpenChange={setIsRenaming}
          returnFocusRef={menuTrigger}
        />
      )}
      {canDelete && (
        <ConfirmDialog
          open={isDeleting}
          onOpenChange={setIsDeleting}
          title={`Delete board "${board.name}"?`}
          description="The board, its columns and memberships will be deleted permanently."
          confirmLabel="Delete board"
          onConfirm={() => deleteBoard(board.id)}
          returnFocusRef={menuTrigger}
        />
      )}
    </li>
  );
}

interface RenameBoardDialogProps {
  board: Board;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives focus when the dialog closes (the menu button the dialog was opened from). */
  returnFocusRef: RefObject<HTMLElement | null>;
}

function RenameBoardDialog({ board, open, onOpenChange, returnFocusRef }: RenameBoardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusRef.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename board</DialogTitle>
          <DialogDescription>Choose a new name for "{board.name}".</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form starts from the current name every time. */}
        {open && <RenameBoardForm board={board} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameBoardForm({ board, onDone }: { board: Board; onDone: () => void }) {
  const renameBoard = useBoardStore((state) => state.renameBoard);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(renameBoardSchema),
    defaultValues: { name: board.name },
  });

  const onSubmit = async ({ name }: RenameBoardInput) => {
    try {
      await renameBoard(board.id, name);
      onDone();
    } catch (error) {
      setError('root.server', { message: getBoardErrorMessage(error) });
    }
  };

  const fieldError = errors.name?.message ?? errors.root?.server?.message;
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <div className="grid gap-2">
        <Label htmlFor="rename-board-name">Board name</Label>
        <Input
          id="rename-board-name"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'rename-board-name-error' : undefined}
          {...register('name')}
        />
        {fieldError && (
          <p id="rename-board-name-error" role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
