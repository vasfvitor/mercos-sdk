import type { StatusFaturamento, StatusPedido } from "../enums.ts";
import type { CallOptions, Http } from "../http.ts";
import type { Pedido, PedidoInput, PedidoUpdate } from "../types.ts";
import { type CrudResource, crud, post } from "./base.ts";
import { PATHS } from "./paths.ts";

export type PedidoFilters = {
  status?: StatusPedido;
  status_faturamento?: StatusFaturamento;
  /** Accepts several values. Use 0 for orders with no custom status. */
  status_custom?: readonly (string | number)[];
  divisao_id?: number;
  /** For accounts with no divisions, in place of `divisao_id`. */
  representada_id?: number;
  registros_por_pagina?: number;
};

export interface PedidoCreated {
  id: number;
  numero: number | undefined;
  /** Item IDs, in the same order the items were sent. */
  itens: { id: number }[];
}

export interface PedidosResource
  extends Omit<CrudResource<Pedido, PedidoInput, PedidoUpdate, PedidoFilters>, "create"> {
  create(pedido: PedidoInput, options?: CallOptions): Promise<PedidoCreated>;
  cancel(id: number, options?: CallOptions): Promise<void>;
}

export function pedidos(http: Http): PedidosResource {
  return {
    ...crud<Pedido, PedidoInput, PedidoUpdate, PedidoFilters>(http, PATHS.pedidos),
    async create(pedido, options) {
      const { id, data } = await post<{ numero?: number; itens?: { id: number }[] }>(
        http,
        PATHS.pedidos,
        pedido,
        options,
      );
      return { id, numero: data?.numero, itens: data?.itens ?? [] };
    },
    async cancel(id, options) {
      await http.request<unknown>("POST", `${PATHS.cancelarPedido}/${id}`, options);
    },
  };
}
