import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, type ItemOf, type UpdateOf } from "../src/index.ts";
import { fake, LIMITED, rejectsWith, trackConcurrency } from "./helpers.ts";

const TITULO = { cliente_id: 7, data_vencimento: "2026-01-31", numero_documento: "A-1", valor: 10.5 };

test("request fills and encodes path parameters, and sends the query and the body", async () => {
  const { mercos, calls } = fake([{ body: [] }, { body: {} }]);

  await mercos.request("GET", "/v1/funil/{funil_id}/etapas", {
    params: { funil_id: "a/b" },
    query: { alterado_apos: "2024-01-01T00:00:00" },
  });
  await mercos.request("PUT", "/v1/titulos/{id}", { params: { id: 42 }, body: TITULO });

  assert.equal(calls[0]?.url.pathname, "/api/v1/funil/a%2Fb/etapas");
  assert.equal(calls[0]?.url.searchParams.get("alterado_apos"), "2024-01-01T00:00:00");
  assert.equal(calls[1]?.method, "PUT");
  assert.equal(calls[1]?.url.pathname, "/api/v1/titulos/42");
  assert.deepEqual(calls[1]?.body, TITULO);
});

test("a missing path parameter fails before any request", async () => {
  const { mercos, calls } = fake([]);
  const path: string = "/v1/titulos/{id}";
  await assert.rejects(mercos.request("GET", path), rejectsWith("config"));
  await assert.rejects(collect(mercos.list(path)), rejectsWith("config"));
  assert.equal(calls.length, 0);
});

test("list walks the pages of a path with no named resource, and drops the repeat", async () => {
  const titulo = (id: number, ultima_alteracao: string) => ({ ...TITULO, id, ultima_alteracao });
  const { mercos, calls } = fake([
    { body: [titulo(1, "2024-01-01 10:00:00"), titulo(2, "2024-01-02 10:00:00")], headers: LIMITED },
    { body: [titulo(2, "2024-01-02 10:00:00"), titulo(3, "2024-01-03 10:00:00")] },
  ]);

  const titulos = await collect(mercos.list("/v1/titulos", { changedAfter: "2023-12-31T00:00:00" }));

  assert.deepEqual(
    titulos.map((each) => each.id),
    [1, 2, 3],
  );
  assert.equal(calls[0]?.url.pathname, "/api/v1/titulos");
  // The "T" of the documentation goes out as the space that every route takes.
  assert.equal(calls[0]?.url.searchParams.get("alterado_apos"), "2023-12-31 00:00:00");
});

test("resource gives the four methods, and create reads the ID from the header", async () => {
  const { mercos, calls } = fake([
    { status: 201, headers: { MeusPedidosID: "77" } },
    { body: {} },
    { body: { ...TITULO, id: 77 } },
  ]);
  const titulos = mercos.resource("/v1/titulos");

  assert.equal((await titulos.create(TITULO)).id, 77);
  await titulos.update(77, TITULO);
  await titulos.get(77);

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.pathname}`),
    ["POST /api/v1/titulos", "PUT /api/v1/titulos/77", "GET /api/v1/titulos/77"],
  );
});

test("create on a route that answers with no ID returns the body and no ID", async () => {
  const { mercos } = fake([{ body: [{ id: 1 }, { id: 2 }] }]);
  const created = await mercos.resource("/v1/atendimentos").create([]);
  assert.equal(created.id, undefined);
  assert.deepEqual(created.data, [{ id: 1 }, { id: 2 }]);
});

test("two parameters in one path take two values", async () => {
  const { mercos, calls } = fake([{ body: {} }]);
  await mercos.request("GET", "/v1/usuarios_clientes/usuario/{usuario_id}/cliente/{cliente_id}", {
    params: { usuario_id: 10, cliente_id: 99 },
  });
  assert.equal(calls[0]?.url.pathname, "/api/v1/usuarios_clientes/usuario/10/cliente/99");
});

test("a lowercase method on a loose path still reads like a GET: it retries a gateway error", async () => {
  const { mercos, calls } = fake([{ status: 502, body: "" }, { body: { id: 55 } }]);
  const path: string = "/v1/clientes/55";
  const { data } = await mercos.request("get", path);
  assert.deepEqual(data, { id: 55 });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET"],
  );
});

test("generic and named calls share one queue", async () => {
  const { slow, peak } = trackConcurrency({ body: [] });
  const { mercos } = fake([slow, slow, slow]);
  await Promise.all([
    mercos.request("GET", "/v1/segmentos"),
    collect(mercos.clientes.list()),
    collect(mercos.list("/v1/redes")),
  ]);
  assert.equal(peak(), 1);
});

test("a path typed as a plain string skips the schema", async () => {
  const { mercos, calls } = fake([{ body: { anything: true } }]);
  const path: string = "/v9/not_documented/{id}";
  const { data } = await mercos.request("PATCH", path, { params: { id: 1 }, body: { free: "form" } });
  assert.deepEqual(data, { anything: true });
  assert.equal(calls[0]?.url.pathname, "/api/v9/not_documented/1");
});

// Compile-time checks: `pnpm check` fails when one of these stops holding. Nothing here runs.
export async function typeChecks() {
  const { mercos } = fake([]);

  const [item] = await collect(mercos.list("/v1/titulos"));
  const listed: ItemOf<"/v1/titulos"> | undefined = item;
  const valor: number | undefined = listed?.valor;
  // The by-ID sibling of this path names its parameter `{tag_id}`, and the update type still resolves.
  const tag: UpdateOf<"/v1/tags_de_clientes"> = { nome: "VIP" };
  const { data } = await mercos.request("GET", "/v1/titulos/{id}", { params: { id: 1 } });
  const documento: string | undefined = data.numero_documento;

  // The spec patches: the prose of the pages documents these filters, and the schemas left them out.
  mercos.list("/v2/pedidos", { filters: { status_custom: [0, 4], registros_por_pagina: 15, status: "2" } });
  mercos.list("/v1/produtos", { filters: { excluido: false, representada_id: 1 } });
  mercos.produtos.list({ filters: { excluido: false, representada_id: 1 } });
  for await (const pedido of mercos.pedidos.list({ filters: { representada_id: 1 } })) {
    // The list schema has the customer fields, and the read-by-ID schema has the items.
    const merged: [string | undefined, number] = [pedido.cliente_razao_social, pedido.itens?.length ?? 0];
    return merged;
  }

  // @ts-expect-error: the update type resolved to the schema, not to `unknown`.
  const notATag: UpdateOf<"/v1/tags_de_clientes"> = 5;
  // @ts-expect-error: the path has a parameter, so `params` is required.
  await mercos.request("GET", "/v1/titulos/{id}");
  // @ts-expect-error: `valor` is a number.
  await mercos.request("POST", "/v1/titulos", { body: { ...TITULO, valor: "10" } });
  // @ts-expect-error: the specification documents no DELETE for this path.
  await mercos.request("DELETE", "/v1/titulos");
  // @ts-expect-error: `resource` takes only paths with no parameters.
  mercos.resource("/v1/funil/{funil_id}/etapas");
  // @ts-expect-error: `cliente_id` is required.
  await mercos.resource("/v1/titulos").create({ valor: 1 });

  return [valor, tag, documento, notATag];
}
