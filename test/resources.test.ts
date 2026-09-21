import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AjusteEstoque,
  type CategoriaInput,
  type Pedido,
  type PedidoInput,
  type ProdutoInput,
  StatusPedido,
} from "../src/index.ts";
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

test("produtos.create takes the grid body on the same route as a plain product", async () => {
  const example = fixture("post_v1_produtos_grade_v3");
  // The documented example of the grid page. The fixture of this route keeps an example with an empty list.
  const created = { id: 20325477, produtos_grade: [{ id: 20325478, codigo: "GV001" }] };
  const { mercos, calls } = fake([
    { status: 201, headers: { MeusPedidosID: String(created.id) }, body: created },
    { status: 201, headers: { MeusPedidosID: "31" } },
  ]);

  // No cast on the literal: the grid body is one of the shapes of `ProdutoInput`.
  const grid: ProdutoInput = { nome: "Camiseta", preco_tabela: 50, produtos_grade: [{ codigo: "P-AZUL" }] };
  assert.ok("produtos_grade" in grid);
  // The children's IDs are the ones that take a stock adjustment, so `create` keeps them.
  assert.deepEqual(await mercos.produtos.create(example.request as ProdutoInput), created);
  assert.equal(calls[0]!.url.pathname, "/api/v1/produtos");
  assert.deepEqual(calls[0]!.body, example.request);
  // A plain product answers with no body, and gets an empty list.
  assert.deepEqual(await mercos.produtos.create({ nome: "Caneta", preco_tabela: 2 }), { id: 31, produtos_grade: [] });
});

test("each catalog resource lists on the right path", async () => {
  const { mercos, calls } = fake(Array.from({ length: 10 }, () => ({ body: [] })));
  for (const resource of [
    mercos.clientes,
    mercos.produtos,
    mercos.tabelasPreco,
    mercos.produtosTabelaPreco,
    mercos.condicoesPagamento,
    mercos.transportadoras,
    mercos.usuarios,
    mercos.categorias,
    mercos.formasPagamento,
    mercos.statusCustom,
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
      "/api/v1/categorias",
      "/api/v1/formas_pagamento",
      "/api/v1/pedidos/status",
    ],
  );
});

test("categorias.create posts the documented body, and statusCustom.update puts under the nested path", async () => {
  const example = fixture("post_v1_categorias");
  const { mercos, calls } = fake([{ status: 201, headers: { MeusPedidosID: "39" } }, { body: {} }]);

  assert.deepEqual(await mercos.categorias.create(example.request as CategoriaInput), { id: 39 });
  await mercos.statusCustom.update(3, { nome: "Em transporte" });

  assert.deepEqual([calls[0]!.method, calls[0]!.url.pathname], ["POST", "/api/v1/categorias"]);
  assert.deepEqual(calls[0]!.body, example.request);
  assert.deepEqual([calls[1]!.method, calls[1]!.url.pathname], ["PUT", "/api/v1/pedidos/status/3"]);
});

test("estoque.adjust puts one balance with no ID in the path, and adjustMany posts the list", async () => {
  const batch = fixture("post_v1_ajustar_estoque_em_lote").responses["200"] as AjusteEstoque[];
  const { mercos, calls } = fake([{ body: fixture("put_v1_ajustar_estoque").responses["200"] }, { body: batch }]);

  assert.equal(await mercos.estoque.adjust({ produto_id: 10, novo_saldo: 254.87 }), undefined);
  assert.deepEqual(await mercos.estoque.adjustMany(batch), batch);

  assert.deepEqual([calls[0]!.method, calls[0]!.url.pathname], ["PUT", "/api/v1/ajustar_estoque"]);
  assert.deepEqual(calls[0]!.body, { produto_id: 10, novo_saldo: 254.87 });
  assert.deepEqual([calls[1]!.method, calls[1]!.url.pathname], ["POST", "/api/v1/ajustar_estoque_em_lote"]);
  assert.deepEqual(calls[1]!.body, batch);
});

test("StatusPedido compares directly with the status the API returns, which is a string", () => {
  const [pedido] = fixture("get_v2_pedidos").responses["200"] as Pedido[];
  assert.equal(pedido!.status, StatusPedido.Gerado);
  assert.equal(StatusPedido.Orcamento, "1");
});

test("estoque.adjustMany refuses more than 300 adjustments before any request", async () => {
  const { mercos, calls } = fake([]);
  const ajustes = Array.from({ length: 301 }, (_, index) => ({ produto_id: index + 1, novo_saldo: 1 }));
  await assert.rejects(mercos.estoque.adjustMany(ajustes), rejectsWith("config"));
  assert.equal(calls.length, 0);
});
