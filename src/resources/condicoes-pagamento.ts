import type { Http } from "../http.ts";
import type { CondicaoPagamento } from "../types.ts";
import { type DivisaoFilters, get, type ListWithFilters, list } from "./base.ts";

const PATH = "/v1/condicoes_pagamento";

export interface CondicoesPagamentoResource {
  list(options?: ListWithFilters<DivisaoFilters>): AsyncGenerator<CondicaoPagamento>;
  get(id: number, signal?: AbortSignal): Promise<CondicaoPagamento>;
}

export function condicoesPagamento(http: Http): CondicoesPagamentoResource {
  return {
    list: (options) => list<CondicaoPagamento, DivisaoFilters>(http, PATH, options),
    get: (id, signal) => get<CondicaoPagamento>(http, PATH, id, signal),
  };
}
