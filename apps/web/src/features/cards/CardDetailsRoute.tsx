import { cardKeySchema } from '@streamline/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

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
import { boardPath, isOpenedFromBoard } from '@/features/boards/paths';
import { getApiErrorInfo } from '@/lib/api-error';
import { useBoardStore } from '@/stores/board';

import { CardDetailsDialog } from './CardDetailsDialog';
import { getCardErrorMessage } from './cardErrorMessage';
import { findCardByKey } from './cardOrder';
import * as cardsApi from './cardsApi';

/**
 * `/boards/:boardId/cards/:cardKey`: the details of a card as a modal over the board. Closing
 * returns to the board.
 */
export function CardDetailsRoute() {
  const { boardId = '', cardKey = '' } = useParams();
  // Keyed, so that opening another card starts from a clean state.
  return <CardDetails key={`${boardId}/${cardKey}`} boardId={boardId} cardKey={cardKey} />;
}

type Lookup = { status: 'pending' | 'not-found' } | { status: 'error'; message: string };

/**
 * The card comes from the board store; a card that is not there (e.g. a link to a card created
 * after the cards were loaded) is fetched by its key once the board's cards have loaded.
 */
function CardDetails({ boardId, cardKey }: { boardId: string; cardKey: string }) {
  const navigate = useNavigate();
  const card = useBoardStore((state) => findCardByKey(state.cardsByColumn, cardKey));
  const cardsStatus = useBoardStore((state) => state.cardsStatus);
  const rememberCard = useBoardStore((state) => state.rememberCard);
  const [lookup, setLookup] = useState<Lookup>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  // A card that was shown and then vanished (deleted, or the board key changed) is not fetched
  // again: it is reported as gone.
  const [wasShown, setWasShown] = useState(false);
  if (card && !wasShown) {
    setWasShown(true);
  }
  const isValidKey = cardKeySchema.safeParse(cardKey).success;
  const cardsSettled = cardsStatus === 'ready' || cardsStatus === 'error';
  const shouldFetch = !card && !wasShown && isValidKey && cardsSettled;

  const location = useLocation();

  // Opened from the board: going back removes the card from the history, so the browser's Back
  // button does not reopen it. Opened from a link: the card's entry is replaced by the board.
  const close = () => {
    if (isOpenedFromBoard(location.state)) {
      void navigate(-1);
    } else {
      void navigate(boardPath(boardId), { replace: true });
    }
  };

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
  if (!isValidKey || wasShown || lookup.status === 'not-found') {
    return (
      <MessageDialog
        title="Card not found"
        description={`The card ${cardKey} does not exist. It may have been deleted, or the board key has changed.`}
        onClose={close}
      />
    );
  }
  if (lookup.status === 'error') {
    return (
      <MessageDialog
        title="Could not load the card"
        description={lookup.message}
        onClose={close}
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
  onRetry?: () => void;
}

function MessageDialog({ title, description, onClose, onRetry }: MessageDialogProps) {
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
          <Button onClick={onClose}>Back to the board</Button>
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
