import { readFileSync } from "node:fs";
import { createMercos, type Mercos, type MercosOptions } from "../src/index.ts";

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

export interface Fake {
  mercos: Mercos;
  calls: Call[];
  /** Esperas pedidas ao relógio falso, em milissegundos. Nenhuma espera de verdade acontece. */
  sleeps: number[];
}

export const TOKENS = { applicationToken: "app-token-de-teste", companyToken: "company-token-de-teste" };

/** Cliente com `fetch` roteirizado: cada requisição consome a próxima resposta da fila. */
export function fake(replies: Handler[], options: Partial<MercosOptions> = {}): Fake {
  const queue = [...replies];
  const calls: Call[] = [];
  const sleeps: number[] = [];

  const mercos = createMercos({
    ...TOKENS,
    async fetch(url, init) {
      const call: Call = {
        method: String(init.method),
        url: new URL(url),
        headers: init.headers as Record<string, string>,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const next = queue.shift();
      if (!next) throw new Error(`Requisição inesperada: ${call.method} ${call.url.pathname}`);
      const reply = typeof next === "function" ? await next(call) : next;
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? "");
      return new Response(reply.body === undefined ? "" : text, {
        status: reply.status ?? 200,
        headers: { "Content-Type": "application/json", ...reply.headers },
      });
    },
    sleep(ms) {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...options,
  });
  return { mercos, calls, sleeps };
}

export const LIMITED = { MEUSPEDIDOS_LIMITOU_REGISTROS: "1" };
export const THROTTLED: Reply = { status: 429, body: { tempo_ate_permitir_novamente: 5, limite_de_requisicoes: 1 } };

interface Fixture {
  request: unknown;
  responses: Record<string, unknown>;
}

export function fixture(operationId: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/${operationId}.json`, import.meta.url), "utf8")) as Fixture;
}
