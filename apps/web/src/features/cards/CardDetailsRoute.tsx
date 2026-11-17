import { cardKeySchema } from '@streamline/shared';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  boardPath,
  cardPath,
  flowCardPath,
  flowPath,
  isOpenedFromBoard,
} from '@/features/boards/paths';
import { getApiErrorInfo } from '@/lib/api-error';
import { useBoardStore } from '@/stores/board';

import { CardDetailsDialog } from './CardDetailsDialog';
import { getCardErrorMessage } from './cardErrorMessage';
import { findCard, findCardByKey } from './cardOrder';
import * as cardsApi from './cardsApi';

/** The page of the board a card modal is opened over. */
export type CardRouteView = 'board' | 'flow';

interface CardRouteViewPaths {
  /** Address of the page behind the modal. */
  pagePath: (boardId: string) => string;
  /** Address of a card over that page. */
  cardPath: (boardId: string, cardKey: string) => string;
  /** Label of the button that closes a message about the card. */
  backLabel: string;
}

const VIEW_PATHS: Readonly<Record<CardRouteView, CardRouteViewPaths>> = {
  board: { pagePath: boardPath, cardPath, backLabel: 'Back to the board' },
  flow: { pagePath: flowPath, cardPath: flowCardPath, backLabel: 'Back to Flow' },
};

/**
 * `/boards/:boardId/cards/:cardKey` (or `/boards/:boardId/flow/cards/:cardKey`): the details of
 * a card as a modal over the board (or its flow analytics). Closing returns to that page.
 */
export function CardDetailsRoute({ view = 'board' }: { view?: CardRouteView }) {
  const { boardId = '', cardKey = '' } = useParams();
  // Keyed, so that opening another card starts from a clean state.
  return (
    <CardDetails
      key={`${boardId}/${cardKey}`}
      boardId={boardId}
      cardKey={cardKey}
      paths={VIEW_PATHS[view]}
    />
  );
}

type Lookup = { status: 'pending' | 'not-found' } | { status: 'error'; message: string };

/** Toast id of the message about a card deleted by someone else while it was open. */
const DELETED_TOAST_ID = 'card-deleted-remotely';

/**
 * The card comes from the board store; a card that is not there (e.g. a link to a card created
 * after the cards were loaded) is fetched by its key once the board's cards have loaded.
 */
interface CardDetailsProps {
  boardId: string;
  cardKey: string;
  paths: CardRouteViewPaths;
}

function CardDetails({ boardId, cardKey, paths }: CardDetailsProps) {
  const navigate = useNavigate();
  const card = useBoardStore((state) => findCardByKey(state.cardsByColumn, cardKey));
  const cardsStatus = useBoardStore((state) => state.cardsStatus);
  const rememberCard = useBoardStore((state) => state.rememberCard);
  const [lookup, setLookup] = useState<Lookup>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  // A card that was shown and then vanished is not fetched again: when it is still on the board
  // under a new key (the board key changed), the address follows it; when someone else deleted
  // it, the modal closes; otherwise it is reported as gone.
  const [shownCardId, setShownCardId] = useState<string | null>(null);
  if (card && card.id !== shownCardId) {
    setShownCardId(card.id);
  }
  const wasShown = shownCardId !== null;
  const rekeyedCard = useBoardStore((state) =>
    !card && shownCardId !== null
      ? (findCard(state.cardsByColumn, shownCardId)?.card ?? null)
      : null,
  );
  const deletedRemotely = useBoardStore(
    (state) => !card && shownCardId !== null && state.deletedCardIds.has(shownCardId),
  );
  const isValidKey = cardKeySchema.safeParse(cardKey).success;
  const cardsSettled = cardsStatus === 'ready' || cardsStatus === 'error';
  const shouldFetch = !card && !wasShown && isValidKey && cardsSettled;

  const location = useLocation();
  const locationState: unknown = location.state;

  // Opened from the page behind it: going back removes the card from the history, so the
  // browser's Back button does not reopen it. Opened from a link: the card's entry is replaced
  // by that page.
  const close = useCallback(() => {
    if (isOpenedFromBoard(locationState)) {
      void navigate(-1);
    } else {
      void navigate(paths.pagePath(boardId), { replace: true });
    }
  }, [locationState, navigate, paths, boardId]);

  const rekeyedPath = rekeyedCard ? paths.cardPath(boardId, rekeyedCard.key) : null;
  useEffect(() => {
    if (rekeyedPath !== null) {
      void navigate(rekeyedPath, { replace: true, state: locationState });
    }
  }, [rekeyedPath, navigate, locationState]);

  useEffect(() => {
    if (deletedRemotely) {
      toast.info('This card has been deleted elsewhere.', { id: DELETED_TOAST_ID });
      close();
    }
  }, [deletedRemotely, close]);

  useEffect(() => {
    if (!shouldFetch) {
      return;
    }
    let active = true;
    cardsApi
      .getCardByKey(boardId, cardKey)
      .then((fetched) => {
        if (active) {
          rememberCard(fetched);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        // A malformed key (400) means the same as a missing card.
        const { status } = getApiErrorInfo(error);
        setLookup(
          status === 404 || status === 400
            ? { status: 'not-found' }
            : { status: 'error', message: getCardErrorMessage(error) },
        );
      });
    return () => {
      active = false;
    };
  }, [shouldFetch, boardId, cardKey, rememberCard, attempt]);

  if (card) {
    return <CardDetailsDialog card={card} onClose={close} />;
  }
  if (rekeyedCard || deletedRemotely) {
    // Leaving the card's address (see the effects above).
    return null;
  }
  if (!isValidKey || wasShown || lookup.status === 'not-found') {
    return (
      <MessageDialog
        title="Card not found"
        description={`The card ${cardKey} does not exist. It may have been deleted, or the board key has changed.`}
        onClose={close}
        closeLabel={paths.backLabel}
      />
    );
  }
  if (lookup.status === 'error') {
    return (
      <MessageDialog
        title="Could not load the card"
        description={lookup.message}
        onClose={close}
        closeLabel={paths.backLabel}
        onRetry={() => {
          setLookup({ status: 'pending' });
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  return <LoadingDialog cardKey={cardKey} onClose={close} />;
}

interface MessageDialogProps {
  title: string;
  description: string;
  onClose: () => void;
  closeLabel: string;
  onRetry?: () => void;
}

function MessageDialog({ title, description, onClose, closeLabel, onRetry }: MessageDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
          <Button onClick={onClose}>{closeLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoadingDialog({ cardKey, onClose }: { cardKey: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px]" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Card {cardKey}</DialogTitle>
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">Loading card...</span>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
