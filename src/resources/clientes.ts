import type { Http } from "../http.ts";
import type { Cliente, ClienteInput, ClienteUpdate } from "../types.ts";
import { type Created, create, get, type ListWithFilters, list, update } from "./base.ts";

const PATH = "/v1/clientes";

export type ClienteFilters = {
  /** Inclui ou não os clientes excluídos na listagem. */
  excluido?: boolean;
};

export interface ClientesResource {
  list(options?: ListWithFilters<ClienteFilters>): AsyncGenerator<Cliente>;
  get(id: number, signal?: AbortSignal): Promise<Cliente>;
  create(cliente: ClienteInput, signal?: AbortSignal): Promise<Created>;
  update(id: number, cliente: ClienteUpdate, signal?: AbortSignal): Promise<void>;
}

export function clientes(http: Http): ClientesResource {
  return {
    list: (options) => list<Cliente, ClienteFilters>(http, PATH, options),
    get: (id, signal) => get<Cliente>(http, PATH, id, signal),
    create: (cliente, signal) => create(http, PATH, cliente, signal),
    update: (id, cliente, signal) => update(http, PATH, id, cliente, signal),
  };
}
