import { MercosError } from "../errors.ts";
import type { Http, MercosResponse, Query } from "../http.ts";
import { type ListOptions, paginate } from "../paginate.ts";

export interface ListWithFilters<Filters extends Query> extends ListOptions {
  /** Filtros da rota, com os mesmos nomes da documentação do Mercos. */
  filtros?: Filters;
}

export type DivisaoFilters = {
  /** Só para contas de indústria com divisões. Sem o filtro, vêm os registros de todas. */
  divisao_id?: number;
};

export interface Created {
  id: number;
}

/** Recurso só de leitura. Sem `Filters`, a listagem aceita apenas as opções comuns. */
export interface ReadOnlyResource<T, Filters extends Query = never> {
  list(options?: [Filters] extends [never] ? ListOptions : ListWithFilters<Filters>): AsyncGenerator<T>;
  /** Leitura por ID. O Mercos só libera no sandbox; em produção o erro traz a dica. */
  get(id: number, signal?: AbortSignal): Promise<T>;
}

export interface CrudResource<T, Input, Update, Filters extends Query = never> extends ReadOnlyResource<T, Filters> {
  create(body: Input, signal?: AbortSignal): Promise<Created>;
  update(id: number, body: Update, signal?: AbortSignal): Promise<void>;
}

/** O ID de um registro criado vem no header MeusPedidosID. O corpo só serve de reserva. */
function createdId(response: MercosResponse<unknown>, path: string): number {
  const candidates = [response.headers.get("MeusPedidosID"), (response.data as { id?: unknown } | undefined)?.id];
  const id = candidates
    .map((value) => Number(value || Number.NaN))
    .find((value) => Number.isInteger(value) && value > 0);
  if (id === undefined) {
    throw new MercosError("unexpected_response", `POST ${path} não devolveu o ID em MeusPedidosID nem no corpo.`, {
      status: response.status,
      method: "POST",
      path,
      body: response.data,
    });
  }
  return id;
}

/** POST de criação: devolve o ID e o corpo, para quem precisa de mais do que o ID. */
export async function post<Data>(http: Http, path: string, body: unknown, signal?: AbortSignal) {
  const response = await http.request<Data | undefined>("POST", path, { body, signal });
  return { id: createdId(response, path), data: response.data };
}

export function readOnly<T extends object, Filters extends Query = never>(
  http: Http,
  path: string,
): ReadOnlyResource<T, Filters> {
  return {
    list: (options) => paginate<T>(http, path, options),
    get: async (id, signal) => (await http.request<T>("GET", `${path}/${id}`, { signal, readById: true })).data,
  };
}

export function crud<T extends object, Input, Update, Filters extends Query = never>(
  http: Http,
  path: string,
): CrudResource<T, Input, Update, Filters> {
  return {
    ...readOnly<T, Filters>(http, path),
    create: async (body, signal) => ({ id: (await post(http, path, body, signal)).id }),
    async update(id, body, signal) {
      await http.request<unknown>("PUT", `${path}/${id}`, { body, signal });
    },
  };
}
