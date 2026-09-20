import type { StatusFaturamento, StatusPedido } from "../enums.ts";
import { MercosError } from "../errors.ts";
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
   * and Mercos adds taxes that the sent items don't show.
   */
  createAndRead(pedido: PedidoInput, options?: CallOptions): Promise<Pedido>;
  cancel(id: number, options?: CallOptions): Promise<void>;
}

/** Mercos keeps `ultima_alteracao` in Brazilian time. The hour of slack covers a caller's clock that runs ahead. */
function anHourAgoInBrazil(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(Date.now() - 3_600_000);
  const part = (type: string) => parts.find((each) => each.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

export function pedidos(http: Http): PedidosResource {
  const base = crud<Pedido, PedidoInput, PedidoUpdate, PedidoFilters>(http, PATHS.pedidos);
  return {
    ...base,
    async createAndRead(pedido, options) {
      const since = anHourAgoInBrazil();
      // `post` and not `this.create`: a method taken off the resource has no `this`.
      const { id } = await post(http, PATHS.pedidos, pedido, options);
      const read = await base.find(id, { ...options, since });
      if (read === undefined) {
        throw new MercosError(
          "unexpected_response",
          `Order ${id} was created, but the list of orders changed after ${since} doesn't have it. Don't create it again.`,
          { method: "GET", path: PATHS.pedidos },
        );
      }
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
