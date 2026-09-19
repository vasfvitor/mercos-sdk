import type { StatusFaturamento, StatusPedido } from "../enums.ts";
import type { Http } from "../http.ts";
import type { Pedido, PedidoInput, PedidoUpdate } from "../types.ts";
import { type CrudResource, crud, post } from "./base.ts";
import { PATHS } from "./paths.ts";

export type PedidoFilters = {
  status?: StatusPedido;
  status_faturamento?: StatusFaturamento;
  /** Aceita vários valores. Use 0 para pedidos sem status customizado. */
  status_custom?: readonly (string | number)[];
  divisao_id?: number;
  registros_por_pagina?: number;
};

export interface PedidoCreated {
  id: number;
  numero: number | undefined;
  /** IDs dos itens, na mesma ordem em que foram enviados. */
  itens: { id: number }[];
}

export interface PedidosResource
  extends Omit<CrudResource<Pedido, PedidoInput, PedidoUpdate, PedidoFilters>, "create"> {
  create(pedido: PedidoInput, signal?: AbortSignal): Promise<PedidoCreated>;
  cancel(id: number, signal?: AbortSignal): Promise<void>;
}

export function pedidos(http: Http): PedidosResource {
  return {
    ...crud<Pedido, PedidoInput, PedidoUpdate, PedidoFilters>(http, PATHS.pedidos),
    async create(pedido, signal) {
      const { id, data } = await post<{ numero?: number; itens?: { id: number }[] }>(
        http,
        PATHS.pedidos,
        pedido,
        signal,
      );
      return { id, numero: data?.numero, itens: data?.itens ?? [] };
    },
    async cancel(id, signal) {
      await http.request<unknown>("POST", `${PATHS.cancelarPedido}/${id}`, { signal });
    },
  };
}
