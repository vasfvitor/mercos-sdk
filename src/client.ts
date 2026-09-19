import { MercosError } from "./errors.ts";
import { createHttp, defaultSleep, type FetchLike, type SleepLike } from "./http.ts";
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
  /** Padrão: "sandbox". Produção só depois da homologação com o Mercos. */
  environment?: MercosEnvironment;
  /** Substitui o `fetch` global. Útil em testes e para instrumentação. */
  fetch?: FetchLike;
  /** Substitui a espera entre repetições. Testes passam um relógio falso. */
  sleep?: SleepLike;
  /** Repetições da mesma requisição depois de um 429. Padrão: 5. */
  maxRetries?: number;
  /** Espera máxima, em segundos, aceita para um único 429. Padrão: 60. */
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
  /** Confere se o par de tokens é aceito pelo ambiente escolhido. */
  tokenStatus(signal?: AbortSignal): Promise<unknown>;
}

export function createMercos(options: MercosOptions): Mercos {
  // jsdom e happy-dom definem `document` dentro do Node, em suítes de teste de backend. Isso não é navegador.
  const onNode =
    typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string";
  if ("document" in globalThis && !onNode) {
    throw new MercosError(
      "config",
      "O SDK do Mercos roda só no servidor: a API recusa o preflight do navegador e os tokens ficariam expostos.",
    );
  }
  // Token lido de arquivo de segredo costuma vir com quebra de linha no fim, que o fetch recusa como header.
  const token = (name: "applicationToken" | "companyToken") => {
    const value = (options as Partial<MercosOptions> | undefined)?.[name];
    if (typeof value !== "string" || value.trim() === "")
      throw new MercosError("config", `Opção obrigatória ausente: ${name}.`);
    return value.trim();
  };
  const applicationToken = token("applicationToken");
  const companyToken = token("companyToken");
  const environment = options.environment ?? "sandbox";
  if (!Object.hasOwn(BASE_URLS, environment))
    throw new MercosError("config", `Ambiente desconhecido: ${String(environment)}.`);

  const http = createHttp({
    baseUrl: BASE_URLS[environment],
    production: environment === "production",
    applicationToken,
    companyToken,
    // Sem o arrow, `fetch` perde o `this` em Workers e lança "Illegal invocation".
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
    tokenStatus: async (signal) => (await http.request<unknown>("GET", PATHS.tokenStatus, { signal })).data,
  };
}
