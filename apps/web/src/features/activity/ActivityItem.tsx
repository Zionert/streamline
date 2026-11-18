import type { Activity, ActivityCardField, ActivityPayloads, UserRef } from '@streamline/shared';
import { UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/avatar';
import { CATEGORY_LABELS, ROLE_LABELS } from '@/features/boards/labels';
import type { CardLocationState } from '@/features/boards/paths';
import { useCardLink } from '@/features/boards/useCardLink';
import { formatDateTime, formatRelativeTime } from '@/features/cards/format';
import { LabelPill } from '@/features/labels/LabelPill';

export const DELETED_USER_NAME = 'Deleted user';

const FIELD_NAMES: Readonly<Record<ActivityCardField, string>> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  assigneeId: 'assignee',
  dueDate: 'due date',
};

type ActivityCard = ActivityPayloads['CARD_CREATED']['card'];

export interface ActivityItemProps {
  activity: Activity;
  /**
   * The current key of the entry's card while the card is still on the board (its key may have
   * changed since), `null` otherwise. Without it card keys are never links.
   */
  currentCardKey?: string | null;
  /** Called when a card link is followed (e.g. to close the panel showing the feed). */
  onNavigate?: () => void;
  /** Reference to the current time, for relative times (tests). */
  now?: Date;
}

/** Lists names as "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) {
    return words.join('');
  }
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-semibold">{children}</span>;
}

function personName(person: UserRef | null): string {
  return person?.name ?? DELETED_USER_NAME;
}

/**
 * One entry of an activity feed as a sentence ("Anna moved SL-12 Fix login from To Do to In
 * Progress") with the actor's avatar and a relative time (the exact time as the tooltip).
 */
export function ActivityItem({
  activity,
  currentCardKey = null,
  onNavigate,
  now,
}: ActivityItemProps) {
  const actor = <Strong>{personName(activity.actor)}</Strong>;
  // Opened over the page the feed is shown on (the board or Flow).
  const cardLink = useCardLink();

  const cardRef = (card: ActivityCard) => {
    const text = (
      <>
        <span className="font-mono text-xs">{currentCardKey ?? card.key}</span> {card.title}
      </>
    );
    if (currentCardKey === null || activity.cardId === null) {
      return <span className="break-words">{text}</span>;
    }
    const state: CardLocationState = { fromBoard: true };
    return (
      <Link
        to={cardLink(activity.boardId, currentCardKey)}
        state={state}
        className="break-words text-primary-text underline-offset-4 hover:underline"
        onClick={onNavigate}
      >
        {text}
      </Link>
    );
  };

  const sentence = describe(activity, actor, cardRef);

  return (
    <li className="flex gap-3 py-2" data-activity-type={activity.type}>
      {activity.actor ? (
        <Avatar userId={activity.actor.id} name={activity.actor.name} size="sm" />
      ) : (
        <DeletedUserAvatar />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm break-words" data-testid="activity-text">
          {sentence}
        </p>
        <time
          dateTime={activity.createdAt}
          title={formatDateTime(activity.createdAt)}
          className="font-mono text-xs text-subtle"
        >
          {formatRelativeTime(activity.createdAt, now)}
        </time>
      </div>
    </li>
  );
}

/** Avatar of an account that no longer exists. */
export function DeletedUserAvatar() {
  return (
    <span
      role="img"
      aria-label={DELETED_USER_NAME}
      title={DELETED_USER_NAME}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-subtle"
    >
      <UserX aria-hidden="true" className="size-3.5" strokeWidth={2} />
    </span>
  );
}

function describe(
  activity: Activity,
  actor: ReactNode,
  cardRef: (card: ActivityCard) => ReactNode,
): ReactNode {
  switch (activity.type) {
    case 'CARD_CREATED': {
      const { card, column } = activity.payload;
      return (
        <>
          {actor} created {cardRef(card)} in <Strong>{column.name}</Strong>
        </>
      );
    }
    case 'CARD_UPDATED': {
      const { card, fields, title } = activity.payload;
      if (title && fields.length === 1) {
        return (
          <>
            {actor} renamed {cardRef(card)} (was “{title.from}”)
          </>
        );
      }
      return (
        <>
          {actor} changed the {joinWords(fields.map((field) => FIELD_NAMES[field]))} of{' '}
          {cardRef(card)}
        </>
      );
    }
    case 'CARD_MOVED': {
      const { card, from, to } = activity.payload;
      return (
        <>
          {actor} moved {cardRef(card)} from <Strong>{from.name}</Strong> to{' '}
          <Strong>{to.name}</Strong>
        </>
      );
    }
    case 'CARD_DELETED': {
      const { card, column } = activity.payload;
      return (
        <>
          {actor} deleted {cardRef(card)} from <Strong>{column.name}</Strong>
        </>
      );
    }
    case 'CARD_LABEL_ADDED': {
      const { card, label } = activity.payload;
      return (
        <>
          {actor} added the label <LabelPill name={label.name} color={label.color} size="sm" /> to{' '}
          {cardRef(card)}
        </>
      );
    }
    case 'CARD_LABEL_REMOVED': {
      const { card, label } = activity.payload;
      return (
        <>
          {actor} removed the label <LabelPill name={label.name} color={label.color} size="sm" />{' '}
          from {cardRef(card)}
        </>
      );
    }
    case 'COMMENT_ADDED':
      return (
        <>
          {actor} commented on {cardRef(activity.payload.card)}
        </>
      );
    case 'COLUMN_CREATED':
      return (
        <>
          {actor} created the column <Strong>{activity.payload.column.name}</Strong>
        </>
      );
    case 'COLUMN_RENAMED': {
      const { name } = activity.payload;
      return (
        <>
          {actor} renamed the column <Strong>{name.from}</Strong> to <Strong>{name.to}</Strong>
        </>
      );
    }
    case 'COLUMN_MOVED':
      return (
        <>
          {actor} moved the column <Strong>{activity.payload.column.name}</Strong>
        </>
      );
    case 'COLUMN_SETTINGS_CHANGED': {
      const { column, changes } = activity.payload;
      const parts: string[] = [];
      if (changes.category) {
        parts.push(
          `category ${CATEGORY_LABELS[changes.category.from]} → ${CATEGORY_LABELS[changes.category.to]}`,
        );
      }
      if (changes.wipLimit) {
        const limit = (value: number | null) => (value === null ? 'none' : String(value));
        parts.push(`WIP limit ${limit(changes.wipLimit.from)} → ${limit(changes.wipLimit.to)}`);
      }
      if (changes.wipStrict) {
        const mode = (strict: boolean) => (strict ? 'on' : 'off');
        parts.push(
          `strict WIP limit ${mode(changes.wipStrict.from)} → ${mode(changes.wipStrict.to)}`,
        );
      }
      return (
        <>
          {actor} changed the settings of the column <Strong>{column.name}</Strong>:{' '}
          {parts.join(', ')}
        </>
      );
    }
    case 'COLUMN_DELETED':
      return (
        <>
          {actor} deleted the column <Strong>{activity.payload.column.name}</Strong>
        </>
      );
    case 'MEMBER_ADDED': {
      const { member, role } = activity.payload;
      return (
        <>
          {actor} added <Strong>{member.name}</Strong> as {ROLE_LABELS[role]}
        </>
      );
    }
    case 'MEMBER_ROLE_CHANGED': {
      const { member, role } = activity.payload;
      return (
        <>
          {actor} changed the role of <Strong>{member.name}</Strong> from {ROLE_LABELS[role.from]}{' '}
          to {ROLE_LABELS[role.to]}
        </>
      );
    }
    case 'MEMBER_REMOVED':
      return (
        <>
          {actor} removed <Strong>{activity.payload.member.name}</Strong> from the board
        </>
      );
    case 'MEMBER_LEFT':
      return (
        <>
          <Strong>{activity.payload.member.name}</Strong> left the board
        </>
      );
    default:
      return assertNever(activity);
  }
}

/** Compile-time exhaustiveness check: every activity type needs a sentence. */
function assertNever(value: never): never {
  throw new Error(`Unknown activity: ${JSON.stringify(value)}`);
}
