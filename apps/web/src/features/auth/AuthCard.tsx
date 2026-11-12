import type { ReactNode } from 'react';

import { Logo } from '@/components/layout/Logo';

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}

/** Centered 400 px card under the logo, shared by the login and registration pages. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6">
      <Logo />
      <div className="w-full max-w-[400px] rounded-lg border bg-card p-8 text-card-foreground shadow-raised">
        <div className="mb-6 grid gap-1 text-center">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-subtle">{description}</p>
        </div>
        {children}
      </div>
      <p className="text-center text-subtle">{footer}</p>
    </main>
  );
}
