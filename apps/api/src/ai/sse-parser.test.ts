import { describe, expect, it } from 'vitest';

import { SseParser, type SseMessage } from './sse-parser.js';

/** Feeds the pieces one by one and ends the stream. */
function parse(...pieces: string[]): SseMessage[] {
  const parser = new SseParser();
  return [...pieces.flatMap((piece) => parser.push(piece)), ...parser.end()];
}

const message = (data: string, event = 'message'): SseMessage => ({ event, data });

describe('SseParser', () => {
  it('parses messages separated by blank lines', () => {
    expect(parse('data: {"a":1}\n\ndata: [DONE]\n\n')).toEqual([
      message('{"a":1}'),
      message('[DONE]'),
    ]);
  });

  it('accepts CRLF and CR line endings', () => {
    expect(parse('data: one\r\n\r\ndata: two\r\rdata: three\n\n')).toEqual([
      message('one'),
      message('two'),
      message('three'),
    ]);
  });

  it('gives the same result when the text arrives one character at a time', () => {
    const text = ': comment\r\ndata: a\r\ndata: b\r\n\r\nevent: custom\ndata: c\n\n';
    expect(parse(...text.split(''))).toEqual(parse(text));
    expect(parse(text)).toEqual([message('a\nb'), message('c', 'custom')]);
  });

  it('treats a CR at the end of a piece and an LF at the start of the next as one line end', () => {
    expect(parse('data: a\r', '\ndata: b\r\n\r\n')).toEqual([message('a\nb')]);
  });

  it('ignores comments (keep-alives), unknown fields and fields without a value', () => {
    expect(parse(': keep-alive\n\nid: 7\nretry: 100\nfoo: bar\ndata\ndata: x\n\n')).toEqual([
      message('\nx'),
    ]);
  });

  it('removes exactly one space after the colon', () => {
    expect(parse('data:no-space\n\ndata:  two-spaces\n\n')).toEqual([
      message('no-space'),
      message(' two-spaces'),
    ]);
  });

  it('does not dispatch a blank line without data', () => {
    expect(parse('\n\n\n: ping\n\n')).toEqual([]);
  });

  it('returns a message not followed by a blank line when the stream ends', () => {
    expect(parse('data: last')).toEqual([message('last')]);
    expect(parse('data: last\n')).toEqual([message('last')]);
    expect(parse('data: last\r')).toEqual([message('last')]);
  });
});
