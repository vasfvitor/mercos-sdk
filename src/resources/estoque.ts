import type { CallOptions, Http } from "../http.ts";
import type { AjusteEstoque } from "../types.ts";
import { PATHS } from "./paths.ts";

export interface EstoqueResource {
  /** Sets the balance: after the call, the product's stock equals `novo_saldo`. */
  adjust(ajuste: AjusteEstoque, options?: CallOptions): Promise<void>;
  /** Returns the adjustments as the API echoes them. */
  adjustMany(ajustes: readonly AjusteEstoque[], options?: CallOptions): Promise<AjusteEstoque[]>;
}

export function estoque(http: Http): EstoqueResource {
  return {
    async adjust(ajuste, options) {
      await http.request<unknown>("PUT", PATHS.ajustarEstoque, { body: ajuste, ...options });
    },
    adjustMany: async (ajustes, options) =>
      (await http.request<AjusteEstoque[]>("POST", PATHS.ajustarEstoqueEmLote, { body: ajustes, ...options })).data,
  };
}
