import type { Http } from "../http.ts";
import type { Produto, ProdutoInput, ProdutoUpdate } from "../types.ts";
import { type Created, create, type DivisaoFilters, get, type ListWithFilters, list, update } from "./base.ts";

const PATH = "/v1/produtos";

export interface ProdutosResource {
  list(options?: ListWithFilters<DivisaoFilters>): AsyncGenerator<Produto>;
  get(id: number, signal?: AbortSignal): Promise<Produto>;
  /** Produto simples. Produtos de grade têm outro corpo e ainda não são cobertos. */
  create(produto: ProdutoInput, signal?: AbortSignal): Promise<Created>;
  update(id: number, produto: ProdutoUpdate, signal?: AbortSignal): Promise<void>;
}

export function produtos(http: Http): ProdutosResource {
  return {
    list: (options) => list<Produto, DivisaoFilters>(http, PATH, options),
    get: (id, signal) => get<Produto>(http, PATH, id, signal),
    create: (produto, signal) => create(http, PATH, produto, signal),
    update: (id, produto, signal) => update(http, PATH, id, produto, signal),
  };
}
