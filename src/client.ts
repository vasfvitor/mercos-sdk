import { MercosError } from "./errors.ts";
import { type CallOptions, createHttp, defaultSleep, type FetchLike, type SleepLike } from "./http.ts";
import { crud, readOnly } from "./resources/base.ts";
import type {
  ClientesResource,
  CondicoesPagamentoResource,
  ProdutosResource,
  ProdutosTabelaPrecoResource,
  TabelasPrecoResource,
  TransportadorasResource,
  UsuariosResource,
} from "./resources/catalogo.ts";
import { PATHS } from "./resources/paths.ts";
import { type PedidosResource, pedidos } from "./resources/pedidos.ts";

export type MercosEnvironment = "sandbox" | "production";

export const BASE_URLS: Record<MercosEnvironment, string> = {
  sandbox: "https://sandbox.mercos.com/api",
  production: "https://app.mercos.com/api",
};

export interface MercosOptions {
  applicationToken: string;
  companyToken: string;
  /** Defaults to "sandbox". Production only works after the Mercos approval review. */
  environment?: MercosEnvironment;
  /** Replaces the global `fetch`. Useful for tests and instrumentation. */
  fetch?: FetchLike;
  /** Replaces the wait between retries. Tests pass a fake clock. */
  sleep?: SleepLike;
  /** Retries of the same request after a 429. Defaults to 5. */
  maxRetries?: number;
  /** Longest wait, in seconds, accepted for a single 429. Defaults to 60. */
  maxWaitSeconds?: number;
}

export interface Mercos {
  pedidos: PedidosResource;
  clientes: ClientesResource;
  produtos: ProdutosResource;
  tabelasPreco: TabelasPrecoResource;
  produtosTabelaPreco: ProdutosTabelaPrecoResource;
  condicoesPagamento: CondicoesPagamentoResource;
  transportadoras: TransportadorasResource;
  usuarios: UsuariosResource;
  /** Checks that the chosen environment accepts the token pair. */
  tokenStatus(options?: CallOptions): Promise<unknown>;
}

export function createMercos(options: MercosOptions): Mercos {
  // jsdom and happy-dom define `document` inside Node, in backend test suites. That is not a browser.
  const onNode =
    typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string";
  if ("document" in globalThis && !onNode) {
    throw new MercosError(
      "config",
      "The Mercos SDK is server-side only: the API rejects browser preflight requests, and the tokens would be exposed.",
    );
  }
  // A token read from a secret file often ends with a newline, which fetch rejects as a header value.
  const token = (name: "applicationToken" | "companyToken") => {
    const value = (options as Partial<MercosOptions> | undefined)?.[name];
    if (typeof value !== "string" || value.trim() === "")
      throw new MercosError("config", `Missing required option: ${name}.`);
    return value.trim();
  };
  const applicationToken = token("applicationToken");
  const companyToken = token("companyToken");
  const environment = options.environment ?? "sandbox";
  if (!Object.hasOwn(BASE_URLS, environment))
    throw new MercosError("config", `Unknown environment: ${String(environment)}.`);

  const http = createHttp({
    baseUrl: BASE_URLS[environment],
    production: environment === "production",
    applicationToken,
    companyToken,
    // Without the arrow, `fetch` loses its `this` on Workers and throws "Illegal invocation".
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    sleep: options.sleep ?? defaultSleep,
    maxRetries: options.maxRetries ?? 5,
    maxWaitSeconds: options.maxWaitSeconds ?? 60,
  });

  return {
    pedidos: pedidos(http),
    clientes: crud(http, PATHS.clientes),
    produtos: crud(http, PATHS.produtos),
    tabelasPreco: readOnly(http, PATHS.tabelasPreco),
    produtosTabelaPreco: readOnly(http, PATHS.produtosTabelaPreco),
    condicoesPagamento: readOnly(http, PATHS.condicoesPagamento),
    transportadoras: readOnly(http, PATHS.transportadoras),
    usuarios: readOnly(http, PATHS.usuarios),
    tokenStatus: async (options) =>
      (await http.request<unknown>("GET", PATHS.tokenStatus, { signal: options?.signal })).data,
  };
}
