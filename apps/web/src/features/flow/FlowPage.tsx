import type { AnalyticsResponse, Board } from '@streamline/shared';
import { CalendarRange, ChartNoAxesColumn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BoardLoadError, BoardNotFound } from '@/features/boards/BoardStatusViews';
import { boardPath } from '@/features/boards/paths';
import { useBoardRealtime } from '@/features/realtime/useBoardRealtime';
import { useBoardStore } from '@/stores/board';

import { CumulativeFlowChart } from './CumulativeFlowChart';
import { CycleTimeChart } from './CycleTimeChart';
import { browserTimeZone } from './flowFormat';
import { completedCount } from './flowMetrics';
import { FLOW_CONTENT_CLASS, FlowBodySkeleton, FlowSkeleton } from './FlowSkeleton';
import { ForecastPanel } from './ForecastPanel';
import { KpiRow } from './KpiRow';
import { LittlesLawBlock } from './LittlesLawBlock';
import { ThroughputChart } from './ThroughputChart';
import { useChartColors } from './useChartColors';
import { useFlowAnalytics, type FlowAnalyticsState } from './useFlowAnalytics';

/**
 * `/boards/:boardId/flow`: flow analytics of a board (the last 30 days in the browser's time
 * zone). The board itself is loaded and kept live as on the board page, as the top bar and the
 * card details opened over this page (`flow/cards/:cardKey`) read it from the board store.
 */
export default function FlowPage() {
  const { boardId = '' } = useParams();
  useBoardRealtime(boardId);
  const openedId = useBoardStore((state) => state.boardId);
  const board = useBoardStore((state) => state.board);
  const status = useBoardStore((state) => state.boardStatus);
  const error = useBoardStore((state) => state.boardError);
  const openBoard = useBoardStore((state) => state.openBoard);
  const [timeZone] = useState(browserTimeZone);
  const analytics = useFlowAnalytics(boardId, timeZone);

  useEffect(() => {
    // Coming from the board page, the board is already open (and refreshed once the live
    // updates join the board's room); reloading it would only blank the top bar meanwhile.
    const opened = useBoardStore.getState();
    const isOpen =
      opened.boardId === boardId &&
      (opened.boardStatus === 'ready' || opened.boardStatus === 'loading');
    if (!isOpen) {
      void openBoard(boardId);
    }
  }, [boardId, openBoard]);

  if ((status === 'not-found' && openedId === boardId) || analytics.status === 'not-found') {
    return <BoardNotFound />;
  }
  if (status === 'error' && openedId === boardId) {
    return <BoardLoadError message={error ?? ''} onRetry={() => void openBoard(boardId)} />;
  }
  if (status !== 'ready' || !board || board.id !== boardId) {
    return <FlowSkeleton />;
  }
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className={FLOW_CONTENT_CLASS}>
        <FlowHeader board={board} timeZone={timeZone} />
        <FlowBody board={board} analytics={analytics} timeZone={timeZone} />
      </div>
      {/* Card details: a modal route over the page. */}
      <Outlet />
    </main>
  );
}

function FlowHeader({ board, timeZone }: { board: Board; timeZone: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Flow</h1>
        <Badge className="px-2 py-0.5">
          <span className="sr-only">Board key:</span>
          {board.key}
        </Badge>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {/* Inert until custom ranges exist; focusable (aria-disabled) so the hint is reachable. */}
        <Button
          type="button"
          variant="subtle"
          size="sm"
          aria-disabled="true"
          aria-description="Custom ranges are coming soon"
          title="Custom ranges are coming soon"
          className="cursor-not-allowed opacity-70 hover:bg-surface-hover"
        >
          <CalendarRange strokeWidth={2} />
          Last 30 days
        </Button>
        <span className="font-mono text-xs text-subtle">
          <span className="sr-only">Time zone: </span>
          {timeZone}
        </span>
      </div>
    </div>
  );
}

interface FlowBodyProps {
  board: Board;
  analytics: FlowAnalyticsState & { reload: () => void };
  timeZone: string;
}

function FlowBody({ board, analytics, timeZone }: FlowBodyProps) {
  if (analytics.status === 'loading' || analytics.status === 'not-found') {
    return <FlowBodySkeleton />;
  }
  if (analytics.status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 px-4 pb-3 text-sm text-destructive sm:px-6"
      >
        Could not load the flow analytics. {analytics.message}
        <Button variant="outline" size="sm" onClick={analytics.reload}>
          Retry
        </Button>
      </div>
    );
  }
  return <FlowContent board={board} data={analytics.data} timeZone={timeZone} />;
}

function FlowContent({
  board,
  data,
  timeZone,
}: {
  board: Board;
  data: AnalyticsResponse;
  timeZone: string;
}) {
  const colors = useChartColors();
  const isEmpty = completedCount(data.throughput) === 0;

  return (
    <div className="flex flex-col gap-4">
      <KpiRow analytics={data} />
      {isEmpty ? (
        <NoCompletedWork boardId={board.id} />
      ) : (
        <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-2">
          <div className="min-w-0 lg:col-span-2">
            <CycleTimeChart boardId={board.id} analytics={data} colors={colors} />
          </div>
          <ThroughputChart throughput={data.throughput} colors={colors} />
          <CumulativeFlowChart points={data.cumulativeFlow} colors={colors} />
          <ForecastPanel key={board.id} boardId={board.id} timeZone={timeZone} />
          <LittlesLawBlock law={data.littlesLaw} />
        </div>
      )}
    </div>
  );
}

function NoCompletedWork({ boardId }: { boardId: string }) {
  return (
    <div className="mx-4 mb-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center sm:mx-6">
      <ChartNoAxesColumn aria-hidden="true" strokeWidth={2} className="size-8 text-muted" />
      <h2 className="text-base font-semibold">No completed work yet</h2>
      <p className="max-w-md text-sm text-subtle">
        Flow charts appear once cards reach a Done column. Move a few cards through In progress to
        Done.
      </p>
      <Button variant="subtle" asChild>
        <Link to={boardPath(boardId)}>Go to board</Link>
      </Button>
    </div>
  );
}
