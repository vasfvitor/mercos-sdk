// Readable names for the generated types. The data shapes come from src/generated, through the
// path-based helpers of generic.ts. This file only picks which route each type comes from.
import type { BodyOf, DataOf, InputOf, ItemOf, OperationOf, UpdateOf } from "./generic.ts";

// Neither order schema is whole: the read by ID leaves out the customer fields, and the list leaves
// out `itens`. The sandbox sent the same 47 fields from both routes on 2026-09-20.
type PedidoById = DataOf<OperationOf<"/v2/pedidos/{id}", "get">>;
export type Pedido = PedidoById & Omit<ItemOf<"/v2/pedidos">, keyof PedidoById>;
export type PedidoItem = NonNullable<Pedido["itens"]>[number];
export type PedidoInput = InputOf<"/v2/pedidos">;
export type PedidoItemInput = NonNullable<PedidoInput["itens"]>[number];
export type PedidoUpdate = UpdateOf<"/v2/pedidos">;

export type Cliente = ItemOf<"/v1/clientes">;
export type ClienteInput = InputOf<"/v1/clientes">;
export type ClienteUpdate = UpdateOf<"/v1/clientes">;

export type Produto = ItemOf<"/v1/produtos">;
export type ProdutoInput = InputOf<"/v1/produtos">;
export type ProdutoUpdate = UpdateOf<"/v1/produtos">;

export type TabelaPreco = ItemOf<"/v1/tabelas_preco">;
export type ProdutoTabelaPreco = ItemOf<"/v1/produtos_tabela_preco">;
export type CondicaoPagamento = ItemOf<"/v1/condicoes_pagamento">;
export type Transportadora = ItemOf<"/v1/transportadoras">;
export type Usuario = ItemOf<"/v1/usuarios">;

export type Categoria = ItemOf<"/v1/categorias">;
export type CategoriaInput = InputOf<"/v1/categorias">;
export type CategoriaUpdate = UpdateOf<"/v1/categorias">;

export type FormaPagamento = ItemOf<"/v1/formas_pagamento">;
export type FormaPagamentoInput = InputOf<"/v1/formas_pagamento">;
export type FormaPagamentoUpdate = UpdateOf<"/v1/formas_pagamento">;

export type StatusCustom = ItemOf<"/v1/pedidos/status">;
export type StatusCustomInput = InputOf<"/v1/pedidos/status">;
export type StatusCustomUpdate = UpdateOf<"/v1/pedidos/status">;

export type AjusteEstoque = BodyOf<OperationOf<"/v1/ajustar_estoque", "put">>;
