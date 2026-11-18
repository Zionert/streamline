import { Skeleton } from '@/components/ui/skeleton';

/**
 * Content column of the Flow page: centred, at most 1440 px wide on large screens; the sections
 * inside keep their own side paddings (24 px, 16 px below 640 px).
 */
export const FLOW_CONTENT_CLASS = 'mx-auto flex w-full max-w-[1440px] flex-col';

/**
 * Placeholders of the key figures and the chart cards while the analytics load. Kept apart from
 * the charts, so the main bundle can show it while the Flow page itself is being loaded.
 */
export function FlowBodySkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading flow analytics...</span>
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:px-6">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} data-testid="kpi-skeleton" className="h-[98px] rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-2">
        {[0, 1, 2].map((index) => (
          <Skeleton
            key={index}
            data-testid="chart-skeleton"
            className={index === 0 ? 'h-[300px] rounded-lg lg:col-span-2' : 'h-[300px] rounded-lg'}
          />
        ))}
      </div>
    </div>
  );
}

/** The whole Flow page while it loads: the page header and the placeholders of its content. */
export function FlowSkeleton() {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className={FLOW_CONTENT_CLASS}>
        <div className="flex items-center gap-2 px-4 py-4 sm:px-6">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-5 w-10" />
          <Skeleton className="ml-auto h-8 w-32" />
        </div>
        <FlowBodySkeleton />
      </div>
    </main>
  );
}
