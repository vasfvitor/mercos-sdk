import { MercosError } from "../errors.ts";
import type { CallOptions, Http, MercosResponse, Query } from "../http.ts";
import { type ListOptions, paginate, paginatePages } from "../paginate.ts";

export interface ListWithFilters<Filters extends Query> extends ListOptions {
  /** Route filters, spelled exactly as the Mercos documentation names them. */
  filters?: Filters;
}

export type DivisaoFilters = {
  /** Only for manufacturer accounts with divisions. Without it, records from every division come back. */
  divisao_id?: number;
  /** The same filter for accounts with no divisions. Mercos answers 412 when an account sends the wrong one. */
  representada_id?: number;
};

export interface Created {
  id: number;
}

/** Without `Filters`, the list accepts only the common options. */
export interface FindOptions extends CallOptions {
  /** Where the search starts: the record must have changed after it. It takes what `changedAfter` takes. */
  since: string | Date;
}

type ListArgument<Filters extends Query> = [Filters] extends [never] ? ListOptions : ListWithFilters<Filters>;

export interface ReadOnlyResource<T, Filters extends Query = never> {
  list(options?: ListArgument<Filters>): AsyncGenerator<T>;
  /** The same walk as `list`, one array per request. */
  listPages(options?: ListArgument<Filters>): AsyncGenerator<T[]>;
  /**
   * One record by ID, through the list. It works in production, where Mercos blocks `get`, and it
   * runs the same requests in both environments. It stops at the page that has the record.
   */
  find(id: number, options: FindOptions): Promise<T | undefined>;
  /** Read by ID. Mercos allows it only in the sandbox; in production the error carries a hint. */
  get(id: number, options?: CallOptions): Promise<T>;
}

export interface CrudResource<T, Input, Update, Filters extends Query = never> extends ReadOnlyResource<T, Filters> {
  create(body: Input, options?: CallOptions): Promise<Created>;
  update(id: number, body: Update, options?: CallOptions): Promise<void>;
}

/** The ID of a created record comes in the MeusPedidosID header. The body is only a fallback. */
function findCreatedId(response: MercosResponse<unknown>): number | undefined {
  const candidates = [response.headers.get("MeusPedidosID"), (response.data as { id?: unknown } | undefined)?.id];
  return candidates.map((value) => Number(value || Number.NaN)).find((value) => Number.isInteger(value) && value > 0);
}

/** For routes that may create no single record: the ID is absent when the response carries none. */
export async function tryPost<Data>(http: Http, path: string, body: unknown, options?: CallOptions) {
  const response = await http.request<Data | undefined>("POST", path, { body, ...options });
  return { id: findCreatedId(response), data: response.data, status: response.status };
}

/** Returns the body next to the ID, for callers that need more than the ID. */
export async function post<Data>(http: Http, path: string, body: unknown, options?: CallOptions) {
  const { id, data, status } = await tryPost<Data>(http, path, body, options);
  if (id === undefined) {
    throw new MercosError(
      "unexpected_response",
      `POST ${path} returned no ID, neither in the MeusPedidosID header nor in the body.`,
      { status, method: "POST", path, body: data },
    );
  }
  return { id, data };
}

export function readOnly<T extends object, Filters extends Query = never>(
  http: Http,
  path: string,
): ReadOnlyResource<T, Filters> {
  return {
    list: (options) => paginate<T>(http, path, options),
    listPages: (options) => paginatePages<T>(http, path, options),
    async find(id, { since, ...options }) {
      for await (const record of paginate<T & { id?: unknown }>(http, path, { ...options, changedAfter: since })) {
        if (record.id === id) return record;
      }
      return undefined;
    },
    get: async (id, options) => (await http.request<T>("GET", `${path}/${id}`, options)).data,
  };
}

export function crud<T extends object, Input, Update, Filters extends Query = never>(
  http: Http,
  path: string,
): CrudResource<T, Input, Update, Filters> {
  return {
    ...readOnly<T, Filters>(http, path),
    create: async (body, options) => ({ id: (await post(http, path, body, options)).id }),
    async update(id, body, options) {
      await http.request<unknown>("PUT", `${path}/${id}`, { body, ...options });
    },
  };
}
