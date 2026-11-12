import { Draggable, Droppable, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import type { Card, Column } from '@streamline/shared';
import {
  CircleSlash,
  Ellipsis,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import type { AvatarStackPerson } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { CardComposer } from '@/features/cards/CardComposer';
import { CardTile } from '@/features/cards/CardTile';
import { CARD_DRAG_TYPE, cardsDroppableId } from '@/features/cards/cardDrag';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';

import { ColumnSettingsDialog } from './ColumnSettingsDialog';
import { ColumnTitleEditor } from './ColumnTitleEditor';
import { ConfirmDialog } from './ConfirmDialog';
import { CategoryDot, ColumnCounter } from './badges';
import { getBoardErrorMessage } from './boardErrorMessage';

const NO_MEMBERS: ReadonlyMap<string, AvatarStackPerson> = new Map();

export interface BoardColumnProps {
  column: Column;
  /** All cards of the column in display order; their number drives the WIP counter. */
  cards: readonly Card[];
  /** The cards passing the toolbar filter (all cards by default). */
  visibleCards?: readonly Card[];
  /** The cards are still loading: skeleton tiles are shown instead of the empty state. */
  isLoadingCards?: boolean;
  /** Rename, delete and reorder (`column:write`). */
  canWrite: boolean;
  /** Category and WIP settings (`column:settings`). */
  canEditSettings: boolean;
  /** Create, edit and move cards (`card:write`). */
  canWriteCards?: boolean;
  /** Cards cannot be dragged (no permission, a move being saved, or an active filter). */
  isCardDragDisabled?: boolean;
  /** Board members by user id, for the assignee avatars. */
  membersById?: ReadonlyMap<string, AvatarStackPerson>;
  onOpenCard?: (card: Card) => void;
  /** Whether a card is hidden by the active toolbar filter (for the quick create hint). */
  isCardHidden?: (card: Card) => boolean;
  /** Present when the column can be dragged; spread on the grip handle in the header. */
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  /** The column is being dragged right now. */
  isDragging?: boolean;
}

export function BoardColumn({
  column,
  cards,
  visibleCards = cards,
  isLoadingCards = false,
  canWrite,
  canEditSettings,
  canWriteCards = false,
  isCardDragDisabled = true,
  membersById = NO_MEMBERS,
  onOpenCard,
  isCardHidden,
  dragHandleProps,
  isDragging = false,
}: BoardColumnProps) {
  const renameColumn = useBoardStore((state) => state.renameColumn);
  const deleteColumn = useBoardStore((state) => state.deleteColumn);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const addCardButton = useRef<HTMLButtonElement>(null);
  // Counters and the WIP highlight always use the real number of cards, not the filtered one.
  const cardCount = cards.length;
  const wipExceeded = column.wipLimit !== null && cardCount > column.wipLimit;
  const canDragCards = canWriteCards && !isCardDragDisabled;

  const closeComposer = () => {
    setIsComposing(false);
    addCardButton.current?.focus();
  };

  const handleRename = (title: string) => {
    setIsEditingTitle(false);
    // The rename is optimistic: the store restores the title and the failure is a toast.
    renameColumn(column.id, title).catch((renameError: unknown) => {
      toast.error(getBoardErrorMessage(renameError));
    });
  };

  return (
    <section
      aria-label={column.title}
      data-wip-exceeded={wipExceeded || undefined}
      className={cn(
        'flex h-full w-[280px] shrink-0 flex-col gap-2 rounded-column border-t-2 border-transparent bg-column p-2 transition-[box-shadow,rotate]',
        wipExceeded && 'border-danger bg-danger-subtle',
        isDragging && 'rotate-[1.5deg] shadow-raised',
      )}
    >
      <div className="flex min-h-8 items-center gap-1">
        {dragHandleProps && (
          // A dedicated handle: its own role="button" must not swallow the heading and counter.
          <span
            {...dragHandleProps}
            aria-label={`Drag column ${column.title}`}
            title="Drag to reorder"
            className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-subtle outline-none hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <GripVertical aria-hidden="true" className="size-4" strokeWidth={2} />
          </span>
        )}
        {isEditingTitle ? (
          <div className="min-w-0 flex-1">
            <ColumnTitleEditor
              initialTitle={column.title}
              onSave={handleRename}
              onCancel={() => setIsEditingTitle(false)}
            />
          </div>
        ) : (
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 px-1 py-1',
              !dragHandleProps && 'pl-2',
            )}
          >
            <CategoryDot category={column.category} />
            <h2 className="truncate text-xs font-semibold tracking-[0.04em] text-subtle uppercase">
              {column.title}
            </h2>
            <ColumnCounter count={cardCount} limit={column.wipLimit} />
            {column.wipLimit !== null && column.wipStrict && (
              <span title="Strict WIP limit" className="inline-flex shrink-0 text-subtle">
                <Lock aria-hidden="true" className="size-3" strokeWidth={2} />
                <span className="sr-only">strict</span>
              </span>
            )}
          </div>
        )}
        {canWriteCards && (
          <Button
            ref={addCardButton}
            variant="ghost"
            size="icon-sm"
            aria-label={`Add a card to ${column.title}`}
            aria-expanded={isComposing}
            title="Add a card"
            className="text-subtle"
            onClick={() => setIsComposing((open) => !open)}
          >
            <Plus strokeWidth={2} />
          </Button>
        )}
        {(canWrite || canEditSettings) && (
          <ColumnMenu
            title={column.title}
            triggerRef={menuTrigger}
            canWrite={canWrite}
            canEditSettings={canEditSettings}
            onRename={() => setIsEditingTitle(true)}
            onSettings={() => setIsEditingSettings(true)}
            onDelete={() => setIsDeleting(true)}
          />
        )}
      </div>
      <Droppable droppableId={cardsDroppableId(column.id)} type={CARD_DRAG_TYPE}>
        {(droppableProvided, droppableSnapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            role={visibleCards.length > 0 ? 'list' : undefined}
            aria-label={visibleCards.length > 0 ? `Cards in ${column.title}` : undefined}
            className={cn(
              'flex min-h-24 flex-1 flex-col overflow-y-auto rounded-md px-0.5 pt-0.5 transition-colors',
              droppableSnapshot.isDraggingOver && 'bg-primary-subtle/60',
            )}
          >
            {visibleCards.map((card, index) => (
              <Draggable
                key={card.id}
                draggableId={card.id}
                index={index}
                isDragDisabled={!canDragCards}
              >
                {(draggableProvided, draggableSnapshot) => (
                  <div
                    ref={draggableProvided.innerRef}
                    {...draggableProvided.draggableProps}
                    role="listitem"
                    className="pb-2"
                  >
                    <CardTile
                      card={card}
                      assignee={
                        card.assigneeId === null ? null : (membersById.get(card.assigneeId) ?? null)
                      }
                      onOpen={() => onOpenCard?.(card)}
                      isDraggable={canDragCards}
                      isDragging={draggableSnapshot.isDragging}
                      {...(canDragCards ? draggableProvided.dragHandleProps : null)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {droppableProvided.placeholder}
            {visibleCards.length === 0 && isLoadingCards && (
              <div role="status" className="flex flex-col gap-2">
                <span className="sr-only">Loading cards...</span>
                {[0, 1].map((index) => (
                  <Skeleton
                    key={index}
                    data-testid="card-skeleton"
                    className="h-[76px] rounded-md bg-surface"
                  />
                ))}
              </div>
            )}
            {visibleCards.length === 0 && !isLoadingCards && !droppableSnapshot.isDraggingOver && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-subtle">
                <CircleSlash aria-hidden="true" className="size-4" strokeWidth={2} />
                <p className="text-xs font-semibold tracking-[0.04em] uppercase">No cards</p>
              </div>
            )}
          </div>
        )}
      </Droppable>
      {canWriteCards && isComposing && (
        <CardComposer
          columnId={column.id}
          columnTitle={column.title}
          onClose={closeComposer}
          isHidden={isCardHidden}
        />
      )}
      {canEditSettings && (
        <ColumnSettingsDialog
          column={column}
          open={isEditingSettings}
          onOpenChange={setIsEditingSettings}
          returnFocusRef={menuTrigger}
        />
      )}
      {canWrite && (
        <ConfirmDialog
          open={isDeleting}
          onOpenChange={setIsDeleting}
          title={`Delete column "${column.title}"?`}
          description="The column will be deleted permanently."
          confirmLabel="Delete column"
          onConfirm={() => deleteColumn(column.id)}
          returnFocusRef={menuTrigger}
        />
      )}
    </section>
  );
}

interface ColumnMenuProps {
  title: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  canWrite: boolean;
  canEditSettings: boolean;
  onRename: () => void;
  onSettings: () => void;
  onDelete: () => void;
}

function ColumnMenu({
  title,
  triggerRef,
  canWrite,
  canEditSettings,
  onRename,
  onSettings,
  onDelete,
}: ColumnMenuProps) {
  // Renaming focuses the inline title input; returning focus to the menu button would blur it.
  const keepFocus = useRef(false);

  return (
    // Non-modal, so that a dialog opened from the menu fully controls focus and pointer events.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for column ${title}`}
          className="text-subtle"
        >
          <Ellipsis strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onCloseAutoFocus={(event) => {
          if (keepFocus.current) {
            keepFocus.current = false;
            event.preventDefault();
          }
        }}
      >
        {canWrite && (
          <DropdownMenuItem
            onSelect={() => {
              keepFocus.current = true;
              onRename();
            }}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {canEditSettings && (
          <DropdownMenuItem onSelect={onSettings}>
            <SlidersHorizontal />
            Settings
          </DropdownMenuItem>
        )}
        {canWrite && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
