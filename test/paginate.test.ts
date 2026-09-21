import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, StatusPedido } from "../src/index.ts";
import { fake, fixture, LIMITED, rejectsWith } from "./helpers.ts";

const record = (id: number, ultima_alteracao: string) => ({ id, ultima_alteracao });

test("three pages: an unsorted page, repeats dropped, and the server's exact cursor", async () => {
  const { mercos, calls } = fake([
    // Unsorted on purpose: the cursor comes from the instants on the page, not from the last record's position.
    {
      body: [record(2, "2024-01-02 10:00:00"), record(3, "2024-01-03 10:00:00"), record(1, "2024-01-01 10:00:00")],
      headers: LIMITED,
    },
    // The cursor stepped back to the second-highest instant, so record 3 comes back and gets dropped.
    { body: [record(3, "2024-01-03 10:00:00"), record(4, "2024-01-04 10:00:00")], headers: LIMITED },
    { body: [record(5, "2024-01-05 10:00:00")] },
  ]);

  const clientes = await collect(mercos.clientes.list());

  assert.deepEqual(
    clientes.map((cliente) => cliente.id),
    [2, 3, 1, 4, 5],
  );
  assert.deepEqual(
    calls.map((call) => call.url.searchParams.get("alterado_apos")),
    ["2000-01-01 00:00:00", "2024-01-02 10:00:00", "2024-01-03 10:00:00"],
  );
});

test("a record changed again between pages isn't treated as a repeat", async () => {
  const { mercos } = fake([
    { body: [record(9, "2024-01-01 09:00:00"), record(1, "2024-01-01 10:00:00")], headers: LIMITED },
    { body: [record(1, "2024-01-01 10:00:07")] },
  ]);
  assert.equal((await collect(mercos.clientes.list())).length, 3);
});

test("a whole page in one second, with more pages promised, fails loudly", async () => {
  const sameSecond = [record(1, "2024-01-01 10:00:00"), record(2, "2024-01-01 10:00:00")];
  const { mercos, calls } = fake([{ body: sameSecond, headers: LIMITED }]);
  await assert.rejects(collect(mercos.clientes.list()), rejectsWith("pagination"));
  assert.equal(calls.length, 1);
});

test("same-second records cut off by the end of a page aren't lost with a strict server", async () => {
  // The server has 2, 3, and 4 in the same second, but page 1 ended before 4.
  const { mercos, calls } = fake([
    {
      body: [record(1, "2024-01-01 10:00:00"), record(2, "2024-01-01 10:00:05"), record(3, "2024-01-01 10:00:05")],
      headers: LIMITED,
    },
    // A strict alterado_apos (>) from 10:00:00 brings the whole 10:00:05 second back.
    {
      body: [
        record(2, "2024-01-01 10:00:05"),
        record(3, "2024-01-01 10:00:05"),
        record(4, "2024-01-01 10:00:05"),
        record(5, "2024-01-01 10:00:09"),
      ],
    },
  ]);
  const clientes = await collect(mercos.clientes.list());
  assert.deepEqual(
    clientes.map((cliente) => cliente.id),
    [1, 2, 3, 4, 5],
  );
  assert.equal(calls[1]!.url.searchParams.get("alterado_apos"), "2024-01-01 10:00:00");
});

test("a starting cursor with a T raises no false alarm against the server's space format", async () => {
  const { mercos } = fake([
    { body: [record(1, "2024-04-10 16:00:00"), record(2, "2024-04-10 16:30:00")], headers: LIMITED },
    { body: [record(2, "2024-04-10 16:30:00"), record(3, "2024-04-10 17:00:00")] },
  ]);
  const clientes = await collect(mercos.clientes.list({ changedAfter: "2024-04-10T15:45:00" }));
  assert.equal(clientes.length, 3);
});

test("an empty page without the header ends with no error", async () => {
  const { mercos, calls } = fake([{ body: [] }]);
  assert.deepEqual(await collect(mercos.produtos.list()), []);
  assert.equal(calls.length, 1);
});

test("a response that isn't a list becomes unexpected_response", async () => {
  const { mercos } = fake([{ body: { mensagem: "ops" } }]);
  await assert.rejects(collect(mercos.produtos.list()), rejectsWith("unexpected_response"));
});

test("order filters go into the query, with status_custom repeated", async () => {
  const { mercos, calls } = fake([{ body: fixture("get_v2_pedidos").responses["200"] }]);
  const pedidos = await collect(
    mercos.pedidos.list({
      changedAfter: "2024-01-01 00:00:00",
      filters: { status: StatusPedido.Orcamento, status_custom: [0, 4], registros_por_pagina: 15 },
    }),
  );

  const query = calls[0]!.url.searchParams;
  assert.equal(calls[0]!.url.pathname, "/api/v2/pedidos");
  assert.equal(query.get("status"), "1");
  assert.deepEqual(query.getAll("status_custom"), ["0", "4"]);
  assert.equal(query.get("registros_por_pagina"), "15");
  assert.equal(query.get("alterado_apos"), "2024-01-01 00:00:00");
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[0]!.itens?.[0]?.produto_id, 130);
});

test("the iterator is lazy: stopping early doesn't fetch the next page", async () => {
  const { mercos, calls } = fake([
    { body: [record(1, "2024-01-01 10:00:00"), record(2, "2024-01-02 10:00:00")], headers: LIMITED },
    { body: [record(3, "2024-01-03 10:00:00")] },
  ]);
  for await (const cliente of mercos.clientes.list()) {
    assert.equal(cliente.id, 1);
    break;
  }
  assert.equal(calls.length, 1);
});
