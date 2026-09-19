// Readable names for the generated types. The data shapes come from src/generated. This file only
// picks which operation each type comes from, because the documentation describes the same record
// several times and not every description is complete.
import type { operations } from "./generated/mercos.ts";

type Operation = keyof operations;
type Item<T> = T extends readonly (infer U)[] ? U : T;

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

/** Every listed record has `id` and `ultima_alteracao`, even when the page's schema forgets to say so. */
type Listed<T> = Item<T> & { id: number; ultima_alteracao: string };

// The order list schema has no `itens`; the read-by-ID schema describes the whole record.
export type Pedido = Listed<Ok<"get_v2_pedidos_id">>;
export type PedidoItem = NonNullable<Pedido["itens"]>[number];
export type PedidoInput = Input<"post_v2_pedidos">;
export type PedidoItemInput = NonNullable<PedidoInput["itens"]>[number];
export type PedidoUpdate = Input<"put_v2_pedidos_id">;

export type Cliente = Listed<Ok<"get_v1_clientes">>;
export type ClienteInput = Input<"post_v1_clientes">;
export type ClienteUpdate = Input<"put_v1_clientes_id">;

export type Produto = Listed<Ok<"get_v1_produtos">>;
export type ProdutoInput = Input<"post_v1_produtos">;
export type ProdutoUpdate = Input<"put_v1_produtos_id">;

export type TabelaPreco = Listed<Ok<"get_v1_tabelas_preco">>;
export type ProdutoTabelaPreco = Listed<Ok<"get_v1_produtos_tabela_preco">>;
export type CondicaoPagamento = Listed<Ok<"get_v1_condicoes_pagamento">>;
export type Transportadora = Listed<Ok<"get_v1_transportadoras">>;
export type Usuario = Listed<Ok<"get_v1_usuarios">>;
