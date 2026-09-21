import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, type MercosAttempt, mercosTimestamp, type PedidoInput } from "../src/index.ts";
import { fake, fixture, LIMITED, rejectsWith, THROTTLED } from "./helpers.ts";

const record = (id: number, ultima_alteracao: string) => ({ id, ultima_alteracao });
const PEDIDO = fixture("post_v2_pedidos").request as PedidoInput;

test("onAttempt sees every attempt: the 429 with its wait, then the good one", async () => {
  const events: MercosAttempt[] = [];
  const { mercos } = fake([THROTTLED, { body: { id: 55 } }], { onAttempt: (event) => events.push(event) });

  await mercos.pedidos.get(55);

  assert.deepEqual(
    events.map(({ durationMs, ...rest }) => rest),
    [
      {
        method: "GET",
        path: "/v2/pedidos/55",
        route: "/v2/pedidos/{id}",
        attempt: 1,
        status: 429,
        error: undefined,
        retryInSeconds: 5.5,
      },
      {
        method: "GET",
        path: "/v2/pedidos/55",
        route: "/v2/pedidos/{id}",
        attempt: 2,
        status: 200,
        error: undefined,
        retryInSeconds: undefined,
      },
    ],
  );
  assert.ok(events.every((event) => event.durationMs >= 0));
});

test("onAttempt reports a network failure with no status, and the final error status", async () => {
  const events: MercosAttempt[] = [];
  const offline = () => {
    throw new TypeError("fetch failed");
  };
  const { mercos } = fake([offline, { status: 404, body: {} }], { onAttempt: (event) => events.push(event) });

  await assert.rejects(mercos.tokenStatus(), rejectsWith("not_found"));

  assert.deepEqual(
    events.map((event) => [event.attempt, event.status, event.error, event.retryInSeconds]),
    [
      [1, undefined, "network", 1],
      [2, 404, undefined, undefined],
    ],
  );
});

test("an onAttempt that throws doesn't break the call", async () => {
  const { mercos } = fake([{ body: { ok: true } }], {
    onAttempt() {
      throw new Error("broken logger");
    },
  });
  assert.deepEqual(await mercos.tokenStatus(), { ok: true });
});

test("minIntervalMs spaces the starts of two requests, and zero adds no wait", async () => {
  const spaced = fake([{ body: {} }, { body: {} }], { minIntervalMs: 2000 });
  await spaced.mercos.tokenStatus();
  await spaced.mercos.tokenStatus();
  assert.equal(spaced.sleeps.length, 1);
  assert.ok((spaced.sleeps[0] ?? 0) > 1900 && (spaced.sleeps[0] ?? 0) <= 2000);

  const unspaced = fake([{ body: {} }, { body: {} }]);
  await unspaced.mercos.tokenStatus();
  await unspaced.mercos.tokenStatus();
  assert.deepEqual(unspaced.sleeps, []);
});

test("listPages yields one array per request, without the records the page before it brought", async () => {
  const { mercos } = fake([
    { body: [record(1, "2024-01-01 10:00:00"), record(2, "2024-01-02 10:00:00")], headers: LIMITED },
    { body: [record(2, "2024-01-02 10:00:00"), record(3, "2024-01-03 10:00:00")] },
  ]);

  const pages = await collect(mercos.clientes.listPages());

  assert.deepEqual(
    pages.map((page) => page.map((cliente) => cliente.id)),
    [[1, 2], [3]],
  );
});

test("the generic listPages walks a path with parameters", async () => {
  const { mercos, calls } = fake([{ body: [record(1, "2024-01-01 10:00:00")] }]);
  const pages = await collect(mercos.listPages("/v1/funil/{funil_id}/etapas", { params: { funil_id: 3 } }));
  assert.equal(pages.length, 1);
  assert.equal(calls[0]?.url.pathname, "/api/v1/funil/3/etapas");
});

test("find lists from `since`, and stops at the page that has the record", async () => {
  const { mercos, calls } = fake([
    { body: [record(1, "2024-01-01 10:00:00"), record(2, "2024-01-02 10:00:00")], headers: LIMITED },
    { body: [record(2, "2024-01-02 10:00:00"), record(3, "2024-01-03 10:00:00")], headers: LIMITED },
  ]);

  const found = await mercos.produtos.find(3, { since: "2024-01-01T00:00:00" });

  assert.equal(found?.id, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.searchParams.get("alterado_apos"), "2024-01-01 00:00:00");
  assert.equal(calls[0]?.url.pathname, "/api/v1/produtos");
});

test("find returns undefined when the list ends without the record", async () => {
  const { mercos } = fake([{ body: [record(1, "2024-01-01 10:00:00")] }]);
  assert.equal(await mercos.produtos.find(9, { since: "2024-01-01T00:00:00" }), undefined);
});

test("createAndRead posts the order, then finds it in the list of the last hour", async () => {
  const { mercos, calls } = fake([
    { status: 201, headers: { MeusPedidosID: "77" }, body: { numero: 8 } },
    { body: [{ ...record(77, "2026-09-20 18:00:00"), total: 1396.24 }] },
  ]);

  const pedido = await mercos.pedidos.createAndRead(PEDIDO);

  assert.equal(pedido.total, 1396.24);
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.pathname}`),
    ["POST /api/v2/pedidos", "GET /api/v2/pedidos"],
  );
  assert.match(calls[1]?.url.searchParams.get("alterado_apos") ?? "", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("createAndRead says that the order exists when the list doesn't have it", async () => {
  const { mercos } = fake([{ status: 201, headers: { MeusPedidosID: "77" } }, { body: [] }]);
  await assert.rejects(
    mercos.pedidos.createAndRead(PEDIDO),
    rejectsWith("unexpected_response", (error) => {
      assert.match(error.message, /Order 77 was created/);
      assert.equal(error.createdId, 77);
    }),
  );
});

test("createAndRead keeps the order's ID when the read itself fails", async () => {
  const { mercos } = fake([
    { status: 201, headers: { MeusPedidosID: "77" } },
    { status: 500, body: {} },
  ]);
  await assert.rejects(
    mercos.pedidos.createAndRead(PEDIDO),
    rejectsWith("server", (error) => {
      assert.equal(error.createdId, 77);
      assert.ok(error.cause instanceof Error);
    }),
  );
});

test("a Date in `since` and in `changedAfter` goes out in Brazilian time, as Mercos writes it", async () => {
  // 00:12 UTC on the 21st is 21:12 on the 20th in Brazil, which is what the sandbox stamped.
  const instant = new Date("2026-09-21T00:12:36Z");
  assert.equal(mercosTimestamp(instant), "2026-09-20 21:12:36");

  const { mercos, calls } = fake([{ body: [] }, { body: [] }]);
  await mercos.produtos.find(1, { since: instant });
  await collect(mercos.clientes.list({ changedAfter: instant }));
  assert.deepEqual(
    calls.map((call) => call.url.searchParams.get("alterado_apos")),
    ["2026-09-20 21:12:36", "2026-09-20 21:12:36"],
  );
});
