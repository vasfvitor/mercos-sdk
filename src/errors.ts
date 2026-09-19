export type MercosErrorKind =
  | "auth"
  | "validation"
  | "not_found"
  | "rate_limit"
  | "server"
  | "http"
  | "network"
  | "unexpected_response"
  | "pagination"
  | "config";

export interface MercosFieldError {
  /** Campo apontado pela API. Ausente quando a API devolve só a mensagem. */
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

/** Único erro lançado pelo SDK. O campo `kind` diz o que aconteceu; os tokens nunca aparecem aqui. */
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
 * A API devolve `erros` em quatro formas, conforme a rota: objetos `{campo, mensagem}`,
 * pares `[campo, mensagem]`, strings soltas, ou nada. Todas viram a mesma lista.
 */
export function normalizeFieldErrors(erros: unknown): MercosFieldError[] {
  if (!Array.isArray(erros)) return [];
  const result: MercosFieldError[] = [];
  for (const erro of erros) {
    if (typeof erro === "string") {
      result.push({ mensagem: erro });
    } else if (Array.isArray(erro)) {
      const [campo, mensagem] = erro;
      result.push(
        mensagem === undefined ? { mensagem: String(campo) } : { campo: String(campo), mensagem: String(mensagem) },
      );
    } else if (typeof erro === "object" && erro !== null) {
      const { campo, mensagem } = erro as { campo?: unknown; mensagem?: unknown };
      result.push({ ...(campo === undefined ? {} : { campo: String(campo) }), mensagem: String(mensagem ?? "") });
    }
  }
  return result;
}

export const WRONG_HOST_HINT =
  "A resposta veio em HTML, o que indica host ou caminho errado. Confira o ambiente: sandbox.mercos.com/api ou app.mercos.com/api.";
const READ_BY_ID_HINT =
  "Em produção o Mercos não libera GET por ID. Use a listagem com alterado_apos ou peça a liberação ao suporte.";

/** Só o corpo decide: o Mercos rotula até texto puro como text/html, como no 401 de token recusado. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype|html)/i.test(text);
}

function kindForStatus(status: number): MercosErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400 || status === 412 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "http";
}

export interface ResponseErrorInput {
  status: number;
  method: string;
  path: string;
  text: string;
  body: unknown;
  production: boolean;
}

export function errorFromResponse(input: ResponseErrorInput): MercosError {
  const { status, method, path, body } = input;
  const payload = typeof body === "object" && body !== null ? (body as { mensagem?: unknown; erros?: unknown }) : {};
  const fieldErrors = normalizeFieldErrors(payload.erros);
  const html = looksLikeHtml(input.text);

  let hint: string | undefined;
  if (html) hint = WRONG_HOST_HINT;
  // Não se sabe qual status o Mercos usa para o bloqueio, mas 401 é token e 5xx é falha do servidor.
  else if (input.production && method === "GET" && /\/\d+$/.test(path) && status >= 402 && status < 500)
    hint = READ_BY_ID_HINT;

  const detail =
    typeof payload.mensagem === "string"
      ? payload.mensagem
      : fieldErrors.length === 0 && typeof body === "string" && !html
        ? body.replace(/[{}\s"]+/g, " ").trim()
        : "";
  const fields = fieldErrors.map((erro) => (erro.campo ? `${erro.campo}: ${erro.mensagem}` : erro.mensagem)).join("; ");
  const message = [`Mercos respondeu ${status} em ${method} ${path}.`, detail, fields].filter(Boolean).join(" ");

  return new MercosError(kindForStatus(status), message, {
    status,
    method,
    path,
    fieldErrors,
    hint,
    body: html ? undefined : body,
  });
}
