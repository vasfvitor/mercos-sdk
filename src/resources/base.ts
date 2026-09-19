import { MercosError } from "../errors.ts";
import type { Http, MercosResponse, Query } from "../http.ts";
import { type ListOptions, paginate } from "../paginate.ts";

export interface ListWithFilters<Filters extends Query> extends ListOptions {
  /** Filtros da rota, com os mesmos nomes da documentação do Mercos. */
  filtros?: Filters;
}

export interface Created {
  id: number;
}

/** O ID de um registro criado vem no header MeusPedidosID. O corpo só serve de reserva. */
export function createdId(response: MercosResponse<unknown>, path: string): number {
  const candidates = [response.headers.get("MeusPedidosID"), (response.data as { id?: unknown } | undefined)?.id];
  const id = candidates
    .map((value) => Number(value || Number.NaN))
    .find((value) => Number.isInteger(value) && value > 0);
  if (id === undefined) {
    throw new MercosError("unexpected_response", `POST ${path} não devolveu o header MeusPedidosID.`, {
      status: response.status,
      method: "POST",
      path,
      body: response.data,
    });
  }
  return id;
}

export function list<T extends object, Filters extends Query>(
  http: Http,
  path: string,
  options: ListWithFilters<Filters> = {},
): AsyncGenerator<T> {
  return paginate<T>(http, path, options, options.filtros);
}

/** Leitura por ID. O Mercos só libera no sandbox; em produção o erro traz a dica. */
export async function get<T>(http: Http, path: string, id: number, signal?: AbortSignal): Promise<T> {
  const response = await http.request<T>("GET", `${path}/${id}`, { signal });
  return response.data;
}

export async function create(http: Http, path: string, body: unknown, signal?: AbortSignal): Promise<Created> {
  const response = await http.request<unknown>("POST", path, { body, signal });
  return { id: createdId(response, path) };
}

export async function update(http: Http, path: string, id: number, body: unknown, signal?: AbortSignal): Promise<void> {
  await http.request<unknown>("PUT", `${path}/${id}`, { body, signal });
}

export type DivisaoFilters = {
  /** Só para contas de indústria com divisões. Sem o filtro, vêm os registros de todas. */
  divisao_id?: number;
};

export type NoFilters = Record<string, never>;
