import {
  canDeleteComment,
  canEditComment,
  COMMENT_BODY_MAX_LENGTH,
  commentBodySchema,
  hasBoardPermission,
  type BoardRole,
  type Comment,
} from '@streamline/shared';
import { MessageSquare } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { DELETED_USER_NAME, DeletedUserAvatar } from '@/features/activity/ActivityItem';
import { ConfirmDialog } from '@/features/boards/ConfirmDialog';
import { getCardErrorMessage } from '@/features/cards/cardErrorMessage';
import { dirtyFieldProps } from '@/features/cards/dirtyField';
import { formatDateTime, formatRelativeTime } from '@/features/cards/format';
import { deleteComment, editComment, postComment, useCommentsStore } from '@/stores/comments';

/** Toast id of a failed comment edit (a newer failure replaces the message). */
const EDIT_ERROR_TOAST_ID = 'comment-edit-error';

interface CommentsSectionProps {
  boardId: string;
  cardId: string;
  /** The current user and their role on the board (what they may write, edit and delete). */
  userId: string | null;
  role: BoardRole;
}

/** Ctrl+Enter (Cmd+Enter on macOS) sends a comment; Enter alone adds a line break. */
function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return (
    event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing
  );
}

/** Validation message of a comment body, `null` when it can be sent. */
function bodyError(body: string): string | null {
  const parsed = commentBodySchema.safeParse(body);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Invalid comment');
}

/**
 * Comments of a card, oldest first, page by page, kept up to date live. Members with
 * `card:write` write comments and edit their own; managers may delete any comment.
 */
export function CommentsSection({ boardId, cardId, userId, role }: CommentsSectionProps) {
  const comments = useCommentsStore((state) => state.items);
  const status = useCommentsStore((state) => state.status);
  const error = useCommentsStore((state) => state.error);
  const nextCursor = useCommentsStore((state) => state.nextCursor);
  const isLoadingMore = useCommentsStore((state) => state.isLoadingMore);
  const canWrite = hasBoardPermission(role, 'card:write');

  useEffect(() => {
    const scope = { boardId, cardId };
    void useCommentsStore.getState().open(scope);
    return () => {
      useCommentsStore.getState().close(scope);
    };
  }, [boardId, cardId]);

  const actor = userId === null ? null : { userId, role };

  let list;
  if (status === 'loading' && comments.length === 0) {
    list = (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">Loading comments...</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-4/5" />
      </div>
    );
  } else if (status === 'error') {
    list = (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
        <p>Could not load the comments. {error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void useCommentsStore.getState().reload()}
        >
          Retry
        </Button>
      </div>
    );
  } else if (comments.length === 0) {
    list = (
      <div className="flex items-center gap-2 py-2 text-subtle">
        <MessageSquare aria-hidden="true" className="size-4" strokeWidth={2} />
        <p className="text-sm">No comments yet.</p>
      </div>
    );
  } else {
    list = (
      <ul aria-label="Comments" className="flex flex-col gap-4">
        {comments.map((comment) => {
          const ownership = { authorId: comment.author?.id ?? null };
          return (
            <CommentItem
              key={comment.id}
              comment={comment}
              canEdit={actor !== null && canEditComment(actor, ownership)}
              canDelete={actor !== null && canDeleteComment(actor, ownership)}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {list}
      {status === 'ready' && error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {status === 'ready' && nextCursor !== null && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={isLoadingMore}
          onClick={() => void useCommentsStore.getState().loadMore()}
        >
          {isLoadingMore ? 'Loading...' : 'Load more comments'}
        </Button>
      )}
      {canWrite && <CommentComposer />}
    </div>
  );
}

/** Writes a new comment: the button or Ctrl/Cmd+Enter sends it. */
function CommentComposer() {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  const tooLong = body.trim().length > COMMENT_BODY_MAX_LENGTH;
  const canSend = body.trim() !== '' && !tooLong && !isSending;

  const send = async () => {
    if (!canSend) {
      return;
    }
    const invalid = bodyError(body);
    if (invalid) {
      setError(invalid);
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      await postComment(body.trim());
      setBody('');
    } catch (sendError) {
      setError(getCardErrorMessage(sendError));
    } finally {
      setIsSending(false);
      input.current?.focus();
    }
  };

  return (
    <form
      noValidate
      aria-label="Add a comment"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Textarea
        ref={input}
        aria-label="New comment"
        placeholder="Add a comment..."
        value={body}
        rows={3}
        {...dirtyFieldProps(body !== '')}
        aria-invalid={error || tooLong ? true : undefined}
        aria-describedby={error || tooLong ? errorId : undefined}
        onChange={(event) => {
          setBody(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (isSendShortcut(event)) {
            event.preventDefault();
            void send();
          } else if (event.key === 'Escape' && body !== '') {
            setBody('');
            setError(null);
          }
        }}
      />
      {(error || tooLong) && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error ?? `Comment must be at most ${String(COMMENT_BODY_MAX_LENGTH)} characters`}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSend}>
          Comment
        </Button>
        <span className="text-xs text-subtle">Ctrl/Cmd+Enter to send</span>
      </div>
    </form>
  );
}

interface CommentItemProps {
  comment: Comment;
  canEdit: boolean;
  canDelete: boolean;
}

function CommentItem({ comment, canEdit, canDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const authorName = comment.author?.name ?? DELETED_USER_NAME;

  return (
    <li className="flex gap-3" aria-label={`Comment by ${authorName}`}>
      {comment.author ? (
        <Avatar userId={comment.author.id} name={comment.author.name} size="sm" />
      ) : (
        <DeletedUserAvatar />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{authorName}</span>
          <time
            dateTime={comment.createdAt}
            title={formatDateTime(comment.createdAt)}
            className="text-xs text-subtle"
          >
            {formatRelativeTime(comment.createdAt)}
          </time>
          {comment.editedAt !== null && (
            <span
              className="text-xs text-subtle"
              title={`Edited ${formatDateTime(comment.editedAt)}`}
            >
              (edited)
            </span>
          )}
        </div>
        {isEditing ? (
          <CommentEditor
            comment={comment}
            onDone={() => {
              setIsEditing(false);
              editButton.current?.focus();
            }}
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">{comment.body}</p>
        )}
        {!isEditing && (canEdit || canDelete) && (
          <div className="flex gap-1">
            {canEdit && (
              <Button
                ref={editButton}
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs text-subtle"
                aria-label={`Edit comment by ${authorName}`}
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>
            )}
            {canDelete && (
              <Button
                ref={deleteButton}
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs text-subtle"
                aria-label={`Delete comment by ${authorName}`}
                onClick={() => setIsDeleting(true)}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
      {canDelete && (
        <ConfirmDialog
          open={isDeleting}
          onOpenChange={setIsDeleting}
          title="Delete comment?"
          description="The comment will be deleted permanently."
          confirmLabel="Delete comment"
          onConfirm={() => deleteComment(comment.id)}
          returnFocusRef={deleteButton}
        />
      )}
    </li>
  );
}

/** Edits a comment in place: Save or Ctrl/Cmd+Enter saves, Cancel or Escape discards. */
function CommentEditor({ comment, onDone }: { comment: Comment; onDone: () => void }) {
  const [body, setBody] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const save = () => {
    if (body.trim() === comment.body) {
      onDone();
      return;
    }
    const invalid = bodyError(body);
    if (invalid) {
      setError(invalid);
      return;
    }
    onDone();
    // Optimistic: the store shows the new text at once and restores it on failure.
    editComment(comment.id, body.trim()).catch((editError: unknown) => {
      toast.error(getCardErrorMessage(editError), { id: EDIT_ERROR_TOAST_ID });
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Edit comment"
        autoFocus
        value={body}
        rows={3}
        {...dirtyFieldProps(true)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setBody(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (isSendShortcut(event)) {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
