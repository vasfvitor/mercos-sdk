import type { Http } from "../http.ts";
import type { Transportadora } from "../types.ts";
import { get, type ListWithFilters, list, type NoFilters } from "./base.ts";

const PATH = "/v1/transportadoras";

export interface TransportadorasResource {
  list(options?: ListWithFilters<NoFilters>): AsyncGenerator<Transportadora>;
  get(id: number, signal?: AbortSignal): Promise<Transportadora>;
}

export function transportadoras(http: Http): TransportadorasResource {
  return {
    list: (options) => list<Transportadora, NoFilters>(http, PATH, options),
    get: (id, signal) => get<Transportadora>(http, PATH, id, signal),
  };
}
