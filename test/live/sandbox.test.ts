// Live tests against sandbox.mercos.com. They run only through `pnpm test:live`, and only when both
// token variables exist, so `pnpm test` and CI never touch the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Cliente,
  createMercos,
  MercosError,
  type PedidoInput,
  type Produto,
  StatusPedido,
} from "../../src/index.ts";
import { rejectsWith } from "../helpers.ts";

const applicationToken = process.env.MERCOS_APPLICATION_TOKEN;
const companyToken = process.env.MERCOS_COMPANY_TOKEN;
const skip = applicationToken && companyToken ? false : "set MERCOS_APPLICATION_TOKEN and MERCOS_COMPANY_TOKEN";
const mercos = createMercos({ applicationToken: applicationToken ?? "unset", companyToken: companyToken ?? "unset" });

async function firstLive<T extends { excluido?: boolean }>(source: AsyncIterable<T>, what: string): Promise<T> {
  for await (const record of source) if (!record.excluido) return record;
  throw new Error(`The sandbox account has no ${what}. Create one in the Mercos interface first.`);
}

test("the sandbox accepts the token pair", { skip }, async () => {
  await mercos.tokenStatus();
});

test("an unknown CompanyToken is an auth error", { skip }, async () => {
  const stranger = createMercos({
    applicationToken: applicationToken!,
    companyToken: "00000000-0000-0000-0000-000000000000",
  });
  await assert.rejects(stranger.tokenStatus(), rejectsWith("auth"));
});

test("listing products walks every page without repeating a record", { skip }, async () => {
  const ids: number[] = [];
  for await (const produto of mercos.produtos.list()) {
    assert.equal(typeof produto.id, "number");
    assert.match(produto.ultima_alteracao, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    ids.push(produto.id);
  }
  assert.ok(ids.length > 0, "the sandbox account has no products");
  assert.equal(new Set(ids).size, ids.length);
});

test("an order goes from rejected to created to cancelled", { skip }, async (t) => {
  const cliente = await firstLive<Cliente>(mercos.clientes.list(), "customers");
  const produto = await firstLive<Produto>(mercos.produtos.list(), "products");
  const pedido = {
    cliente_id: cliente.id,
    data_emissao: new Date().toISOString().slice(0, 10),
    observacoes: "mercos-sdk live test",
    itens: [{ produto_id: produto.id, quantidade: 1, preco_tabela: produto.preco_tabela ?? 1 }],
  } satisfies PedidoInput;

  await t.test("without a payment condition the API answers 422", async () => {
    await assert.rejects(
      mercos.pedidos.create(pedido),
      rejectsWith("validation", (error) => {
        assert.match(error.fieldErrors[0]!.mensagem, /condicao_pagamento/);
        assert.equal(error.fieldErrors[0]!.campo, undefined);
      }),
    );
  });

  const created = await mercos.pedidos.create({ ...pedido, condicao_pagamento: "A vista" });
  try {
    assert.equal(created.itens.length, 1);
    const read = await mercos.pedidos.get(created.id);
    assert.equal(read.status, StatusPedido.Gerado);
    assert.equal(read.itens?.[0]?.produto_id, produto.id);
  } finally {
    await mercos.pedidos.cancel(created.id);
  }
  assert.equal((await mercos.pedidos.get(created.id)).status, StatusPedido.Cancelado);
});

test("the new catalog lists answer with arrays of records", { skip }, async () => {
  for (const resource of [mercos.categorias, mercos.formasPagamento, mercos.statusCustom]) {
    for await (const record of resource.list()) {
      assert.equal(typeof record.id, "number");
      break;
    }
  }
});

test("a stock adjustment sets the balance, and the old balance goes back", { skip }, async (t) => {
  const produto = await firstLive<Produto>(mercos.produtos.list(), "products");
  const before = produto.saldo_estoque ?? 0;
  const during = before + 1;
  try {
    await mercos.estoque.adjust({ produto_id: produto.id, novo_saldo: during });
  } catch (error) {
    // Stock control is an account setting. With it off, the API refuses every adjustment with a 422.
    if (error instanceof MercosError && /controle de estoque/.test(error.message))
      return t.skip("turn on stock control in the sandbox account");
    throw error;
  }
  try {
    assert.equal((await mercos.produtos.get(produto.id)).saldo_estoque, during);
    const echoed = await mercos.estoque.adjustMany([{ produto_id: produto.id, novo_saldo: during + 1 }]);
    assert.deepEqual(echoed, [{ produto_id: produto.id, novo_saldo: during + 1 }]);
  } finally {
    await mercos.estoque.adjust({ produto_id: produto.id, novo_saldo: before });
  }
  assert.equal((await mercos.produtos.get(produto.id)).saldo_estoque, before);
});
