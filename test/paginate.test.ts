import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, StatusPedido } from "../src/index.ts";
import { fake, fixture, LIMITED, rejectsWith } from "./helpers.ts";

const registro = (id: number, ultima_alteracao: string) => ({ id, ultima_alteracao });

test("três páginas: página fora de ordem, repetidos descartados e cursor exato do servidor", async () => {
  const { mercos, calls } = fake([
    // Fora de ordem de propósito: o cursor sai dos instantes da página, não da posição do último registro.
    {
      body: [
        registro(2, "2024-01-02 10:00:00"),
        registro(3, "2024-01-03 10:00:00"),
        registro(1, "2024-01-01 10:00:00"),
      ],
      headers: LIMITED,
    },
    // O cursor recuou para o penúltimo instante, então o registro 3 volta e é descartado.
    { body: [registro(3, "2024-01-03 10:00:00"), registro(4, "2024-01-04 10:00:00")], headers: LIMITED },
    { body: [registro(5, "2024-01-05 10:00:00")] },
  ]);

  const clientes = await collect(mercos.clientes.list());

  assert.deepEqual(
    clientes.map((cliente) => cliente.id),
    [2, 3, 1, 4, 5],
  );
  assert.deepEqual(
    calls.map((call) => call.url.searchParams.get("alterado_apos")),
    ["2000-01-01T00:00:00", "2024-01-02 10:00:00", "2024-01-03 10:00:00"],
  );
});

test("registro alterado de novo entre páginas não é tratado como repetido", async () => {
  const { mercos } = fake([
    { body: [registro(9, "2024-01-01 09:00:00"), registro(1, "2024-01-01 10:00:00")], headers: LIMITED },
    { body: [registro(1, "2024-01-01 10:00:07")] },
  ]);
  assert.equal((await collect(mercos.clientes.list())).length, 3);
});

test("página inteira no mesmo segundo com mais páginas prometidas falha alto", async () => {
  const mesmaHora = [registro(1, "2024-01-01 10:00:00"), registro(2, "2024-01-01 10:00:00")];
  const { mercos, calls } = fake([{ body: mesmaHora, headers: LIMITED }]);
  await assert.rejects(collect(mercos.clientes.list()), rejectsWith("pagination"));
  assert.equal(calls.length, 1);
});

test("registros do mesmo segundo cortados pelo fim da página não se perdem com servidor estrito", async () => {
  // O servidor tem 2, 3 e 4 no mesmo segundo, mas a página 1 acabou antes do 4.
  const { mercos, calls } = fake([
    {
      body: [
        registro(1, "2024-01-01 10:00:00"),
        registro(2, "2024-01-01 10:00:05"),
        registro(3, "2024-01-01 10:00:05"),
      ],
      headers: LIMITED,
    },
    // alterado_apos estrito (>) a partir de 10:00:00: o segundo 10:00:05 volta inteiro.
    {
      body: [
        registro(2, "2024-01-01 10:00:05"),
        registro(3, "2024-01-01 10:00:05"),
        registro(4, "2024-01-01 10:00:05"),
        registro(5, "2024-01-01 10:00:09"),
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

test("cursor inicial com T não gera falso alarme contra o formato com espaço do servidor", async () => {
  const { mercos } = fake([
    { body: [registro(1, "2024-04-10 16:00:00"), registro(2, "2024-04-10 16:30:00")], headers: LIMITED },
    { body: [registro(2, "2024-04-10 16:30:00"), registro(3, "2024-04-10 17:00:00")] },
  ]);
  const clientes = await collect(mercos.clientes.list({ alteradoApos: "2024-04-10T15:45:00" }));
  assert.equal(clientes.length, 3);
});

test("página vazia sem o header encerra sem erro", async () => {
  const { mercos, calls } = fake([{ body: [] }]);
  assert.deepEqual(await collect(mercos.produtos.list()), []);
  assert.equal(calls.length, 1);
});

test("resposta que não é lista vira unexpected_response", async () => {
  const { mercos } = fake([{ body: { mensagem: "ops" } }]);
  await assert.rejects(collect(mercos.produtos.list()), rejectsWith("unexpected_response"));
});

test("filtros de pedido vão para a query, com status_custom repetido", async () => {
  const { mercos, calls } = fake([{ body: fixture("get_v2_pedidos").responses["200"] }]);
  const pedidos = await collect(
    mercos.pedidos.list({
      alteradoApos: "2024-01-01 00:00:00",
      filtros: { status: StatusPedido.Orcamento, status_custom: [0, 4], registros_por_pagina: 15 },
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

test("o iterador é preguiçoso: parar cedo não busca a página seguinte", async () => {
  const { mercos, calls } = fake([
    { body: [registro(1, "2024-01-01 10:00:00"), registro(2, "2024-01-02 10:00:00")], headers: LIMITED },
    { body: [registro(3, "2024-01-03 10:00:00")] },
  ]);
  for await (const cliente of mercos.clientes.list()) {
    assert.equal(cliente.id, 1);
    break;
  }
  assert.equal(calls.length, 1);
});
