import { errorFromResponse, looksLikeHtml, MercosError, WRONG_HOST_HINT } from "./errors.ts";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number, signal?: AbortSignal) => Promise<void>;
type QueryValue = string | number | boolean | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

interface HttpConfig {
  baseUrl: string;
  production: boolean;
  applicationToken: string;
  companyToken: string;
  fetch: FetchLike;
  sleep: SleepLike;
  /** Quantas vezes repetir a mesma requisição depois de um 429. */
  maxRetries: number;
  /** Espera máxima, em segundos, aceita para um único 429. Acima disso o erro vai para quem chamou. */
  maxWaitSeconds: number;
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Leitura por ID: em produção o Mercos bloqueia, e o erro ganha uma dica a respeito. */
  readById?: boolean;
}

export interface MercosResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

export interface Http {
  request<T>(method: string, path: string, options?: RequestOptions): Promise<MercosResponse<T>>;
}

/** Folga somada ao tempo que o Mercos pede, para não reenviar em cima do limite. */
const RETRY_PADDING_SECONDS = 0.5;
const FALLBACK_WAIT_SECONDS = 5;

export const defaultSleep: SleepLike = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function buildUrl(baseUrl: string, path: string, query: Query | undefined): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      params.append(name, String(value));
    else for (const item of value) params.append(name, String(item));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ""}`;
}

const noop = () => undefined;

/** Rejeita com o motivo do abort assim que ele acontece, sem deixar listener para trás. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Corpo vazio vira undefined; texto que não é JSON fica como texto (o 401 do Mercos é assim). */
function parseBody(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function waitSeconds(body: unknown, headers: Headers): number {
  const reported = (body as { tempo_ate_permitir_novamente?: unknown } | undefined)?.tempo_ate_permitir_novamente;
  const raw = reported ?? headers.get("Retry-After");
  // Number(null) e Number("") dão 0, o que viraria reenvio imediato. Ausência cai na espera de reserva.
  if (raw === null || raw === "") return FALLBACK_WAIT_SECONDS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : FALLBACK_WAIT_SECONDS;
}

export function createHttp(config: HttpConfig): Http {
  // Se a API ecoar um token no corpo, ele não pode chegar a mensagens de erro nem a logs.
  const secrets = [config.applicationToken, config.companyToken];
  const redact = (text: string) => secrets.reduce((result, token) => result.replaceAll(token, "***"), text);

  // O limite do Mercos é global, então requisições paralelas só rendem mais 429.
  // Cada chamada entra no fim desta cadeia e a espera do 429 acontece com a fila parada.
  // Quem aborta enquanto espera sai da fila na hora, sem gastar requisição. A vez seguinte ainda
  // espera a anterior terminar, e `tail` não guarda a resposta de ninguém.
  let tail: Promise<void> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    const previous = tail;
    const result = abortable(previous, signal).then(task);
    const settled = result.then(noop, noop);
    tail = previous.then(() => settled);
    return result;
  }

  async function send<T>(method: string, path: string, options: RequestOptions): Promise<MercosResponse<T>> {
    const url = buildUrl(config.baseUrl, path, options.query);
    const init: RequestInit = {
      method,
      headers: {
        Accept: "application/json",
        ApplicationToken: config.applicationToken,
        CompanyToken: config.companyToken,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      // JSON.stringify(undefined) já é undefined, então requisição sem corpo continua sem corpo.
      body: JSON.stringify(options.body),
      signal: options.signal,
    };

    for (let retries = 0; ; retries++) {
      let response: Response;
      let text: string;
      try {
        response = await config.fetch(url, init);
        text = redact(await response.text());
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        throw new MercosError("network", `Falha de rede em ${method} ${path}.`, { method, path, cause });
      }

      const body = parseBody(text);

      if (response.status === 429) {
        const seconds = waitSeconds(body, response.headers);
        if (retries < config.maxRetries && seconds <= config.maxWaitSeconds) {
          await config.sleep((seconds + RETRY_PADDING_SECONDS) * 1000, options.signal);
          continue;
        }
      }

      if (!response.ok) {
        throw errorFromResponse({
          status: response.status,
          method,
          path,
          text,
          body,
          readByIdInProduction: config.production && options.readById === true,
          ...(response.status === 429 ? { retryAfterSeconds: waitSeconds(body, response.headers) } : {}),
          limits: { maxRetries: config.maxRetries, maxWaitSeconds: config.maxWaitSeconds },
        });
      }
      if (looksLikeHtml(text)) {
        throw new MercosError("unexpected_response", `Resposta em HTML em ${method} ${path}.`, {
          status: response.status,
          method,
          path,
          hint: WRONG_HOST_HINT,
        });
      }
      return { status: response.status, headers: response.headers, data: body as T };
    }
  }

  return {
    request: (method, path, options = {}) => serialize(() => send(method, path, options), options.signal),
  };
}
