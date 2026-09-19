export type MercosErrorKind =
  | "auth"
  | "validation"
  | "not_found"
  | "rate_limit"
  | "server"
  | "http"
  | "network"
  | "timeout"
  | "unexpected_response"
  | "pagination"
  | "config";

export interface MercosFieldError {
  /** Field that the API points at. Absent when the API returns only a message. */
  campo?: string;
  mensagem: string;
}

export interface MercosErrorDetails {
  status?: number;
  method?: string;
  path?: string;
  fieldErrors?: MercosFieldError[];
  hint?: string;
  retryAfterSeconds?: number;
  body?: unknown;
  cause?: unknown;
}

/** The only error the SDK throws. `kind` says what happened; tokens never appear here. */
export class MercosError extends Error {
  readonly kind: MercosErrorKind;
  readonly status: number | undefined;
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly fieldErrors: MercosFieldError[];
  readonly hint: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly body: unknown;

  constructor(kind: MercosErrorKind, message: string, details: MercosErrorDetails = {}) {
    super(details.hint ? `${message} ${details.hint}` : message, { cause: details.cause });
    this.name = "MercosError";
    this.kind = kind;
    this.status = details.status;
    this.method = details.method;
    this.path = details.path;
    this.fieldErrors = details.fieldErrors ?? [];
    this.hint = details.hint;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.body = details.body;
  }
}

/**
 * The API returns `erros` in four shapes, depending on the route: `{campo, mensagem}` objects,
 * `[campo, mensagem]` pairs, bare strings, or nothing. All of them become the same list.
 * The `campo` and `mensagem` keys stay in Portuguese because that is how the API spells them.
 */
function normalizeFieldErrors(entries: unknown): MercosFieldError[] {
  if (!Array.isArray(entries)) return [];
  // An order with no payment condition gets `["", "message"]`: a pair whose field is empty.
  const named = (campo: unknown) => (campo === undefined || campo === "" ? {} : { campo: String(campo) });
  const result: MercosFieldError[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      result.push({ mensagem: entry });
    } else if (Array.isArray(entry)) {
      const [campo, mensagem] = entry;
      result.push(
        mensagem === undefined ? { mensagem: String(campo) } : { ...named(campo), mensagem: String(mensagem) },
      );
    } else if (typeof entry === "object" && entry !== null) {
      const { campo, mensagem } = entry as { campo?: unknown; mensagem?: unknown };
      result.push({ ...named(campo), mensagem: String(mensagem ?? "") });
    }
  }
  return result;
}

export const WRONG_HOST_HINT =
  "The response is HTML, which points to a wrong host or path. Check the environment: sandbox.mercos.com/api or app.mercos.com/api.";
const READ_BY_ID_HINT =
  "Mercos blocks reads by ID in production. Use the list with alterado_apos, or ask Mercos support to enable it.";

/** Only the body decides: Mercos labels even plain text as text/html, as in the 401 for a rejected token. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype|html)/i.test(text);
}

function kindForStatus(status: number): MercosErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400 || status === 412 || status === 422) return "validation";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "http";
}

interface ResponseErrorInput {
  status: number;
  method: string;
  path: string;
  text: string;
  body: unknown;
  readByIdInProduction: boolean;
  /** Only on a 429 that won't be retried: the wait Mercos asked for, and the limits that stopped it. */
  retryAfterSeconds?: number;
  limits: { maxRetries: number; maxWaitSeconds: number };
}

export function errorFromResponse(input: ResponseErrorInput): MercosError {
  const { status, method, path, body } = input;
  const payload = typeof body === "object" && body !== null ? (body as { mensagem?: unknown; erros?: unknown }) : {};
  const fieldErrors = normalizeFieldErrors(payload.erros);
  const html = looksLikeHtml(input.text);

  let hint: string | undefined;
  if (html) hint = WRONG_HOST_HINT;
  // The status Mercos uses for the block is unknown, but 401 means tokens, 429 the limit, and 5xx the server.
  else if (input.readByIdInProduction && status >= 402 && status < 500 && status !== 429) hint = READ_BY_ID_HINT;

  const detail =
    typeof payload.mensagem === "string"
      ? payload.mensagem
      : fieldErrors.length === 0 && typeof body === "string" && !html
        ? body.replace(/[{}\s"]+/g, " ").trim()
        : "";
  const fields = fieldErrors.map(({ campo, mensagem }) => (campo ? `${campo}: ${mensagem}` : mensagem)).join("; ");
  const { retryAfterSeconds, limits } = input;
  const limit =
    retryAfterSeconds === undefined
      ? ""
      : retryAfterSeconds > limits.maxWaitSeconds
        ? `Mercos asked for a ${retryAfterSeconds}s wait, above the ${limits.maxWaitSeconds}s ceiling.`
        : `Gave up after ${limits.maxRetries} retries.`;
  const message = [`Mercos responded ${status} to ${method} ${path}.`, detail, fields, limit].filter(Boolean).join(" ");

  return new MercosError(kindForStatus(status), message, {
    status,
    method,
    path,
    fieldErrors,
    hint,
    retryAfterSeconds,
    body: html ? undefined : body,
  });
}
