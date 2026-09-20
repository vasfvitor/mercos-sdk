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
  maxRetries: number;
  maxWaitSeconds: number;
  timeoutMs: number;
}

/** Options that every client method takes as its last argument. */
export interface CallOptions {
  /** Cancels the request, including the time it spends in the queue or waiting out a 429. */
  signal?: AbortSignal | undefined;
  /** Time limit for each attempt of this call, in milliseconds. Overrides the client's. Zero turns it off. */
  timeoutMs?: number | undefined;
}

export interface RequestOptions extends CallOptions {
  query?: Query;
  body?: unknown;
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
/** Gateway statuses: the request most likely never reached Mercos, or Mercos was restarting. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
/** Retries of a read after a transient failure, waiting 1s and then 2s. `maxRetries` can lower it. */
const TRANSIENT_RETRIES = 2;

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
  // If the API echoes a token in a body, it must not reach error messages or logs. Only what feeds an
  // error gets masked: the data of a good response goes out exactly as it came.
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
    const headers = {
      Accept: "application/json",
      ApplicationToken: config.applicationToken,
      CompanyToken: config.companyToken,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    };
    // JSON.stringify(undefined) is already undefined, so a request with no body stays without one.
    const body = JSON.stringify(options.body);
    const timeoutMs = options.timeoutMs ?? config.timeoutMs;
    // Only a read is safe to repeat. A POST that timed out may have created the order anyway.
    const transientRetries = method === "GET" ? Math.min(TRANSIENT_RETRIES, config.maxRetries) : 0;
    let transientFailures = 0;
    const retryTransient = async () => {
      if (transientFailures >= transientRetries) return false;
      await config.sleep(1000 * 2 ** transientFailures++, options.signal);
      return true;
    };

    for (let retries = 0; ; ) {
      // A fetch that never answers would hold the whole queue, so every attempt gets its own deadline.
      const deadline = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
      const signals = [options.signal, deadline].filter((signal) => signal !== undefined);
      const init: RequestInit = {
        method,
        headers,
        body,
        signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      };

      let response: Response;
      let text: string;
      try {
        response = await config.fetch(url, init);
        text = await response.text();
        if (!response.ok || looksLikeHtml(text)) text = redact(text);
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        if (await retryTransient()) continue;
        throw deadline?.aborted
          ? new MercosError("timeout", `No response to ${method} ${path} within ${timeoutMs} ms.`, {
              method,
              path,
              cause,
            })
          : new MercosError("network", `Network failure on ${method} ${path}.`, { method, path, cause });
      }

      const data = parseBody(text);

      const retryAfterSeconds = response.status === 429 ? waitSeconds(data, response.headers) : undefined;
      if (
        retryAfterSeconds !== undefined &&
        retries < config.maxRetries &&
        retryAfterSeconds <= config.maxWaitSeconds
      ) {
        retries++;
        await config.sleep((retryAfterSeconds + RETRY_PADDING_SECONDS) * 1000, options.signal);
        continue;
      }
      if (TRANSIENT_STATUSES.has(response.status) && (await retryTransient())) continue;

      if (!response.ok) {
        throw errorFromResponse({
          status: response.status,
          method,
          path,
          text,
          body: data,
          // Mercos blocks the read of one record in production, so the error carries a hint about that.
          readByIdInProduction: config.production && method === "GET" && /\/\d+$/.test(path),
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
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
      return { status: response.status, headers: response.headers, data: data as T };
    }
  }

  return {
    // Reads are recognized by an exact "GET", so a caller's lowercase method is normalized here.
    request: (method, path, options = {}) => serialize(() => send(method.toUpperCase(), path, options), options.signal),
  };
}
