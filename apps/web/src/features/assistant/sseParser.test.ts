import { describe, expect, it } from 'vitest';

import { SseParser } from './sseParser';

function parseAll(pieces: readonly string[]) {
  const parser = new SseParser();
  const messages = pieces.flatMap((piece) => parser.push(piece));
  return [...messages, ...parser.end()];
}

describe('SseParser', () => {
  it('parses one event with its name and data', () => {
    expect(parseAll(['event: delta\ndata: {"text":"Hi"}\n\n'])).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
    ]);
  });

  it('parses several events from one piece', () => {
    expect(
      parseAll([
        'event: tool\ndata: {"a":1}\n\nevent: delta\ndata: {"b":2}\n\nevent: done\ndata: {}\n\n',
      ]),
    ).toEqual([
      { event: 'tool', data: '{"a":1}' },
      { event: 'delta', data: '{"b":2}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('joins an event split at every character', () => {
    const text = 'event: delta\r\ndata: {"text":"split"}\r\n\r\nevent: done\ndata: {}\n\n';
    expect(parseAll([...text])).toEqual([
      { event: 'delta', data: '{"text":"split"}' },
      { event: 'done', data: '{}' },
    ]);
  });

  it('does not end a line at a CR that may be the first half of a CRLF', () => {
    const parser = new SseParser();
    expect(parser.push('data: a\r')).toEqual([]);
    expect(parser.push('\n\r')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'message', data: 'a' }]);
  });

  it('accepts CR-only line endings', () => {
    expect(parseAll(['event: delta\rdata: x\r\r'])).toEqual([{ event: 'delta', data: 'x' }]);
  });

  it('joins several data lines with a line feed and keeps a second leading space', () => {
    expect(parseAll(['data: one\ndata:  two\ndata:three\n\n'])).toEqual([
      { event: 'message', data: 'one\n two\nthree' },
    ]);
  });

  it('ignores comments, unknown fields and blank events', () => {
    expect(parseAll([': keep-alive\n\nid: 7\nretry: 100\nevent: delta\ndata: y\n\n\n\n'])).toEqual([
      { event: 'delta', data: 'y' },
    ]);
  });

  it('resets the event name after each event', () => {
    expect(parseAll(['event: tool\ndata: 1\n\ndata: 2\n\n'])).toEqual([
      { event: 'tool', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });

  it('returns a last event without the closing blank line when the stream ends', () => {
    const parser = new SseParser();
    expect(parser.push('event: done\ndata: {}')).toEqual([]);
    expect(parser.end()).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('treats a field without a colon as a field with an empty value', () => {
    expect(parseAll(['data\n\n'])).toEqual([{ event: 'message', data: '' }]);
  });
});
