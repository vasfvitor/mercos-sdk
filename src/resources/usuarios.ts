import type { Http } from "../http.ts";
import type { Usuario } from "../types.ts";
import { get, type ListWithFilters, list, type NoFilters } from "./base.ts";

const PATH = "/v1/usuarios";

export interface UsuariosResource {
  list(options?: ListWithFilters<NoFilters>): AsyncGenerator<Usuario>;
  get(id: number, signal?: AbortSignal): Promise<Usuario>;
}

export function usuarios(http: Http): UsuariosResource {
  return {
    list: (options) => list<Usuario, NoFilters>(http, PATH, options),
    get: (id, signal) => get<Usuario>(http, PATH, id, signal),
  };
}
