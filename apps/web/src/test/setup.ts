import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { setActiveSocket, setSocketFactory } from '@/lib/socket';
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

// jsdom has no matchMedia (theme, sidebar breakpoints, toasts). Assigned directly rather than
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
});
