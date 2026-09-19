import type { Http } from "../http.ts";
import type { ProdutoTabelaPreco } from "../types.ts";
import { type DivisaoFilters, get, type ListWithFilters, list } from "./base.ts";

const PATH = "/v1/produtos_tabela_preco";

export interface ProdutosTabelaPrecoResource {
  list(options?: ListWithFilters<DivisaoFilters>): AsyncGenerator<ProdutoTabelaPreco>;
  get(id: number, signal?: AbortSignal): Promise<ProdutoTabelaPreco>;
}

export function produtosTabelaPreco(http: Http): ProdutosTabelaPrecoResource {
  return {
    list: (options) => list<ProdutoTabelaPreco, DivisaoFilters>(http, PATH, options),
    get: (id, signal) => get<ProdutoTabelaPreco>(http, PATH, id, signal),
  };
}
