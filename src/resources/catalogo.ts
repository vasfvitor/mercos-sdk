// Resources with no behavior of their own: only a path, types, and filters. The logic lives in base.ts.
import type {
  Cliente,
  ClienteInput,
  ClienteUpdate,
  CondicaoPagamento,
  Produto,
  ProdutoInput,
  ProdutoTabelaPreco,
  ProdutoUpdate,
  TabelaPreco,
  Transportadora,
  Usuario,
} from "../types.ts";
import type { CrudResource, DivisaoFilters, ReadOnlyResource } from "./base.ts";

export type ClienteFilters = {
  /** Whether the list includes deleted customers. */
  excluido?: boolean;
};

export type ClientesResource = CrudResource<Cliente, ClienteInput, ClienteUpdate, ClienteFilters>;
/** `create` and `update` take a plain product or a grid one: both bodies share the route. */
export type ProdutosResource = CrudResource<Produto, ProdutoInput, ProdutoUpdate, DivisaoFilters>;
export type TabelasPrecoResource = ReadOnlyResource<TabelaPreco, DivisaoFilters>;
export type ProdutosTabelaPrecoResource = ReadOnlyResource<ProdutoTabelaPreco, DivisaoFilters>;
export type CondicoesPagamentoResource = ReadOnlyResource<CondicaoPagamento, DivisaoFilters>;
export type TransportadorasResource = ReadOnlyResource<Transportadora>;
export type UsuariosResource = ReadOnlyResource<Usuario>;
