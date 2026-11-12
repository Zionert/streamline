import { vi } from 'vitest';

const COLUMN_WIDTH = 280;
const COLUMN_STEP = 300;
const CARD_HEIGHT = 72;
const CARD_STEP = 80;
const LIST_TOP = 100;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

const CARD_LISTS = '[data-rfd-droppable-id^="cards:"]';

function indexIn(element: Element, selector: string, root: ParentNode = document): number {
  return Array.from(root.querySelectorAll(selector)).indexOf(element);
}

/** Layout of the board for @hello-pangea/dnd: columns side by side, cards stacked in them. */
function boardRect(element: Element): DOMRect {
  if (element.matches(CARD_LISTS)) {
    return rect(indexIn(element, CARD_LISTS) * COLUMN_STEP, LIST_TOP, COLUMN_WIDTH, 600);
  }
  if (element.matches('[data-rfd-draggable-id]')) {
    const list = element.parentElement?.closest('[data-rfd-droppable-id]');
    if (list?.matches(CARD_LISTS)) {
      const column = indexIn(list, CARD_LISTS);
      const row = indexIn(element, '[data-rfd-draggable-id]', list);
      return rect(
        column * COLUMN_STEP + 4,
        LIST_TOP + row * CARD_STEP,
        COLUMN_WIDTH - 8,
        CARD_HEIGHT,
      );
    }
    const columns = list?.querySelectorAll(':scope > [data-rfd-draggable-id]');
    const column = columns ? Array.from(columns).indexOf(element) : 0;
    return rect(column * COLUMN_STEP, 60, COLUMN_WIDTH, 700);
  }
  if (element.matches('[data-rfd-droppable-id]')) {
    return rect(0, 60, 1500, 700);
  }
  return rect(0, 0, 0, 0);
}

/**
 * jsdom has no layout, so every element measures 0×0 and drag & drop cannot tell columns apart.
 * This gives columns and cards distinct boxes (and the window a size), which moving a card to
 * another column with the keyboard needs. Undone by `vi.restoreAllMocks()` and the returned
 * cleanup.
 */
export function stubBoardLayout(): () => void {
  const root = document.documentElement;
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: 1600 });
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: 1000 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boardRect(this);
  });
  return () => {
    Reflect.deleteProperty(root, 'clientWidth');
    Reflect.deleteProperty(root, 'clientHeight');
  };
}
