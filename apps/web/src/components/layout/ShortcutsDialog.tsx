import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Shortcut {
  keys: readonly string[];
  description: string;
  /** Not available yet; listed so the shortcut set is known in advance. */
  soon?: boolean;
}

const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['Shift', 'N'], description: 'Create a card', soon: true },
  { keys: ['/'], description: 'Focus the card filter', soon: true },
  { keys: ['Esc'], description: 'Close a dialog' },
  { keys: ['?'], description: 'Show keyboard shortcuts', soon: true },
];

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Reference list of the keyboard shortcuts. */
export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts marked &ldquo;Soon&rdquo; become available in a later version.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.description}
              className="flex items-center justify-between gap-4 rounded-md px-1 py-1.5"
            >
              <dt className="flex items-center gap-2">
                <span>{shortcut.description}</span>
                {shortcut.soon && (
                  <span className="rounded-sm bg-column px-1.5 py-0.5 text-[11px] font-semibold text-subtle uppercase">
                    Soon
                  </span>
                )}
              </dt>
              <dd className="flex items-center gap-1 text-subtle">
                {shortcut.keys.map((key, index) => (
                  <span key={key} className="flex items-center gap-1">
                    {index > 0 && <span aria-hidden="true">+</span>}
                    <kbd>{key}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
