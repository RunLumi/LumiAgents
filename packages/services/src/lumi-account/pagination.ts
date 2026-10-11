/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { LumiAccountError } from "./errors.js";

/** Server page ceiling for every Lumi list route; a page is never larger than this. */
export const LUMI_PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const MAX_ITEMS = 1000;
const CURSOR = /^[A-Za-z0-9._~-]{1,512}$/;

interface PageOptions<T> {
  /** Fetches one page; `cursor` is null for the first page. Returns the parsed JSON body. */
  fetchPage(cursor: string | null): Promise<unknown>;
  /** Validates one raw item. Must throw on anything outside the contract. */
  parse(value: unknown): T;
  /** Stable identity used to reject a repeated row across pages. */
  keyOf(item: T): string;
  /** Error code for a malformed or inconsistent page. */
  invalid: string;
  /**
   * The route has no cursor and a hard ceiling (adoption bindings, device bindings): a page that
   * reaches the ceiling cannot prove nothing was cut off, so it fails closed instead of being
   * treated as complete. Cursor routes (projects) fetch limit+1 and set `has_more` truthfully.
   */
  ceilingWithoutCursor: boolean;
}

/**
 * Reads every page of a list, or fails. A missing, contradictory or cyclic continuation, a repeated
 * row, or a result that may have been truncated never becomes a silently "complete" list: callers
 * use the result to decide whether a record already exists, so a partial list could cause a
 * second create.
 */
export async function readCompletePages<T>(options: PageOptions<T>): Promise<T[]> {
  const items: T[] = [];
  const keys = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await options.fetchPage(cursor);
    if (!body || typeof body !== "object") throw new LumiAccountError(options.invalid);
    const row = body as Record<string, unknown>;
    if (!Array.isArray(row.items) || row.items.length > LUMI_PAGE_LIMIT)
      throw new LumiAccountError(options.invalid);
    if (row.has_more !== undefined && typeof row.has_more !== "boolean")
      throw new LumiAccountError(options.invalid);
    const next = row.next_cursor;
    if (next !== undefined && next !== null && (typeof next !== "string" || !CURSOR.test(next)))
      throw new LumiAccountError(options.invalid);
    for (const raw of row.items) {
      const item = options.parse(raw);
      const key = options.keyOf(item);
      if (keys.has(key)) throw new LumiAccountError(options.invalid);
      keys.add(key);
      items.push(item);
    }
    if (items.length > MAX_ITEMS) throw new LumiAccountError("lumi_page_incomplete");
    if (row.has_more === true) {
      // A continuation must name a new cursor and make progress; otherwise stop rather than loop.
      if (typeof next !== "string" || cursors.has(next) || next === cursor || !row.items.length)
        throw new LumiAccountError(options.invalid);
      cursors.add(next);
      cursor = next;
      continue;
    }
    if (typeof next === "string") throw new LumiAccountError(options.invalid);
    if (options.ceilingWithoutCursor && row.items.length >= LUMI_PAGE_LIMIT)
      throw new LumiAccountError("lumi_page_incomplete");
    return items;
  }
  throw new LumiAccountError("lumi_page_incomplete");
}

export function pagePath(base: string, cursor: string | null): string {
  const path = `${base}?limit=${LUMI_PAGE_LIMIT}`;
  return cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path;
}
