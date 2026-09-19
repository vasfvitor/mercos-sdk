import type { StatusFaturamento, StatusPedido } from "../enums.ts";
import type { Http } from "../http.ts";
import type { Pedido, PedidoInput, PedidoUpdate } from "../types.ts";
import { createdId, get, type ListWithFilters, list, update } from "./base.ts";

// Pedidos usam a versão 2 da API. A versão 1 está depreciada e só o cancelamento continua nela.
const PATH = "/v2/pedidos";
const CANCEL_PATH = "/v1/pedidos/cancelar";

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

export interface PedidosResource {
  list(options?: ListWithFilters<PedidoFilters>): AsyncGenerator<Pedido>;
  get(id: number, signal?: AbortSignal): Promise<Pedido>;
  create(pedido: PedidoInput, signal?: AbortSignal): Promise<PedidoCreated>;
  update(id: number, pedido: PedidoUpdate, signal?: AbortSignal): Promise<void>;
  cancel(id: number, signal?: AbortSignal): Promise<void>;
}

export function pedidos(http: Http): PedidosResource {
  return {
    list: (options) => list<Pedido, PedidoFilters>(http, PATH, options),
    get: (id, signal) => get<Pedido>(http, PATH, id, signal),
    async create(pedido, signal) {
      const response = await http.request<{ numero?: number; itens?: { id: number }[] } | undefined>("POST", PATH, {
        body: pedido,
        signal,
      });
      return { id: createdId(response, PATH), numero: response.data?.numero, itens: response.data?.itens ?? [] };
    },
    update: (id, pedido, signal) => update(http, PATH, id, pedido, signal),
    async cancel(id, signal) {
      await http.request<unknown>("POST", `${CANCEL_PATH}/${id}`, { signal });
    },
  };
}
