import assert from "node:assert/strict";
import { test } from "node:test";
import { createMercos } from "../src/index.ts";
import { fake, rejectsWith, THROTTLED, TOKENS } from "./helpers.ts";

test("envia os dois tokens e usa o host do sandbox por padrão", async () => {
  const { mercos, calls } = fake([{ body: { ok: true } }]);
  await mercos.tokenStatus();
  assert.equal(calls[0]!.url.href, "https://sandbox.mercos.com/api/v1/token_auth_status");
  assert.equal(calls[0]!.headers.ApplicationToken, TOKENS.applicationToken);
  assert.equal(calls[0]!.headers.CompanyToken, TOKENS.companyToken);
});

test("environment production troca o host", async () => {
  const { mercos, calls } = fake([{ body: {} }], { environment: "production" });
  await mercos.tokenStatus();
  assert.equal(calls[0]!.url.origin, "https://app.mercos.com");
});

test("429: espera o tempo pedido mais meio segundo e reenvia", async () => {
  const { mercos, calls, sleeps } = fake([THROTTLED, THROTTLED, { body: { ok: true } }]);
  assert.deepEqual(await mercos.tokenStatus(), { ok: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [5500, 5500]);
});

test("429: espera acima do teto vai para quem chamou, sem dormir", async () => {
  const { mercos, sleeps } = fake([{ status: 429, body: { tempo_ate_permitir_novamente: 120 } }], {
    maxWaitSeconds: 60,
  });
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("rate_limit", (error) => {
      assert.equal(error.retryAfterSeconds, 120);
      assert.equal(error.status, 429);
    }),
  );
  assert.deepEqual(sleeps, []);
});

test("429: desiste depois do limite de repetições", async () => {
  const { mercos, calls, sleeps } = fake([THROTTLED, THROTTLED, THROTTLED], { maxRetries: 2 });
  await assert.rejects(mercos.tokenStatus(), rejectsWith("rate_limit"));
  assert.equal(calls.length, 3);
  assert.equal(sleeps.length, 2);
});

test("429 sem corpo legível usa a espera de reserva", async () => {
  const { mercos, sleeps } = fake([{ status: 429, body: "<<>>" }, { body: {} }]);
  await mercos.tokenStatus();
  assert.deepEqual(sleeps, [5500]);
});

test("chamadas concorrentes são serializadas, nunca duas em voo", async () => {
  let inFlight = 0;
  let peak = 0;
  const slow = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight--;
    return { body: {} };
  };
  const { mercos, calls } = fake([slow, slow, slow, slow]);
  await Promise.all([mercos.tokenStatus(), mercos.tokenStatus(), mercos.tokenStatus(), mercos.tokenStatus()]);
  assert.equal(calls.length, 4);
  assert.equal(peak, 1);
});

test("uma falha não trava a fila para a chamada seguinte", async () => {
  const { mercos } = fake([{ status: 500, body: { mensagem: "erro interno" } }, { body: { ok: true } }]);
  const [first, second] = await Promise.allSettled([mercos.tokenStatus(), mercos.tokenStatus()]);
  assert.equal(first.status, "rejected");
  assert.deepEqual(second, { status: "fulfilled", value: { ok: true } });
});

test("412 com erros em forma de objeto", async () => {
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

test("412 com erros em forma de par", async () => {
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

test("422 com erros em forma de string e 412 só com mensagem", async () => {
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

test("401 do Mercos não é JSON e mesmo assim vira erro tipado", async () => {
  const { mercos } = fake([{ status: 401, body: "{\n\tSem permissao para acessar recurso\n}" }]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("auth", (error) => assert.match(error.message, /Sem permissao para acessar recurso/)),
  );
});

test("401 real do sandbox: texto puro rotulado como text/html não ganha dica de host errado", async () => {
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

test("token ecoado pela API nunca chega ao erro", async () => {
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

test("corpo em HTML ganha a dica de host errado", async () => {
  const html = { status: 404, body: "<!DOCTYPE html><html></html>", headers: { "Content-Type": "text/html" } };
  const { mercos } = fake([html]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("not_found", (error) => assert.match(error.hint ?? "", /host ou caminho errado/)),
  );
});

test("GET por ID em produção ganha a dica; no sandbox não", async () => {
  const production = fake([{ status: 404, body: { mensagem: "não encontrado" } }], { environment: "production" });
  await assert.rejects(
    production.mercos.pedidos.get(10),
    rejectsWith("not_found", (error) => assert.match(error.hint ?? "", /GET por ID/)),
  );
  const sandbox = fake([{ status: 404, body: { mensagem: "não encontrado" } }]);
  await assert.rejects(
    sandbox.mercos.pedidos.get(10),
    rejectsWith("not_found", (error) => assert.equal(error.hint, undefined)),
  );
});

test("falha do fetch vira erro de rede com a causa preservada", async () => {
  const boom = new TypeError("fetch failed");
  const { mercos } = fake([
    () => {
      throw boom;
    },
  ]);
  await assert.rejects(
    mercos.tokenStatus(),
    rejectsWith("network", (error) => assert.equal(error.cause, boom)),
  );
});

test("token com quebra de linha no fim é aparado antes de virar header", async () => {
  const { mercos, calls } = fake([{ body: {} }], { companyToken: `${TOKENS.companyToken}\n` });
  await mercos.tokenStatus();
  assert.equal(calls[0]!.headers.CompanyToken, TOKENS.companyToken);
});

test("ambiente herdado do protótipo e opções ausentes viram erro de config", () => {
  assert.throws(() => fake([], { environment: "constructor" as never }), rejectsWith("config"));
  assert.throws(() => createMercos(undefined as never), rejectsWith("config"));
});

test("document global dentro do Node, como no jsdom, não bloqueia o SDK", () => {
  Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
  try {
    assert.ok(fake([]).mercos);
  } finally {
    Reflect.deleteProperty(globalThis, "document");
  }
});

test("abort rejeita na hora, mesmo com a fila parada num 429 de outra chamada", async () => {
  let releaseSleep = () => {};
  const { mercos, calls } = fake([THROTTLED, { body: { ok: true } }], {
    sleep: () =>
      new Promise<void>((resolve) => {
        releaseSleep = resolve;
      }),
  });
  const first = mercos.tokenStatus();
  const controller = new AbortController();
  const second = mercos.tokenStatus(controller.signal);
  await new Promise((resolve) => setImmediate(resolve));

  controller.abort(new Error("desisti"));
  await assert.rejects(second, /desisti/);

  releaseSleep();
  assert.deepEqual(await first, { ok: true });
  // A chamada abortada saiu da fila sem gastar requisição: só o 429 e a repetição da primeira.
  assert.equal(calls.length, 2);
});

test("401 em GET por ID na produção não ganha a dica de GET por ID", async () => {
  const { mercos } = fake([{ status: 401, body: "Informe os tokens de acesso." }], { environment: "production" });
  await assert.rejects(
    mercos.clientes.get(123),
    rejectsWith("auth", (error) => assert.equal(error.hint, undefined)),
  );
});

test("token ausente falha na criação do cliente, antes de qualquer requisição", () => {
  assert.throws(() => fake([], { companyToken: "" }), rejectsWith("config"));
  assert.throws(() => fake([], { applicationToken: undefined as never }), rejectsWith("config"));
});

test("abort de quem está na fila não deixa a chamada seguinte furar a que está em voo", async () => {
  let inFlight = 0;
  let peak = 0;
  const slow = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight--;
    return { body: {} };
  };
  const { mercos, calls } = fake([slow, slow]);
  const controller = new AbortController();

  const first = mercos.tokenStatus();
  const second = mercos.tokenStatus(controller.signal);
  const third = mercos.tokenStatus();
  controller.abort(new Error("desisti"));

  await assert.rejects(second, /desisti/);
  await Promise.all([first, third]);
  assert.equal(calls.length, 2);
  assert.equal(peak, 1);
});
