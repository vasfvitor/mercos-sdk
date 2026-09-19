// Recursos sem comportamento próprio: só caminho, tipos e filtros. A lógica está em base.ts.
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
  /** Inclui ou não os clientes excluídos na listagem. */
  excluido?: boolean;
};

export type ClientesResource = CrudResource<Cliente, ClienteInput, ClienteUpdate, ClienteFilters>;
/** `create` e `update` cobrem o produto simples. Produtos de grade têm outro corpo e ainda não são cobertos. */
export type ProdutosResource = CrudResource<Produto, ProdutoInput, ProdutoUpdate, DivisaoFilters>;
export type TabelasPrecoResource = ReadOnlyResource<TabelaPreco, DivisaoFilters>;
export type ProdutosTabelaPrecoResource = ReadOnlyResource<ProdutoTabelaPreco, DivisaoFilters>;
export type CondicoesPagamentoResource = ReadOnlyResource<CondicaoPagamento, DivisaoFilters>;
export type TransportadorasResource = ReadOnlyResource<Transportadora>;
export type UsuariosResource = ReadOnlyResource<Usuario>;
