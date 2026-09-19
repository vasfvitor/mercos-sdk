import { errorFromResponse, looksLikeHtml, MercosError, WRONG_HOST_HINT } from "./errors.ts";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number, signal?: AbortSignal) => Promise<void>;
export type QueryValue = string | number | boolean | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface HttpConfig {
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
  const secrets = [config.applicationToken, config.companyToken].filter((token) => token !== "");
  const redact = (text: string) => secrets.reduce((result, token) => result.replaceAll(token, "***"), text);

  // O limite do Mercos é global, então requisições paralelas só rendem mais 429.
  // Cada chamada entra no fim desta cadeia e a espera do 429 acontece com a fila parada.
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
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
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal ?? null,
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
        const reason =
          seconds > config.maxWaitSeconds
            ? `O Mercos pediu ${seconds}s de espera, acima do teto de ${config.maxWaitSeconds}s.`
            : `Limite de ${config.maxRetries} repetições esgotado.`;
        throw new MercosError("rate_limit", `Mercos respondeu 429 em ${method} ${path}. ${reason}`, {
          status: 429,
          method,
          path,
          retryAfterSeconds: seconds,
          body,
        });
      }

      if (!response.ok) {
        throw errorFromResponse({
          status: response.status,
          method,
          path,
          text,
          body,
          production: config.production,
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
    request<T>(method: string, path: string, options: RequestOptions = {}) {
      const { signal } = options;
      const queued = serialize(() => {
        // Quem desistiu enquanto esperava na fila não chega a gastar uma requisição.
        if (signal?.aborted) throw signal.reason;
        return send<T>(method, path, options);
      });
      if (!signal) return queued;
      // A fila pode ficar minutos parada num 429 de outra chamada. O abort não espera a vez.
      return new Promise<MercosResponse<T>>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
        queued.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
      });
    },
  };
}
