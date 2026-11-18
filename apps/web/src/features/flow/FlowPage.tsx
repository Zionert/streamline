import type { AnalyticsResponse, Board } from '@streamline/shared';
import { ChartNoAxesColumn, Download } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BoardLoadError, BoardNotFound } from '@/features/boards/BoardStatusViews';
import { boardPath } from '@/features/boards/paths';
import { useOpenBoard } from '@/features/boards/useOpenBoard';
import { useBoardChangeRefresh } from '@/features/realtime/boardChanges';
import { useBoardRealtime } from '@/features/realtime/useBoardRealtime';
import { useBoardStore } from '@/stores/board';

import { CumulativeFlowChart } from './CumulativeFlowChart';
import { CycleTimeChart } from './CycleTimeChart';
import { DateRangePicker } from './DateRangePicker';
import { downloadTextFile } from './download';
import { CSV_MIME_TYPE, flowCsv, flowCsvFileName } from './flowCsv';
import { browserTimeZone, formatDateRange } from './flowFormat';
import { completedCount } from './flowMetrics';
import { rangeCaption } from './flowRange';
import { FLOW_REFRESH_DELAY_MS, isFlowChange } from './flowRefresh';
import { FLOW_CONTENT_CLASS, FlowBodySkeleton, FlowSkeleton } from './FlowSkeleton';
import { ForecastPanel } from './ForecastPanel';
import { KpiRow } from './KpiRow';
import { LittlesLawBlock } from './LittlesLawBlock';
import { ThroughputChart } from './ThroughputChart';
import { useChartColors } from './useChartColors';
import { useFlowAnalytics, type FlowAnalytics } from './useFlowAnalytics';
import { useFlowRange, type FlowRangeState } from './useFlowRange';

/**
 * `/boards/:boardId/flow`: flow analytics of a board for the selected range (in the URL query;
 * the last 30 days by default) in the browser's time zone. The board itself is loaded and kept
 * live as on the board page, as the top bar and the card details opened over this page
 * (`flow/cards/:cardKey`) read it from the board store; changes to the board refresh the
 * analytics in the background.
 */
export default function FlowPage() {
  const { boardId = '' } = useParams();
  useBoardRealtime(boardId);
  useOpenBoard(boardId);
  const openedId = useBoardStore((state) => state.boardId);
  const board = useBoardStore((state) => state.board);
  const status = useBoardStore((state) => state.boardStatus);
  const error = useBoardStore((state) => state.boardError);
  const openBoard = useBoardStore((state) => state.openBoard);
  const [timeZone] = useState(browserTimeZone);
  const range = useFlowRange(timeZone);
  const analytics = useFlowAnalytics(boardId, range.range, timeZone);
  // The forecast is not refreshed: it is run on request.
  useBoardChangeRefresh(boardId, {
    isRelevant: isFlowChange,
    delayMs: FLOW_REFRESH_DELAY_MS,
    refresh: analytics.refresh,
  });

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
        <FlowHeader board={board} timeZone={timeZone} range={range} analytics={analytics} />
        <FlowBody board={board} analytics={analytics} range={range} timeZone={timeZone} />
      </div>
      {/* Card details: a modal route over the page. */}
      <Outlet />
    </main>
  );
}

interface FlowHeaderProps {
  board: Board;
  timeZone: string;
  range: FlowRangeState;
  analytics: FlowAnalytics;
}

function FlowHeader({ board, timeZone, range, analytics }: FlowHeaderProps) {
  const data = analytics.status === 'ready' ? analytics.data : null;
  const canExport = data !== null && completedCount(data.throughput) > 0;

  const exportCsv = () => {
    if (data) {
      downloadTextFile(flowCsvFileName(board.key, data.range), flowCsv(data), CSV_MIME_TYPE);
    }
  };

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
        <span aria-live="polite" className="font-mono text-xs text-muted">
          {analytics.isRefreshing ? 'Updating…' : ''}
        </span>
        <DateRangePicker
          selection={range.selection}
          range={range.range}
          today={range.today}
          onOpen={range.refreshToday}
          onSelect={range.select}
        />
        <span className="font-mono text-xs text-subtle">
          <span className="sr-only">Time zone: </span>
          {timeZone}
        </span>
        <Button type="button" variant="subtle" size="sm" disabled={!canExport} onClick={exportCsv}>
          <Download strokeWidth={2} />
          Export CSV
        </Button>
      </div>
    </div>
  );
}

interface FlowBodyProps {
  board: Board;
  analytics: FlowAnalytics;
  range: FlowRangeState;
  timeZone: string;
}

function FlowBody({ board, analytics, range, timeZone }: FlowBodyProps) {
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
  return (
    <FlowContent
      board={board}
      data={analytics.data}
      caption={rangeCaption(range.selection)}
      timeZone={timeZone}
    />
  );
}

interface FlowContentProps {
  board: Board;
  data: AnalyticsResponse;
  /** The selected range in running text, e.g. `last 30 days`. */
  caption: string;
  timeZone: string;
}

function FlowContent({ board, data, caption, timeZone }: FlowContentProps) {
  const colors = useChartColors();
  const isEmpty = completedCount(data.throughput) === 0;

  return (
    <div className="flex flex-col gap-4">
      <KpiRow analytics={data} rangeCaption={caption} />
      {isEmpty ? (
        <NoCompletedWork boardId={board.id} range={data.range} />
      ) : (
        <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-2">
          <div className="min-w-0 lg:col-span-2">
            <CycleTimeChart boardId={board.id} analytics={data} colors={colors} />
          </div>
          <ThroughputChart throughput={data.throughput} range={data.range} colors={colors} />
          <CumulativeFlowChart points={data.cumulativeFlow} colors={colors} />
          <ForecastPanel key={board.id} boardId={board.id} timeZone={timeZone} />
          <LittlesLawBlock
            law={data.littlesLaw}
            range={data.range}
            days={data.throughput.daily.length}
          />
        </div>
      )}
    </div>
  );
}

function NoCompletedWork({
  boardId,
  range,
}: {
  boardId: string;
  range: AnalyticsResponse['range'];
}) {
  return (
    <div className="mx-4 mb-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center sm:mx-6">
      <ChartNoAxesColumn aria-hidden="true" strokeWidth={2} className="size-8 text-muted" />
      <h2 className="text-base font-semibold">No completed work in this period</h2>
      <p className="max-w-md text-sm text-subtle">
        No card reached a Done column {formatDateRange(range.from, range.to)}. Flow charts appear
        once cards reach a Done column — choose a longer range, or move a few cards through In
        progress to Done.
      </p>
      <Button variant="subtle" asChild>
        <Link to={boardPath(boardId)}>Go to board</Link>
      </Button>
    </div>
  );
}
