import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasBoardPermission,
  renameBoardSchema,
  type Board,
  type RenameBoardInput,
} from '@streamline/shared';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';

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
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';

import { ConfirmDialog } from './ConfirmDialog';
import { getBoardErrorMessage } from './boardErrorMessage';

interface BoardActionsMenuProps {
  board: Board;
  /** Accessible name of the "⋯" button. */
  label?: string;
  className?: string;
  /** Called after the board has been deleted (e.g. to leave the board page). */
  onDeleted?: () => Promise<void> | void;
}

/**
 * The "⋯" menu of a board with Rename and Delete, each offered only when the role allows it;
 * renders nothing for a role that can do neither. Dialogs return focus to the menu button.
 */
export function BoardActionsMenu({ board, label, className, onDeleted }: BoardActionsMenuProps) {
  const deleteBoard = useBoardStore((state) => state.deleteBoard);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const canRename = hasBoardPermission(board.role, 'board:rename');
  const canDelete = hasBoardPermission(board.role, 'board:delete');

  if (!canRename && !canDelete) {
    return null;
  }

  const handleDelete = async () => {
    await deleteBoard(board.id);
    await onDeleted?.();
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuTrigger}
            variant="ghost"
            size="icon-sm"
            aria-label={label ?? `Actions for board ${board.name}`}
            className={cn('size-7', className)}
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
          onConfirm={handleDelete}
          returnFocusRef={menuTrigger}
        />
      )}
    </>
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
