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
  /** How many times to retry the same request after a 429. */
  maxRetries: number;
  /** Longest wait, in seconds, accepted for a single 429. Beyond it, the error goes to the caller. */
  maxWaitSeconds: number;
}

/** Options that every client method takes as its last argument. */
export interface CallOptions {
  /** Cancels the request, including the time it spends in the queue or waiting out a 429. */
  signal?: AbortSignal;
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Read by ID: Mercos blocks it in production, so the error carries a hint about that. */
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

/** Slack added to the wait Mercos asks for, so the retry doesn't land right on the limit. */
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

/** Rejects with the abort reason as soon as it happens, and leaves no listener behind. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** An empty body becomes undefined; text that isn't JSON stays text, like the Mercos 401. */
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
  // Number(null) and Number("") are 0, which would mean an instant retry. Absence gets the fallback wait.
  if (raw === null || raw === "") return FALLBACK_WAIT_SECONDS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : FALLBACK_WAIT_SECONDS;
}

export function createHttp(config: HttpConfig): Http {
  // If the API echoes a token in a body, it must not reach error messages or logs.
  const secrets = [config.applicationToken, config.companyToken];
  const redact = (text: string) => secrets.reduce((result, token) => result.replaceAll(token, "***"), text);

  // The Mercos limit is global, so parallel requests only earn more 429s. Each call joins the
  // end of this chain, and the 429 wait happens with the queue paused. A caller that aborts
  // while waiting leaves the queue at once, without spending a request. The next turn still
  // waits for the previous one to finish, and `tail` never holds on to anyone's response.
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
      // JSON.stringify(undefined) is already undefined, so a request with no body stays without one.
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
        throw new MercosError("network", `Network failure on ${method} ${path}.`, { method, path, cause });
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
        throw new MercosError("unexpected_response", `HTML response to ${method} ${path}.`, {
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
