/**
 * Box of the docked assistant panel: 420 px on the right under the top bar. From 1024 px it takes
 * its place in the row and narrows the page; below, it overlays the page (raised), and below
 * 640 px it takes the full width.
 */
export const ASSISTANT_PANEL_CLASS =
  'absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-surface-raised text-foreground shadow-raised sm:w-[420px] lg:static lg:z-auto lg:shrink-0 lg:shadow-none';
