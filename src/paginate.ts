import { MercosError } from "./errors.ts";
import type { Http, Query } from "./http.ts";

/** Starting point when the caller wants everything. The Mercos documentation uses this value. */
const EPOCH = "2000-01-01T00:00:00";
const LIMITED_HEADER = "MEUSPEDIDOS_LIMITOU_REGISTROS";

export interface ListOptions {
  /** Only records changed after this instant, in the format Mercos returns in `ultima_alteracao`. */
  changedAfter?: string;
  signal?: AbortSignal;
}

/** The little that pagination needs to see in a record, whatever resource it belongs to. */
interface Paginated {
  id?: unknown;
  ultima_alteracao?: unknown;
}

/** The server writes "2024-04-10 15:45:00" and the documentation uses "2024-04-10T15:45:00". For comparing only. */
function comparable(timestamp: string): string {
  return timestamp.replace("T", " ");
}

function recordKey(record: Paginated): string {
  return record.id === undefined ? JSON.stringify(record) : `${String(record.id)}|${String(record.ultima_alteracao)}`;
}

/**
 * Walks an incremental Mercos list. The next cursor is an `ultima_alteracao` taken from the page
 * itself, sent back exactly as the server wrote it. The loop ends when the
 * MEUSPEDIDOS_LIMITOU_REGISTROS header stops arriving with a value of 1.
 */
export async function* paginate<T extends object>(
  http: Http,
  path: string,
  options: ListOptions & { filters?: Query } = {},
): AsyncGenerator<T> {
  let cursor = options.changedAfter ?? EPOCH;
  // Records already yielded that the next page brings back, because the cursor steps back.
  let seen = new Set<string>();

  for (;;) {
    const response = await http.request<unknown>("GET", path, {
      query: { ...options.filters, alterado_apos: cursor },
      signal: options.signal,
    });
    if (!Array.isArray(response.data)) {
      throw new MercosError("unexpected_response", `GET ${path} didn't return a list.`, {
        method: "GET",
        path,
        body: response.data,
      });
    }
    const records = response.data as Paginated[];

    for (const record of records) {
      // In an async generator the yield type is Awaited<T>, which the compiler can't reduce for a generic T.
      if (seen.size === 0 || !seen.has(recordKey(record))) yield record as Awaited<T>;
    }

    if (response.headers.get(LIMITED_HEADER) !== "1") return;

    // The two highest distinct instants ahead of the cursor. `raw` goes back to the server as it came.
    const current = comparable(cursor);
    let top: { raw: string; key: string } | undefined;
    let second: { raw: string; key: string } | undefined;
    for (const { ultima_alteracao: raw } of records) {
      if (typeof raw !== "string") continue;
      const key = comparable(raw);
      if (key <= current || key === top?.key) continue;
      if (top === undefined || key > top.key) {
        second = top;
        top = { raw, key };
      } else if (second === undefined || key > second.key) {
        second = { raw, key };
      }
    }

    // `ultima_alteracao` has one-second resolution, and a page can end in the middle of a second.
    // So the cursor steps back to the SECOND-highest instant: the next page reads the last second
    // again in full, whether the server treats alterado_apos as ">" or ">=". With a single instant
    // there is nowhere to step back to without risking silent loss or an infinite loop.
    if (second === undefined) {
      throw new MercosError(
        "pagination",
        `GET ${path} reported more records, but the whole page shares one ultima_alteracao ` +
          `("${top?.raw ?? cursor}"). Advancing the cursor from here could lose records silently. ` +
          "If the route accepts registros_por_pagina, try a larger page.",
        { method: "GET", path },
      );
    }
    const { key: nextKey } = second;
    seen = new Set(
      records
        .filter(({ ultima_alteracao: raw }) => typeof raw === "string" && comparable(raw) >= nextKey)
        .map(recordKey),
    );
    cursor = second.raw;
  }
}

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}
