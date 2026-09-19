import assert from "node:assert/strict";
import { test } from "node:test";
import { type Pedido, type PedidoInput, StatusPedido } from "../src/index.ts";
import { fake, fixture, rejectsWith } from "./helpers.ts";

test("pedidos.create returns the MeusPedidosID header as a number, plus the item IDs", async () => {
  const example = fixture("post_v2_pedidos");
  const { mercos, calls } = fake([
    { status: 201, body: example.responses["201"], headers: { MeusPedidosID: "2079512" } },
  ]);

  const created = await mercos.pedidos.create(example.request as PedidoInput);

  assert.deepEqual(created, {
    id: 2079512,
    numero: 1105,
    itens: [{ id: 15220248 }, { id: 15220249 }, { id: 15220250 }],
  });
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url.pathname, "/api/v2/pedidos");
  assert.equal(calls[0]!.headers["Content-Type"], "application/json");
  assert.deepEqual(calls[0]!.body, example.request);
});

test("create with an empty 201 body still reads the ID from the header", async () => {
  const { mercos } = fake([{ status: 201, headers: { MeusPedidosID: "77" } }]);
  assert.deepEqual(await mercos.clientes.create({} as never), { id: 77 });
});

test("create with no header and no body id is an unexpected response", async () => {
  const { mercos } = fake([{ status: 201, body: {} }]);
  await assert.rejects(mercos.clientes.create({} as never), rejectsWith("unexpected_response"));
});

test("an empty MeusPedidosID header doesn't block the id that came in the body", async () => {
  const { mercos } = fake([{ status: 201, body: { id: 987 }, headers: { MeusPedidosID: "" } }]);
  assert.deepEqual(await mercos.clientes.create({} as never), { id: 987 });
});

test("pedidos.update uses PUT on v2, and pedidos.cancel uses the v1 route", async () => {
  const { mercos, calls } = fake([{ body: {} }, { body: {} }]);
  await mercos.pedidos.update(55, { observacoes: "novo texto" });
  await mercos.pedidos.cancel(55);

  assert.deepEqual([calls[0]!.method, calls[0]!.url.pathname], ["PUT", "/api/v2/pedidos/55"]);
  assert.deepEqual(calls[0]!.body, { observacoes: "novo texto" });
  assert.deepEqual([calls[1]!.method, calls[1]!.url.pathname], ["POST", "/api/v1/pedidos/cancelar/55"]);
  assert.equal(calls[1]!.body, undefined);
});

test("each catalog resource lists on the right path", async () => {
  const { mercos, calls } = fake(Array.from({ length: 7 }, () => ({ body: [] })));
  for (const resource of [
    mercos.clientes,
    mercos.produtos,
    mercos.tabelasPreco,
    mercos.produtosTabelaPreco,
    mercos.condicoesPagamento,
    mercos.transportadoras,
    mercos.usuarios,
  ]) {
    await resource.list().next();
  }
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      "/api/v1/clientes",
      "/api/v1/produtos",
      "/api/v1/tabelas_preco",
      "/api/v1/produtos_tabela_preco",
      "/api/v1/condicoes_pagamento",
      "/api/v1/transportadoras",
      "/api/v1/usuarios",
    ],
  );
});

test("StatusPedido compares directly with the status the API returns, which is a string", () => {
  const [pedido] = fixture("get_v2_pedidos").responses["200"] as Pedido[];
  assert.equal(pedido!.status, StatusPedido.Gerado);
  assert.equal(StatusPedido.Orcamento, "1");
});
