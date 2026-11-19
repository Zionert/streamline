import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import type * as Recharts from 'recharts';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetAssistantLimit } from '@/features/assistant/assistantLimit';
import { setActiveSocket, setSocketFactory } from '@/lib/socket';
import { resetAiStatusStore } from '@/stores/aiStatus';
import { resetAssistantPanelStore } from '@/stores/assistantPanel';
import { resetThemeStore } from '@/stores/theme';

import { FakeSocket } from './fakeSocket';

import { matchMediaStub, resetMediaQueries } from './matchMedia';

// jsdom has no ResizeObserver; Radix primitives (e.g. Checkbox) only need it to exist.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// jsdom has no layout, so a chart's `ResponsiveContainer` would measure 0 x 0 and render
// nothing; in tests it renders its chart at a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  function ResponsiveContainer(props: ComponentProps<typeof actual.ResponsiveContainer>) {
    return createElement(actual.ResponsiveContainer, { ...props, width: 800, height: 260 });
  }
  return { ...actual, ResponsiveContainer };
});

// jsdom has no matchMedia (theme, toasts). Assigned directly rather than
// with vi.stubGlobal, which would be undone after the first test.
window.matchMedia = matchMediaStub;

// Pointer capture and scrollIntoView are missing in jsdom; Radix menus call them.
const elementShims: Partial<Record<keyof Element, () => unknown>> = {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
};
for (const [name, shim] of Object.entries(elementShims)) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, { value: shim, configurable: true });
  }
}

// Board pages open a socket: by default it never connects (tests of live updates drive their own).
beforeEach(() => {
  setSocketFactory(() => new FakeSocket().asSocket());
});

afterEach(() => {
  cleanup();
  setActiveSocket(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMediaQueries();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  resetThemeStore();
  resetAiStatusStore();
  resetAssistantPanelStore();
  resetAssistantLimit();
});
