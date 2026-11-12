import * as React from 'react';

import { getInitials, paletteColorFor, splitVisible } from '@/lib/avatar';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
} as const;

export type AvatarSize = keyof typeof SIZE_CLASSES;

interface AvatarProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  userId: string;
  name: string;
  size?: AvatarSize;
}

/** Round avatar with the person's initials on a colour derived from their id. */
function Avatar({ userId, name, size = 'md', className, style, ...props }: AvatarProps) {
  return (
    <span
      data-slot="avatar"
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: paletteColorFor(userId), ...style }}
      {...props}
    >
      <span aria-hidden="true">{getInitials(name)}</span>
    </span>
  );
}

export interface AvatarStackPerson {
  userId: string;
  name: string;
}

interface AvatarStackProps {
  people: readonly AvatarStackPerson[];
  /** Avatars shown before the "+N" counter. */
  max?: number;
  size?: AvatarSize;
  /** Makes each avatar a toggle button (`aria-pressed`); `isActive` marks the pressed ones. */
  onToggle?: (person: AvatarStackPerson) => void;
  isActive?: (person: AvatarStackPerson) => boolean;
  className?: string;
  label?: string;
}

/** Overlapping avatars (-8 px) with a ring in the background colour and a "+N" counter. */
function AvatarStack({
  people,
  max = 4,
  size = 'md',
  onToggle,
  isActive,
  className,
  label,
}: AvatarStackProps) {
  const { visible, hidden } = splitVisible(people, max);
  const hiddenNames = people
    .slice(visible.length)
    .map((person) => person.name)
    .join(', ');

  return (
    <div
      data-slot="avatar-stack"
      role="group"
      aria-label={label}
      className={cn('flex items-center', className)}
    >
      {visible.map((person, index) => {
        const active = isActive?.(person) ?? false;
        const avatar = (
          <Avatar
            userId={person.userId}
            name={person.name}
            size={size}
            className={cn('ring-2', active ? 'ring-primary' : 'ring-background')}
          />
        );
        return (
          <span key={person.userId} className={cn('relative inline-flex', index > 0 && '-ml-2')}>
            {onToggle ? (
              <button
                type="button"
                aria-label={person.name}
                aria-pressed={active}
                onClick={() => onToggle(person)}
                className="rounded-full outline-none hover:z-10 focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {avatar}
              </button>
            ) : (
              avatar
            )}
          </span>
        );
      })}
      {hidden > 0 && (
        <span
          role="img"
          aria-label={`${hidden} more: ${hiddenNames}`}
          title={hiddenNames}
          className={cn(
            '-ml-2 inline-flex shrink-0 items-center justify-center rounded-full bg-column font-semibold text-subtle ring-2 ring-background',
            SIZE_CLASSES[size],
          )}
        >
          <span aria-hidden="true">+{hidden}</span>
        </span>
      )}
    </div>
  );
}

export { Avatar, AvatarStack };
