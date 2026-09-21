import type { StatusFaturamento, StatusPedido } from "../enums.ts";
import { MercosError, type MercosErrorKind } from "../errors.ts";
import type { CallOptions, Http } from "../http.ts";
import type { Pedido, PedidoInput, PedidoUpdate } from "../types.ts";
import { type CrudResource, crud, type DivisaoFilters, post } from "./base.ts";
import { PATHS } from "./paths.ts";

export type PedidoFilters = DivisaoFilters & {
  status?: StatusPedido;
  status_faturamento?: StatusFaturamento;
  /** Accepts several values. Use 0 for orders with no custom status. */
  status_custom?: readonly (string | number)[];
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
  /**
   * Creates the order and reads it back through the list. The response to the create has no total,
   * and Mercos adds taxes that the sent items don't show. When the order is created and the read
   * fails, the error has the order's ID in `createdId`.
   */
  createAndRead(pedido: PedidoInput, options?: CallOptions): Promise<Pedido>;
  cancel(id: number, options?: CallOptions): Promise<void>;
}

export function pedidos(http: Http): PedidosResource {
  const base = crud<Pedido, PedidoInput, PedidoUpdate, PedidoFilters>(http, PATHS.pedidos);
  return {
    ...base,
    async createAndRead(pedido, options) {
      // The hour of slack covers a caller's clock that runs ahead of the one at Mercos.
      const since = new Date(Date.now() - 3_600_000);
      // `post` and not `this.create`: a method taken off the resource has no `this`.
      const { id } = await post(http, PATHS.pedidos, pedido, options);
      const failed = (kind: MercosErrorKind, reason: string, cause?: unknown) =>
        new MercosError(kind, `Order ${id} was created, but ${reason}. Don't create it again: read it with find.`, {
          method: "GET",
          path: PATHS.pedidos,
          createdId: id,
          cause,
        });
      let read: Pedido | undefined;
      try {
        read = await base.find(id, { ...options, since });
      } catch (cause) {
        throw failed(cause instanceof MercosError ? cause.kind : "network", "reading it back failed", cause);
      }
      if (read === undefined) throw failed("unexpected_response", "the list of the last hour doesn't have it");
      return read;
    },
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
