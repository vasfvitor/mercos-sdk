import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMercos, type Mercos, MercosError, type MercosOptions } from "../src/index.ts";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Handler = Reply | ((call: Call) => Reply | Promise<Reply>);

interface Fake {
  mercos: Mercos;
  calls: Call[];
  /** Waits requested from the fake clock, in milliseconds. No real waiting happens. */
  sleeps: number[];
}

export const TOKENS = { applicationToken: "test-application-token", companyToken: "test-company-token" };

/** A client with a scripted `fetch`: each request consumes the next reply in the queue. */
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
      if (!next) throw new Error(`Unexpected request: ${call.method} ${call.url.pathname}`);
      const reply = typeof next === "function" ? await next(call) : next;
      const text =
        reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return new Response(text, {
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

/** A reply that takes one turn of the event loop, and the most replies that were ever pending at once. */
export function trackConcurrency(reply: Reply = { body: {} }) {
  let inFlight = 0;
  let peak = 0;
  const slow = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight--;
    return reply;
  };
  return { slow, peak: () => peak };
}

export function rejectsWith(kind: string, check?: (error: MercosError) => void) {
  return (error: unknown) => {
    assert.ok(error instanceof MercosError, `expected a MercosError, got ${String(error)}`);
    assert.equal(error.kind, kind);
    check?.(error);
    return true;
  };
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
