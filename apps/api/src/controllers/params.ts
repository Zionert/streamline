import type { Request } from 'express';

/** A non-empty route parameter; otherwise throws the error from `notFound`. */
export function routeParam(req: Request, name: string, notFound: () => Error): string {
  const value: unknown = req.params[name];
  if (typeof value !== 'string' || value.length === 0) throw notFound();
  return value;
}
