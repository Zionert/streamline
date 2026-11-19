import { CARD_KEY_PATTERN } from '@streamline/shared';

/**
 * Minimal shape of the Markdown syntax tree (mdast) nodes this plugin touches; the full types
 * belong to a transitive dependency of the Markdown renderer.
 */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

/** Attribute (as a hast property) marking a link to a card of the current board. */
export const CARD_KEY_PROPERTY = 'dataCardKey';

/** Nodes whose text must stay as it is (links already link somewhere). */
const SKIPPED_PARENTS = new Set(['link', 'linkReference', 'definition']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds the keys of the board's cards (e.g. `DEMO-47`) as whole words in a text. */
function cardKeyMatcher(boardKey: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(boardKey)}-[1-9]\\d*(?![A-Za-z0-9])`, 'g');
}

function splitText(value: string, matcher: RegExp): MdNode[] | null {
  const parts: MdNode[] = [];
  let last = 0;
  matcher.lastIndex = 0;
  for (const match of value.matchAll(matcher)) {
    const key = match[0];
    if (!CARD_KEY_PATTERN.test(key)) {
      continue;
    }
    if (match.index > last) {
      parts.push({ type: 'text', value: value.slice(last, match.index) });
    }
    parts.push({
      type: 'cardKey',
      data: { hName: 'a', hProperties: { [CARD_KEY_PROPERTY]: key } },
      children: [{ type: 'text', value: key }],
    });
    last = match.index + key.length;
  }
  if (parts.length === 0) {
    return null;
  }
  if (last < value.length) {
    parts.push({ type: 'text', value: value.slice(last) });
  }
  return parts;
}

function transform(node: MdNode, matcher: RegExp): void {
  if (!node.children || SKIPPED_PARENTS.has(node.type)) {
    return;
  }
  const children: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      children.push(...(splitText(child.value, matcher) ?? [child]));
    } else {
      transform(child, matcher);
      children.push(child);
    }
  }
  node.children = children;
}

function htmlToText(node: MdNode): void {
  if (node.type === 'html') {
    node.type = 'text';
    return;
  }
  node.children?.forEach(htmlToText);
}

/**
 * Remark plugin showing raw HTML of the Markdown source as plain text (e.g. `<script>` stays
 * visible and inert) instead of rendering or silently dropping it.
 */
export function remarkHtmlAsText() {
  return (tree: MdNode) => {
    htmlToText(tree);
  };
}

/**
 * Remark plugin turning the keys of the current board's cards in plain text into card links
 * (an `a` element with the `data-card-key` attribute, rendered by the Markdown component as a
 * router link). Code, existing links and keys of other boards stay unchanged. Works on the syntax
 * tree, so no HTML is ever produced from text.
 */
export function remarkCardKeys(boardKey: string | null) {
  return () => (tree: MdNode) => {
    if (boardKey && /^[A-Z]{2,5}$/.test(boardKey)) {
      transform(tree, cardKeyMatcher(boardKey));
    }
  };
}
