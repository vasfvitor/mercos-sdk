import { MercosError } from "../errors.ts";
import type { CallOptions, Http } from "../http.ts";
import type { AjusteEstoque } from "../types.ts";
import { PATHS } from "./paths.ts";

const BATCH_LIMIT = 300;

export interface EstoqueResource {
  /** Sets the balance: after the call, the product's stock equals `novo_saldo`. */
  adjust(ajuste: AjusteEstoque, options?: CallOptions): Promise<void>;
  /**
   * Returns the adjustments as the API echoes them. Mercos takes at most 300 per request, and one
   * bad adjustment cancels the whole batch.
   */
  adjustMany(ajustes: readonly AjusteEstoque[], options?: CallOptions): Promise<AjusteEstoque[]>;
}

export function estoque(http: Http): EstoqueResource {
  return {
    async adjust(ajuste, options) {
      await http.request<unknown>("PUT", PATHS.ajustarEstoque, { body: ajuste, ...options });
    },
    async adjustMany(ajustes, options) {
      if (ajustes.length > BATCH_LIMIT) {
        throw new MercosError(
          "config",
          `Mercos takes at most ${BATCH_LIMIT} stock adjustments per request, and this batch has ${ajustes.length}.`,
        );
      }
      return (await http.request<AjusteEstoque[]>("POST", PATHS.ajustarEstoqueEmLote, { body: ajustes, ...options }))
        .data;
    },
  };
}
