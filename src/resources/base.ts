import { MercosError } from "../errors.ts";
import type { CallOptions, Http, MercosResponse, Query } from "../http.ts";
import { type ListOptions, paginate } from "../paginate.ts";

export interface ListWithFilters<Filters extends Query> extends ListOptions {
  /** Route filters, spelled exactly as the Mercos documentation names them. */
  filters?: Filters;
}

export type DivisaoFilters = {
  /** Only for manufacturer accounts with divisions. Without it, records from every division come back. */
  divisao_id?: number;
};

export interface Created {
  id: number;
}

/** Without `Filters`, the list accepts only the common options. */
export interface ReadOnlyResource<T, Filters extends Query = never> {
  list(options?: [Filters] extends [never] ? ListOptions : ListWithFilters<Filters>): AsyncGenerator<T>;
  /** Read by ID. Mercos allows it only in the sandbox; in production the error carries a hint. */
  get(id: number, options?: CallOptions): Promise<T>;
}

export interface CrudResource<T, Input, Update, Filters extends Query = never> extends ReadOnlyResource<T, Filters> {
  create(body: Input, options?: CallOptions): Promise<Created>;
  update(id: number, body: Update, options?: CallOptions): Promise<void>;
}

/** The ID of a created record comes in the MeusPedidosID header. The body is only a fallback. */
export function findCreatedId(response: MercosResponse<unknown>): number | undefined {
  const candidates = [response.headers.get("MeusPedidosID"), (response.data as { id?: unknown } | undefined)?.id];
  return candidates.map((value) => Number(value || Number.NaN)).find((value) => Number.isInteger(value) && value > 0);
}

function createdId(response: MercosResponse<unknown>, path: string): number {
  const id = findCreatedId(response);
  if (id === undefined) {
    throw new MercosError(
      "unexpected_response",
      `POST ${path} returned no ID, neither in the MeusPedidosID header nor in the body.`,
      {
        status: response.status,
        method: "POST",
        path,
        body: response.data,
      },
    );
  }
  return id;
}

/** Returns the body next to the ID, for callers that need more than the ID. */
export async function post<Data>(http: Http, path: string, body: unknown, options?: CallOptions) {
  const response = await http.request<Data | undefined>("POST", path, { body, ...options });
  return { id: createdId(response, path), data: response.data };
}

export function readOnly<T extends object, Filters extends Query = never>(
  http: Http,
  path: string,
): ReadOnlyResource<T, Filters> {
  return {
    list: (options) => paginate<T>(http, path, options),
    get: async (id, options) => (await http.request<T>("GET", `${path}/${id}`, { ...options, readById: true })).data,
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
