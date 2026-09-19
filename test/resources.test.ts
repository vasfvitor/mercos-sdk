import assert from "node:assert/strict";
import { test } from "node:test";
import { type Pedido, type PedidoInput, StatusPedido } from "../src/index.ts";
import { fake, fixture, rejectsWith } from "./helpers.ts";

test("pedidos.create devolve o ID do header MeusPedidosID como número, mais os IDs dos itens", async () => {
  const exemplo = fixture("post_v2_pedidos");
  const { mercos, calls } = fake([
    { status: 201, body: exemplo.responses["201"], headers: { MeusPedidosID: "2079512" } },
  ]);

  const criado = await mercos.pedidos.create(exemplo.request as PedidoInput);

  assert.deepEqual(criado, {
    id: 2079512,
    numero: 1105,
    itens: [{ id: 15220248 }, { id: 15220249 }, { id: 15220250 }],
  });
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url.pathname, "/api/v2/pedidos");
  assert.equal(calls[0]!.headers["Content-Type"], "application/json");
  assert.deepEqual(calls[0]!.body, exemplo.request);
});

test("create com 201 de corpo vazio ainda lê o ID do header", async () => {
  const { mercos } = fake([{ status: 201, headers: { MeusPedidosID: "77" } }]);
  assert.deepEqual(await mercos.clientes.create({} as never), { id: 77 });
});

test("create sem header e sem id no corpo é resposta inesperada", async () => {
  const { mercos } = fake([{ status: 201, body: {} }]);
  await assert.rejects(mercos.clientes.create({} as never), rejectsWith("unexpected_response"));
});

test("pedidos.update usa PUT na v2 e pedidos.cancel usa a rota da v1", async () => {
  const { mercos, calls } = fake([{ body: {} }, { body: {} }]);
  await mercos.pedidos.update(55, { observacoes: "novo texto" });
  await mercos.pedidos.cancel(55);

  assert.deepEqual([calls[0]!.method, calls[0]!.url.pathname], ["PUT", "/api/v2/pedidos/55"]);
  assert.deepEqual(calls[0]!.body, { observacoes: "novo texto" });
  assert.deepEqual([calls[1]!.method, calls[1]!.url.pathname], ["POST", "/api/v1/pedidos/cancelar/55"]);
  assert.equal(calls[1]!.body, undefined);
});

test("cada recurso de catálogo lista no caminho certo", async () => {
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

test("StatusPedido compara direto com o status que a API devolve, que é string", () => {
  const [pedido] = fixture("get_v2_pedidos").responses["200"] as Pedido[];
  assert.equal(pedido!.status, StatusPedido.Gerado);
  assert.equal(StatusPedido.Orcamento, "1");
});

test("header MeusPedidosID vazio não bloqueia o id que veio no corpo", async () => {
  const { mercos } = fake([{ status: 201, body: { id: 987 }, headers: { MeusPedidosID: "" } }]);
  assert.deepEqual(await mercos.clientes.create({} as never), { id: 987 });
});
