import type { CallOptions, Http } from "../http.ts";
import type { Produto, ProdutoInput, ProdutoUpdate } from "../types.ts";
import { type CrudResource, crud, type DivisaoFilters, post } from "./base.ts";
import { PATHS } from "./paths.ts";

export type ProdutoFilters = DivisaoFilters & {
  /** Whether the list includes deleted products. */
  excluido?: boolean;
};

export interface ProdutoCreated {
  /** For a grid product, the ID of the parent. Mercos refuses a stock adjustment on it. */
  id: number;
  /** The children of a grid product, which are the ones that take a stock adjustment. Empty for a plain product. */
  produtos_grade: { id: number; codigo: string }[];
}

/** `create` and `update` take a plain product or a grid one: both bodies share the route. */
export interface ProdutosResource
  extends Omit<CrudResource<Produto, ProdutoInput, ProdutoUpdate, ProdutoFilters>, "create"> {
  create(produto: ProdutoInput, options?: CallOptions): Promise<ProdutoCreated>;
}

export function produtos(http: Http): ProdutosResource {
  return {
    ...crud<Produto, ProdutoInput, ProdutoUpdate, ProdutoFilters>(http, PATHS.produtos),
    async create(produto, options) {
      const { id, data } = await post<{ produtos_grade?: ProdutoCreated["produtos_grade"] }>(
        http,
        PATHS.produtos,
        produto,
        options,
      );
      return { id, produtos_grade: data?.produtos_grade ?? [] };
    },
  };
}
