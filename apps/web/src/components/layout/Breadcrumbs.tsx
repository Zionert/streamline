import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';

export interface BreadcrumbItem {
  label: string;
  /** Omitted for the current page. */
  to?: string;
}

/** Trail of links to the parent pages; the last item is the current page. */
export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-subtle">
        {items.map((item, index) => (
          <Fragment key={`${index}-${item.label}`}>
            {index > 0 && (
              <li aria-hidden="true" className="flex">
                <ChevronRight className="size-4" strokeWidth={2} />
              </li>
            )}
            <li className="min-w-0 truncate">
              {item.to ? (
                <Link
                  to={item.to}
                  className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page">{item.label}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
