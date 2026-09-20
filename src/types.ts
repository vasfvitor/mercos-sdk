// Readable names for the generated types. The data shapes come from src/generated. This file only
// picks which operation each type comes from, because the documentation describes the same record
// several times and not every description is complete.
import type { operations } from "./generated/mercos.ts";

type Operation = keyof operations;

type Ok<O extends Operation> = operations[O] extends {
  responses: { 200: { content: { "application/json": infer Body } } };
}
  ? Body
  : never;

type Input<O extends Operation> = operations[O] extends {
  requestBody?: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

type Listed<O extends Operation> = Ok<O> extends readonly (infer Record)[] ? Record : never;

// Neither order schema is whole: the read by ID leaves out the customer fields, and the list leaves
// out `itens`. The sandbox sent the same 47 fields from both routes on 2026-09-20.
type PedidoById = Ok<"get_v2_pedidos_id">;
export type Pedido = PedidoById & Omit<Listed<"get_v2_pedidos">, keyof PedidoById>;
export type PedidoItem = NonNullable<Pedido["itens"]>[number];
export type PedidoInput = Input<"post_v2_pedidos">;
export type PedidoItemInput = NonNullable<PedidoInput["itens"]>[number];
export type PedidoUpdate = Input<"put_v2_pedidos_id">;

export type Cliente = Listed<"get_v1_clientes">;
export type ClienteInput = Input<"post_v1_clientes">;
export type ClienteUpdate = Input<"put_v1_clientes_id">;

export type Produto = Listed<"get_v1_produtos">;
export type ProdutoInput = Input<"post_v1_produtos">;
export type ProdutoUpdate = Input<"put_v1_produtos_id">;

export type TabelaPreco = Listed<"get_v1_tabelas_preco">;
export type ProdutoTabelaPreco = Listed<"get_v1_produtos_tabela_preco">;
export type CondicaoPagamento = Listed<"get_v1_condicoes_pagamento">;
export type Transportadora = Listed<"get_v1_transportadoras">;
export type Usuario = Listed<"get_v1_usuarios">;

export type Categoria = Listed<"get_v1_categorias">;
export type CategoriaInput = Input<"post_v1_categorias">;
export type CategoriaUpdate = Input<"put_v1_categorias_id">;

export type FormaPagamento = Listed<"get_v1_formas_pagamento">;
export type FormaPagamentoInput = Input<"post_v1_formas_pagamento">;
export type FormaPagamentoUpdate = Input<"put_v1_formas_pagamento_id">;

export type StatusCustom = Listed<"get_v1_pedidos_status">;
export type StatusCustomInput = Input<"post_v1_pedidos_status">;
export type StatusCustomUpdate = Input<"put_v1_pedidos_status_id">;

export type AjusteEstoque = Input<"put_v1_ajustar_estoque">;
