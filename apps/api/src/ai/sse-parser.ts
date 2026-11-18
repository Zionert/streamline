/** One Server-Sent Events message (`data` lines joined with `\n`). */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental parser of a `text/event-stream` body (WHATWG HTML, "Parsing an event stream").
 * Text may be pushed in arbitrary pieces: lines end with LF, CRLF or CR (a CR at the end of a
 * piece waits for the next one, as it may be the first half of a CRLF), comment lines (`:` —
 * keep-alives) and unknown fields are ignored, several `data:` lines form one message.
 * Decoding bytes to text (including UTF-8 sequences split between chunks) is the caller's job.
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName = '';

  /** Adds the next piece of the stream and returns the messages it completed. */
  push(text: string): SseMessage[] {
    this.buffer += text;
    return this.drain(false);
  }

  /**
   * Ends the stream. A message not followed by a blank line is still returned, since some
   * servers close the connection right after the last `data:` line.
   */
  end(): SseMessage[] {
    const messages = this.drain(true);
    if (this.buffer.length > 0) {
      this.processLine(this.buffer, messages);
      this.buffer = '';
    }
    this.dispatch(messages);
    return messages;
  }

  private drain(final: boolean): SseMessage[] {
    const messages: SseMessage[] = [];
    let start = 0;
    for (;;) {
      const end = findLineEnd(this.buffer, start);
      if (end === -1) break;
      const isCr = this.buffer[end] === '\r';
      if (isCr && end === this.buffer.length - 1 && !final) break;
      this.processLine(this.buffer.slice(start, end), messages);
      start = end + (isCr && this.buffer[end + 1] === '\n' ? 2 : 1);
    }
    this.buffer = this.buffer.slice(start);
    return messages;
  }

  private processLine(line: string, messages: SseMessage[]): void {
    if (line === '') {
      this.dispatch(messages);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventName = value;
  }

  private dispatch(messages: SseMessage[]): void {
    if (this.dataLines.length > 0) {
      messages.push({ event: this.eventName || 'message', data: this.dataLines.join('\n') });
    }
    this.dataLines = [];
    this.eventName = '';
  }
}

function findLineEnd(text: string, from: number): number {
  const lf = text.indexOf('\n', from);
  const cr = text.indexOf('\r', from);
  if (lf === -1) return cr;
  if (cr === -1) return lf;
  return Math.min(lf, cr);
}
