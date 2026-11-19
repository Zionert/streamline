import type { AiJsonValue } from '@streamline/shared';

/**
 * Board data handed to the AI model as tool results: email addresses removed, size capped and
 * wrapped in `<board_data>` tags, which the system prompt declares to be untrusted data.
 */

/** Longest serialized tool result (characters) sent to the model and stored. */
export const TOOL_RESULT_MAX_CHARS = 6000;

export const EMAIL_REDACTION = '[email hidden]';

/** Anything that looks like an email address (deliberately broad). */
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

/** Replaces every email-looking string in the text. */
export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, EMAIL_REDACTION);
}

/** Redacts email-looking strings in every string (and object key) of a JSON value. */
export function redactEmailsDeep(value: AiJsonValue): AiJsonValue {
  if (typeof value === 'string') return redactEmails(value);
  if (Array.isArray(value)) return value.map(redactEmailsDeep);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, AiJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[redactEmails(key)] = redactEmailsDeep(item);
    }
    return result;
  }
  return value;
}

export interface FittedJson {
  value: AiJsonValue;
  json: string;
  truncated: boolean;
}

const TRUNCATION_NOTE = 'Result shortened to fit; ask for fewer items or a narrower search.';
const MIN_STRING_LENGTH = 40;

function serialize(value: AiJsonValue): string {
  return JSON.stringify(value);
}

function isRecord(value: AiJsonValue): value is Record<string, AiJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The largest (serialized) top-level field matching the predicate. */
function largestField(
  record: Record<string, AiJsonValue>,
  matches: (value: AiJsonValue) => boolean,
): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const [key, value] of Object.entries(record)) {
    if (!matches(value)) continue;
    const length = serialize(value).length;
    if (length > bestLength) {
      best = key;
      bestLength = length;
    }
  }
  return best;
}

/**
 * Fits a JSON value into `maxChars` serialized characters. Objects lose items from the end of
 * their largest top-level arrays first (the number of left-out items is reported per field in
 * `omitted`), then their longest top-level strings are cut; the result then has
 * `truncated: true` and a note. A value that still does not fit becomes a short notice.
 */
export function fitJson(value: AiJsonValue, maxChars: number): FittedJson {
  const json = serialize(value);
  if (json.length <= maxChars) return { value, json, truncated: false };

  const notice: AiJsonValue = { truncated: true, note: 'Result too large to show.' };
  if (!isRecord(value)) {
    return { value: notice, json: serialize(notice), truncated: true };
  }

  const record: Record<string, AiJsonValue> = { ...value };
  const omitted: Record<string, number> = {};
  const build = (): Record<string, AiJsonValue> => ({
    ...record,
    truncated: true,
    ...(Object.keys(omitted).length > 0 && { omitted: { ...omitted } }),
    note: TRUNCATION_NOTE,
  });
  const fits = () => serialize(build()).length <= maxChars;

  while (!fits()) {
    const key = largestField(record, (field) => Array.isArray(field) && field.length > 0);
    const items = key === null ? undefined : record[key];
    if (key === null || !Array.isArray(items)) break;
    const alreadyOmitted = omitted[key] ?? 0;
    const keep = (count: number): boolean => {
      record[key] = items.slice(0, count);
      omitted[key] = alreadyOmitted + items.length - count;
      return fits();
    };
    // Largest number of leading items that fits (binary search); 0 when none does.
    let low = 0;
    let high = items.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (keep(middle)) low = middle;
      else high = middle - 1;
    }
    keep(low);
  }

  const exhausted = new Set<string>();
  while (!fits()) {
    const key = largestField(
      record,
      (field) => typeof field === 'string' && field.length > MIN_STRING_LENGTH,
    );
    const text = key === null ? undefined : record[key];
    if (key === null || typeof text !== 'string' || exhausted.has(key)) break;
    const excess = serialize(build()).length - maxChars;
    const length = Math.max(MIN_STRING_LENGTH, text.length - excess - 1);
    // Always shorter than before ("…" is one character), so the loop ends.
    if (length + 1 >= text.length) {
      exhausted.add(key);
      break;
    }
    record[key] = `${text.slice(0, length)}…`;
  }

  const result = fits() ? build() : notice;
  return { value: result, json: serialize(result), truncated: true };
}

const OPENING_TAG = (toolName: string) => `<board_data tool="${toolName}">\n`;
const CLOSING_TAG = '\n</board_data>';

/**
 * Wraps serialized board data for the model. `<` is escaped as `<` (still the same JSON),
 * so text inside the data can never close the wrapper.
 */
export function wrapBoardData(toolName: string, json: string): string {
  return `${OPENING_TAG(toolName)}${json.replace(/</g, '\\u003c')}${CLOSING_TAG}`;
}

/** Wrapped board data in at most about `maxChars` characters (the data is fitted inside). */
export function renderBoardData(toolName: string, value: AiJsonValue, maxChars: number): string {
  const overhead = OPENING_TAG(toolName).length + CLOSING_TAG.length;
  const fitted = fitJson(value, Math.max(0, maxChars - overhead));
  return wrapBoardData(toolName, fitted.json);
}
