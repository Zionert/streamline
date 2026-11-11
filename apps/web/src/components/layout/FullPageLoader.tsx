export function FullPageLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-svh items-center justify-center text-muted-foreground">
      {label}
    </div>
  );
}
