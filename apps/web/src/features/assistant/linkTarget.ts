export type LinkTarget = { kind: 'external'; href: string } | { kind: 'app'; path: string } | null;

/**
 * Where a link of an answer may lead: `http:`, `https:` and `mailto:` addresses open in a new tab,
 * a path of this app (one leading slash) goes through the router, anything else (other schemes,
 * protocol-relative `//host`, `/\host` also percent-encoded, relative paths) is shown as plain
 * text.
 */
export function linkTarget(href: string | undefined): LinkTarget {
  if (!href) {
    return null;
  }
  if (/^(?:https?:\/\/|mailto:)[^\s\\]*$/i.test(href)) {
    return { kind: 'external', href };
  }
  if (/^\/(?![/\\]|%2f|%5c)[^\s\\]*$/i.test(href)) {
    return { kind: 'app', path: href };
  }
  return null;
}
