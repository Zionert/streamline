import { memo, useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';

import { useCardLink } from '@/features/boards/useCardLink';
import type { CardLocationState } from '@/features/boards/paths';

import { linkTarget } from './linkTarget';
import { CARD_KEY_PROPERTY, remarkCardKeys, remarkHtmlAsText } from './remarkCardKeys';

/** Markdown typography of the panel: compact spacing, mono code, bordered tables, small headings. */
const MARKDOWN_CLASS = [
  'text-sm leading-[1.55] break-words text-foreground',
  '[&_p]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_h1]:my-2 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-[15px] [&_h2]:font-semibold',
  '[&_h3]:my-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h4]:my-2 [&_h4]:text-sm [&_h4]:font-semibold',
  '[&_h5]:my-2 [&_h5]:text-sm [&_h5]:font-semibold [&_h6]:my-2 [&_h6]:text-sm [&_h6]:font-semibold',
  '[&_code]:rounded-sm [&_code]:bg-surface-hover [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-hover [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-subtle',
  '[&_hr]:my-3 [&_hr]:border-border',
].join(' ');

const LINK_CLASS =
  'rounded-sm text-primary-text underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';

/** Board whose card keys become links; `null` outside a board (project sessions). */
export interface MarkdownBoard {
  id: string;
  key: string;
}

interface AssistantMarkdownProps {
  content: string;
  board: MarkdownBoard | null;
}

function CardKeyLink({ boardId, cardKey }: { boardId: string; cardKey: string }) {
  const cardLink = useCardLink();
  const state: CardLocationState = { fromBoard: true };
  return (
    <Link to={cardLink(boardId, cardKey)} state={state} className={`font-mono ${LINK_CLASS}`}>
      {cardKey}
    </Link>
  );
}

/**
 * An answer of the assistant as Markdown (GitHub flavour: tables, lists). Raw HTML in the text is
 * never rendered, images are not loaded (their alternative text is shown), web and mail links open
 * in a new tab, other links are plain text (see `linkTarget`), and keys of the board's cards open the card details.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  board,
}: AssistantMarkdownProps) {
  const boardId = board?.id ?? null;
  const boardKey = board?.key ?? null;
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkHtmlAsText, remarkCardKeys(boardKey)],
    [boardKey],
  );
  const components = useMemo<Components>(
    () => ({
      a: ({ node, href, children }) => {
        const cardKey = node?.properties[CARD_KEY_PROPERTY];
        if (typeof cardKey === 'string' && boardId) {
          return <CardKeyLink boardId={boardId} cardKey={cardKey} />;
        }
        const target = linkTarget(href);
        if (target?.kind === 'external') {
          return (
            <a
              href={target.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={LINK_CLASS}
            >
              {children}
            </a>
          );
        }
        if (target?.kind === 'app') {
          return (
            <Link to={target.path} className={LINK_CLASS}>
              {children}
            </Link>
          );
        }
        return <span>{children}</span>;
      },
      img: ({ alt }) => (alt ? <span className="text-subtle">[{alt}]</span> : null),
    }),
    [boardId],
  );

  return (
    <div className={MARKDOWN_CLASS}>
      <Markdown remarkPlugins={remarkPlugins} components={components} skipHtml>
        {content}
      </Markdown>
    </div>
  );
});
