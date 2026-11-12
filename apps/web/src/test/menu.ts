import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Opens a Radix dropdown menu from its trigger button (named `triggerName`) the way a keyboard
 * user does, and returns the open menu.
 */
export async function openMenu(triggerName: string | RegExp): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name: triggerName });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menu');
}

/** Opens the menu and selects the item named `itemName`. */
export async function chooseMenuItem(
  triggerName: string | RegExp,
  itemName: string | RegExp,
): Promise<void> {
  const menu = await openMenu(triggerName);
  fireEvent.click(within(menu).getByRole('menuitem', { name: itemName }));
}

/** Names of the items of an open menu. */
export function menuItemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

/** Closes the open menu with Escape. */
export function closeMenu(menu: HTMLElement): void {
  fireEvent.keyDown(menu, { key: 'Escape' });
}
