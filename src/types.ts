// Nomes legíveis para os tipos gerados. A forma dos dados vem de src/generated; aqui só se escolhe
// de qual operação cada tipo sai, porque a documentação descreve o mesmo registro várias vezes
// e nem todas as descrições são completas.
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

/** Todo registro listado tem `id` e `ultima_alteracao`, mesmo quando o esquema da página esquece de dizer. */
type Registro<T> = Item<T> & { id: number; ultima_alteracao: string };

// O esquema da listagem de pedidos não traz `itens`; o da leitura por ID descreve o registro inteiro.
export type Pedido = Registro<Ok<"get_v2_pedidos_id">>;
export type PedidoItem = NonNullable<Pedido["itens"]>[number];
export type PedidoInput = Input<"post_v2_pedidos">;
export type PedidoItemInput = NonNullable<PedidoInput["itens"]>[number];
export type PedidoUpdate = Input<"put_v2_pedidos_id">;

export type Cliente = Registro<Ok<"get_v1_clientes">>;
export type ClienteInput = Input<"post_v1_clientes">;
export type ClienteUpdate = Input<"put_v1_clientes_id">;

export type Produto = Registro<Ok<"get_v1_produtos">>;
export type ProdutoInput = Input<"post_v1_produtos">;
export type ProdutoUpdate = Input<"put_v1_produtos_id">;

export type TabelaPreco = Registro<Ok<"get_v1_tabelas_preco">>;
export type ProdutoTabelaPreco = Registro<Ok<"get_v1_produtos_tabela_preco">>;
export type CondicaoPagamento = Registro<Ok<"get_v1_condicoes_pagamento">>;
export type Transportadora = Registro<Ok<"get_v1_transportadoras">>;
export type Usuario = Registro<Ok<"get_v1_usuarios">>;
