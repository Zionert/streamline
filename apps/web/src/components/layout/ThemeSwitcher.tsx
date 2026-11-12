import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme';

const THEME_OPTIONS: Readonly<Record<ThemePreference, { label: string; icon: LucideIcon }>> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'System', icon: Monitor },
};

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Header button with a menu to pick the light, dark or system theme. */
export function ThemeSwitcher() {
  const preference = useThemeStore((state) => state.preference);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setPreference = useThemeStore((state) => state.setPreference);
  const TriggerIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <TriggerIcon className="size-5" strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs text-subtle">Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) {
              setPreference(value);
            }
          }}
        >
          {THEME_PREFERENCES.map((option) => {
            const { label, icon: Icon } = THEME_OPTIONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon className="text-subtle" />
                {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
