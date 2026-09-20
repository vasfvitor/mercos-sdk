import assert from "node:assert/strict";
import { test } from "node:test";
import { createMercos } from "../src/index.ts";
import { fake, rejectsWith, THROTTLED, TOKENS, trackConcurrency } from "./helpers.ts";

test("sends both tokens and defaults to the sandbox host", async () => {
  const { mercos, calls } = fake([{ body: { ok: true } }]);
  await mercos.tokenStatus();
  assert.equal(calls[0]!.url.href, "https://sandbox.mercos.com/api/v1/token_auth_status");
  assert.equal(calls[0]!.headers.ApplicationToken, TOKENS.applicationToken);
  assert.equal(calls[0]!.headers.CompanyToken, TOKENS.companyToken);
});

test("the production environment switches the host", async () => {
  const { mercos, calls } = fake([{ body: {} }], { environment: "production" });
  await mercos.tokenStatus();
  assert.equal(calls[0]!.url.origin, "https://app.mercos.com");
});

test("429: waits the reported time plus half a second, then retries", async () => {
  const { mercos, calls, sleeps } = fake([THROTTLED, THROTTLED, { body: { ok: true } }]);
  assert.deepEqual(await mercos.tokenStatus(), { ok: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [5500, 5500]);
});

test("429: a wait above the ceiling goes to the caller without sleeping", async () => {
  const { mercos, sleeps } = fake([{ status: 429, body: { tempo_ate_permitir_novamente: 120 } }], {
    maxWaitSeconds: 60,
  });
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("rate_limit", (error) => {
      assert.equal(error.retryAfterSeconds, 120);
      assert.equal(error.status, 429);
      assert.match(error.message, /above the 60s ceiling/);
    }),
  );
  assert.deepEqual(sleeps, []);
});

test("429: gives up after the retry cap", async () => {
  const { mercos, calls, sleeps } = fake([THROTTLED, THROTTLED, THROTTLED], { maxRetries: 2 });
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("rate_limit", (error) => assert.match(error.message, /Gave up after 2 retries/)),
  );
  assert.equal(calls.length, 3);
  assert.equal(sleeps.length, 2);
});

test("429 with an unreadable body uses the fallback wait", async () => {
  const { mercos, sleeps } = fake([{ status: 429, body: "<<>>" }, { body: {} }]);
  await mercos.tokenStatus();
  assert.deepEqual(sleeps, [5500]);
});

test("concurrent calls are serialized, never two in flight", async () => {
  const { slow, peak } = trackConcurrency();
  const { mercos, calls } = fake([slow, slow, slow, slow]);
  await Promise.all([mercos.tokenStatus(), mercos.tokenStatus(), mercos.tokenStatus(), mercos.tokenStatus()]);
  assert.equal(calls.length, 4);
  assert.equal(peak(), 1);
});

test("a failure doesn't block the queue for the next call", async () => {
  const { mercos } = fake([{ status: 500, body: { mensagem: "erro interno" } }, { body: { ok: true } }]);
  const [first, second] = await Promise.allSettled([mercos.tokenStatus(), mercos.tokenStatus()]);
  assert.equal(first.status, "rejected");
  assert.deepEqual(second, { status: "fulfilled", value: { ok: true } });
});

test("412 with errors shaped as objects", async () => {
  const body = {
    mensagem: "Dados inválidos",
    erros: [{ campo: "razao_social", mensagem: "Este campo é obrigatório." }],
  };
  const { mercos } = fake([{ status: 412, body }]);
  await assert.rejects(
    mercos.clientes.create({} as never),
    rejectsWith("validation", (error) => {
      assert.deepEqual(error.fieldErrors, [{ campo: "razao_social", mensagem: "Este campo é obrigatório." }]);
      assert.match(error.message, /razao_social: Este campo é obrigatório\./);
    }),
  );
});

test("412 with errors shaped as pairs", async () => {
  const body = {
    mensagem: "Ocorreram erros de validação",
    erros: [["cliente_id", "Atributo obrigatório não informado"]],
  };
  const { mercos } = fake([{ status: 412, body }]);
  await assert.rejects(
    mercos.pedidos.create({} as never),
    rejectsWith("validation", (error) => {
      assert.deepEqual(error.fieldErrors, [{ campo: "cliente_id", mensagem: "Atributo obrigatório não informado" }]);
    }),
  );
});

test("a pair with an empty field carries only the message", async () => {
  const body = { erros: [["", "Informe a condição de pagamento."]] };
  const { mercos } = fake([{ status: 422, body }]);
  await assert.rejects(
    mercos.pedidos.create({} as never),
    rejectsWith("validation", (error) => {
      assert.deepEqual(error.fieldErrors, [{ mensagem: "Informe a condição de pagamento." }]);
      assert.match(error.message, /v2\/pedidos\. Informe a condição/);
    }),
  );
});

test("422 with errors shaped as strings, and a 412 with only a message", async () => {
  const { mercos } = fake([
    {
      status: 422,
      body: { mensagem: "Estrutura JSON inválida.", erros: ["required key not provided @ data['tipo']"] },
    },
    { status: 412, body: { mensagem: "Pedido 1 inexistente para conta 123456" } },
  ]);
  await assert.rejects(
    mercos.clientes.create({} as never),
    rejectsWith("validation", (error) => {
      assert.deepEqual(error.fieldErrors, [{ mensagem: "required key not provided @ data['tipo']" }]);
    }),
  );
  await assert.rejects(
    mercos.pedidos.cancel(1),
    rejectsWith("validation", (error) => {
      assert.deepEqual(error.fieldErrors, []);
      assert.match(error.message, /Pedido 1 inexistente/);
    }),
  );
});

test("the documented Mercos 401 isn't JSON and still becomes a typed error", async () => {
  const { mercos } = fake([{ status: 401, body: "{\n\tSem permissao para acessar recurso\n}" }]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("auth", (error) => assert.match(error.message, /Sem permissao para acessar recurso/)),
  );
});

test("the real sandbox 401, plain text labeled text/html, gets no wrong-host hint", async () => {
  const body = "Informe os tokens de acesso, conforme descrito no manual da API.";
  const { mercos } = fake([{ status: 401, body, headers: { "Content-Type": "text/html; charset=utf-8" } }]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("auth", (error) => {
      assert.equal(error.hint, undefined);
      assert.match(error.message, /Informe os tokens de acesso/);
    }),
  );
});

test("a token echoed by the API never reaches the error", async () => {
  const { mercos } = fake([{ status: 400, body: { mensagem: `token ${TOKENS.companyToken} inválido` } }]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("validation", (error) => {
      const dump = `${error.message} ${JSON.stringify(error.body)}`;
      assert.ok(!dump.includes(TOKENS.companyToken));
      assert.ok(!dump.includes(TOKENS.applicationToken));
    }),
  );
});

test("the token mask never touches the data of a good response", async () => {
  // A one-letter token is the worst case: masked, `total` would come back as `tot***l`.
  const { mercos } = fake([{ body: { total: 1396.24, observacoes: "a" } }], { companyToken: "a" });
  assert.deepEqual(await mercos.tokenStatus(), { total: 1396.24, observacoes: "a" });
});

test("the client and its resources are frozen, so a wrapper can't replace a resource in place", () => {
  const { mercos } = fake([]);
  assert.throws(() => Object.assign(mercos, { pedidos: {} }), TypeError);
  assert.throws(() => Object.assign(mercos.pedidos, { create: () => undefined }), TypeError);
});

test("an HTML body gets the wrong-host hint", async () => {
  const html = { status: 404, body: "<!DOCTYPE html><html></html>", headers: { "Content-Type": "text/html" } };
  const { mercos } = fake([html]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("not_found", (error) => assert.match(error.hint ?? "", /wrong host or path/)),
  );
});

test("a read by ID gets the hint in production, and not in the sandbox", async () => {
  const production = fake([{ status: 404, body: { mensagem: "não encontrado" } }], { environment: "production" });
  await assert.rejects(
    production.mercos.pedidos.get(10),
    rejectsWith("not_found", (error) => assert.match(error.hint ?? "", /reads by ID in production/)),
  );
  const sandbox = fake([{ status: 404, body: { mensagem: "não encontrado" } }]);
  await assert.rejects(
    sandbox.mercos.pedidos.get(10),
    rejectsWith("not_found", (error) => assert.equal(error.hint, undefined)),
  );
});

test("a 401 on a read by ID in production doesn't get the read-by-ID hint", async () => {
  const { mercos } = fake([{ status: 401, body: "Informe os tokens de acesso." }], { environment: "production" });
  await assert.rejects(
    mercos.clientes.get(123),
    rejectsWith("auth", (error) => assert.equal(error.hint, undefined)),
  );
});

test("a read that fails on the network is retried twice, then keeps the last cause", async () => {
  const causes = [new TypeError("first"), new TypeError("second"), new TypeError("third")];
  const { mercos, calls, sleeps } = fake(
    causes.map((cause) => () => {
      throw cause;
    }),
  );
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("network", (error) => assert.equal(error.cause, causes[2])),
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test("a read recovers from a gateway error, and a plain 500 isn't retried", async () => {
  const { mercos, sleeps } = fake([{ status: 503, body: "upstream down" }, { body: { ok: true } }, { status: 500 }]);
  assert.deepEqual(await mercos.tokenStatus(), { ok: true });
  assert.deepEqual(sleeps, [1000]);
  await assert.rejects(mercos.tokenStatus(), rejectsWith("server"));
  assert.deepEqual(sleeps, [1000]);
});

test("a write is never repeated: the first attempt may have created the record", async () => {
  const boom = new TypeError("fetch failed");
  const { mercos, calls, sleeps } = fake([
    () => {
      throw boom;
    },
    { status: 504 },
  ]);
  await assert.rejects(
    mercos.clientes.create({} as never),
    rejectsWith("network", (error) => assert.equal(error.cause, boom)),
  );
  await assert.rejects(mercos.clientes.create({} as never), rejectsWith("server"));
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, []);
});

test("maxRetries: 0 turns off the retry of reads too", async () => {
  const { mercos, calls } = fake([{ status: 502 }], { maxRetries: 0 });
  await assert.rejects(mercos.tokenStatus(), rejectsWith("server"));
  assert.equal(calls.length, 1);
});

/**
 * A fetch that never answers, and gives up only when its signal aborts. The interval stands in for
 * the socket a real fetch holds: the timer behind AbortSignal.timeout doesn't keep the process alive.
 */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const socket = setInterval(() => {}, 1000);
    init.signal?.addEventListener(
      "abort",
      () => {
        clearInterval(socket);
        reject(init.signal?.reason);
      },
      { once: true },
    );
  });

test("a fetch that never answers becomes a timeout error, and frees the queue", async () => {
  let attempts = 0;
  const { mercos } = fake([], {
    timeoutMs: 10,
    maxRetries: 0,
    fetch: (url, init) => (attempts++ === 0 ? hang(url, init) : Promise.resolve(new Response('{"ok":true}'))),
  });
  const [first, second] = await Promise.allSettled([mercos.tokenStatus(), mercos.tokenStatus()]);
  assert.equal(first.status, "rejected");
  rejectsWith("timeout", (error) => assert.match(error.message, /within 10 ms/))(first.reason);
  assert.deepEqual(second, { status: "fulfilled", value: { ok: true } });
});

test("the timeout of a call overrides the client's, and an abort by the caller isn't a timeout", async () => {
  const { mercos } = fake([], { timeoutMs: 0, maxRetries: 0, fetch: hang });
  await assert.rejects(mercos.pedidos.cancel(1, { timeoutMs: 10 }), rejectsWith("timeout"));

  const controller = new AbortController();
  const call = mercos.pedidos.cancel(1, { timeoutMs: 60_000, signal: controller.signal });
  controller.abort(new Error("gave up"));
  await assert.rejects(call, /gave up/);
});

test("a token with a trailing newline is trimmed before it becomes a header", async () => {
  const { mercos, calls } = fake([{ body: {} }], { companyToken: `${TOKENS.companyToken}\n` });
  await mercos.tokenStatus();
  assert.equal(calls[0]!.headers.CompanyToken, TOKENS.companyToken);
});

test("an environment inherited from the prototype, and missing options, are config errors", () => {
  assert.throws(() => fake([], { environment: "constructor" as never }), rejectsWith("config"));
  assert.throws(() => createMercos(undefined as never), rejectsWith("config"));
});

test("a global document inside Node, as under jsdom, doesn't block the SDK", () => {
  Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
  try {
    assert.ok(fake([]).mercos);
  } finally {
    Reflect.deleteProperty(globalThis, "document");
  }
});

test("abort rejects at once, even with the queue paused on another call's 429", async () => {
  let releaseSleep = () => {};
  const { mercos, calls } = fake([THROTTLED, { body: { ok: true } }], {
    sleep: () =>
      new Promise<void>((resolve) => {
        releaseSleep = resolve;
      }),
  });
  const first = mercos.tokenStatus();
  const controller = new AbortController();
  const second = mercos.tokenStatus({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));

  controller.abort(new Error("gave up"));
  await assert.rejects(second, /gave up/);

  releaseSleep();
  assert.deepEqual(await first, { ok: true });
  // The aborted call left the queue without spending a request: only the 429 and the first call's retry.
  assert.equal(calls.length, 2);
});

test("aborting a queued call doesn't let the next one jump ahead of the one in flight", async () => {
  const { slow, peak } = trackConcurrency();
  const { mercos, calls } = fake([slow, slow]);
  const controller = new AbortController();

  const first = mercos.tokenStatus();
  const second = mercos.tokenStatus({ signal: controller.signal });
  const third = mercos.tokenStatus();
  controller.abort(new Error("gave up"));

  await assert.rejects(second, /gave up/);
  await Promise.all([first, third]);
  assert.equal(calls.length, 2);
  assert.equal(peak(), 1);
});

test("a missing token fails when the client is created, before any request", () => {
  assert.throws(() => fake([], { companyToken: "" }), rejectsWith("config"));
  assert.throws(() => fake([], { applicationToken: undefined as never }), rejectsWith("config"));
});
