import { getInitials, paletteColorFor } from '@/lib/avatar';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  sm: 'size-6 text-xs',
  md: 'size-8 text-sm',
} as const;

interface BoardIconProps {
  boardId: string;
  name: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

/** Square board icon: the first letter of the name on a colour derived from the board id. */
export function BoardIcon({ boardId, name, size = 'md', className }: BoardIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white select-none',
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: paletteColorFor(boardId) }}
    >
      {getInitials(name).slice(0, 1)}
    </span>
  );
}
