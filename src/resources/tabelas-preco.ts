import type { Http } from "../http.ts";
import type { TabelaPreco } from "../types.ts";
import { type DivisaoFilters, get, type ListWithFilters, list } from "./base.ts";

const PATH = "/v1/tabelas_preco";

export interface TabelasPrecoResource {
  list(options?: ListWithFilters<DivisaoFilters>): AsyncGenerator<TabelaPreco>;
  get(id: number, signal?: AbortSignal): Promise<TabelaPreco>;
}

export function tabelasPreco(http: Http): TabelasPrecoResource {
  return {
    list: (options) => list<TabelaPreco, DivisaoFilters>(http, PATH, options),
    get: (id, signal) => get<TabelaPreco>(http, PATH, id, signal),
  };
}
