import { Button } from '@/components/ui/button';
import { useApiHealth, type ApiHealthStatus } from '@/hooks/useApiHealth';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ApiHealthStatus, string> = {
  checking: 'Checking API...',
  ok: 'API is online',
  unavailable: 'API is unavailable',
};

const STATUS_DOT: Record<ApiHealthStatus, string> = {
  checking: 'bg-muted-foreground',
  ok: 'bg-emerald-500',
  unavailable: 'bg-destructive',
};

export function HomePage() {
  const { status, recheck } = useApiHealth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight">StreamLine</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Kanban boards for Agile teams, with drag &amp; drop and real-time collaboration.
      </p>
      <p role="status" className="flex items-center gap-2 text-sm">
        <span aria-hidden="true" className={cn('size-2 rounded-full', STATUS_DOT[status])} />
        {STATUS_LABEL[status]}
      </p>
      <Button onClick={recheck} disabled={status === 'checking'}>
        Check API status
      </Button>
    </main>
  );
}
