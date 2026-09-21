# mercos-sdk

An **unofficial** TypeScript SDK for the [Mercos integration API](https://docs.mercos.com).
Mercos is a Brazilian B2B ordering platform. The SDK uses native `fetch`, with no runtime
dependencies. It handles 429 responses and pagination, the two behaviors that the
[Mercos approval review](https://docs.mercos.com/reference/homologação) checks before it grants
production access.

[Versão em português](./README.md)

> This project has no affiliation with Mercos. The types come from the public documentation
> and can differ from how the API behaves.

## Install

```sh
npm install mercos-sdk
```

The SDK requires Node 22 or later. It also runs on Deno, Bun, and Cloudflare Workers, because
it depends only on `fetch`, `URLSearchParams`, and `AbortSignal`.

## Usage

Method names are in English. Resource names, field names, and filter names stay in
Portuguese, exactly as the API spells them.

```ts
import { collect, createMercos, MercosError, StatusPedido } from "mercos-sdk";

const mercos = createMercos({
  applicationToken: process.env.MERCOS_APPLICATION_TOKEN!,
  companyToken: process.env.MERCOS_COMPANY_TOKEN!,
  environment: "sandbox", // or "production", after the approval review
});

await mercos.tokenStatus();

// Pagination happens inside the iterator.
for await (const cliente of mercos.clientes.list({ changedAfter: "2024-01-01 00:00:00" })) {
  console.log(cliente.id, cliente.razao_social);
}

const quotes = await collect(mercos.pedidos.list({ filters: { status: StatusPedido.Orcamento } }));

// The ID comes from the MeusPedidosID header.
try {
  const { id, numero, itens } = await mercos.pedidos.create({
    cliente_id: 7172892,
    data_emissao: "2024-10-31",
    itens: [{ produto_id: 19176097, quantidade: 20, preco_tabela: 48.6 }],
  });
} catch (error) {
  if (error instanceof MercosError && error.kind === "validation") {
    for (const { campo, mensagem } of error.fieldErrors) console.error(campo, mensagem);
  }
}
```

## Server-side only

The Mercos API rejects CORS preflight requests, so it doesn't work from a browser. The two
tokens also grant full access to the account and must never reach the client. The SDK refuses
to start when it detects a browser. Call it from your backend, and expose to the browser only
the routes that your app needs.

## Behavior

### Throttling

The Mercos request limit is global across all routes. For that reason, each client that
`createMercos` returns sends one request at a time, even when you start several in parallel.
On a 429 response, the SDK waits for the reported `tempo_ate_permitir_novamente` plus half a
second, and then sends the request again. The queue stays paused during the wait.

Two limits hand control back to you, with a `MercosError` whose `kind` is `"rate_limit"` and
a `retryAfterSeconds` field:

| Option           | Default | Meaning                                              |
| ---------------- | ------- | ---------------------------------------------------- |
| `maxRetries`     | 5       | Retries of the same request after a 429 response.    |
| `maxWaitSeconds` | 60      | Longest wait accepted for a single 429, in seconds.  |

Use one client per token pair in a process. Two clients don't share a queue.

The `minIntervalMs` option sets the shortest time between the starts of two requests. It
defaults to 0. On 2026-09-20 the sandbox account allowed one request about every 5.5 seconds.
Six reads in a row got five 429 responses with no interval, and none with 5500 ms or more. The
spaced run was also faster, 28 seconds against 33, and sent half the requests. The limit of a
production account may differ, so measure it with `onAttempt` before you choose a value.

### Observing requests

The `onAttempt` option is called after every HTTP attempt, retries included. Use it for the
request log that the Mercos approval review asks for, or for metrics.

```ts
const mercos = createMercos({
  applicationToken,
  companyToken,
  minIntervalMs: 6000,
  onAttempt({ method, route, status, attempt, durationMs, retryInSeconds }) {
    console.log(method, route, status, `attempt ${attempt}`, `${durationMs} ms`, retryInSeconds ?? "");
  },
});
```

The event has `method`, `path` as sent, `route` with each numeric segment as `{id}`, `attempt`
starting at 1, `status`, `durationMs`, and `retryInSeconds` when another attempt follows. The
`status` is `undefined` for a network failure or a timeout, and `error` says which of the two
it was. The event has no body, query, or
header, so logging it can't leak a token or customer data. An error that the function throws is
ignored.

### Timeouts and transient failures

Every attempt has a time limit, 30 seconds by default. A request that never answers would
otherwise hold the queue, and every later call with it. When the limit passes, the call fails
with a `MercosError` whose `kind` is `"timeout"`. Set `timeoutMs` in `createMercos`, or for one
call: `mercos.pedidos.get(55, { timeoutMs: 5000 })`. Zero turns the limit off.

A read (`GET`) that fails on the network, times out, or gets a 502, 503, or 504 is sent again
up to twice. The first retry waits 1 second and the second waits 2. A write is never sent again: the first attempt may
have created the order even though no response arrived. Setting `maxRetries` to 0 also turns
these retries off.

### Pagination

Mercos lists are incremental. The cursor is `alterado_apos`, and the
`MEUSPEDIDOS_LIMITOU_REGISTROS` header with a value of 1 signals more pages. The iterator:

- Uses the second-highest distinct `ultima_alteracao` on the page as the next cursor, sent
  back as the server wrote it. That field has one-second resolution, and a page can end in the
  middle of a second. With the step back, the next page reads the last second again in full,
  whether the server treats `alterado_apos` as strict or inclusive.
- Drops the records that come back repeated because of that step back.
- Throws an error whose `kind` is `"pagination"` when the server promises more pages and
  the whole page shares one `ultima_alteracao` value, because no earlier value exists to
  step back to. For orders, a larger `registros_por_pagina` value usually fixes it.

For incremental sync, store the highest `ultima_alteracao` that you received and pass it as
`changedAfter` on the next run.

`listPages` does the same walk as `list` and yields one array per request, with the repeats
already dropped. Use it to save progress after each page.

### Errors

Every error that the SDK throws is a `MercosError`. The `kind` field says what happened:

| `kind`                | When                                                            |
| --------------------- | --------------------------------------------------------------- |
| `auth`                | 401 or 403: missing, invalid, or unauthorized tokens.           |
| `validation`          | 400, 412, or 422. See `fieldErrors`.                            |
| `not_found`           | 404.                                                            |
| `rate_limit`          | 429 beyond the configured limits.                               |
| `server`              | 5xx.                                                            |
| `network`             | The `fetch` call failed. The original error is in `cause`.      |
| `timeout`             | No response within `timeoutMs`.                                 |
| `unexpected_response` | A response outside the contract, such as a 201 with no header.  |
| `pagination`          | The cursor didn't advance.                                      |
| `config`              | Invalid options passed to `createMercos`.                       |

The API returns `erros` in four different formats depending on the route. The SDK normalizes
all of them into `fieldErrors: { campo?: string; mensagem: string }[]`.

Tokens never appear in error messages. If the API echoes a token in a response body, the SDK
masks it before it builds the error.

## Covered resources

| Resource                     | Operations                                    |
| ---------------------------- | --------------------------------------------- |
| `mercos.pedidos`             | `list`, `get`, `create`, `update`, `cancel`   |
| `mercos.clientes`            | `list`, `get`, `create`, `update`             |
| `mercos.produtos`            | `list`, `get`, `create`, `update`             |
| `mercos.tabelasPreco`        | `list`, `get`                                 |
| `mercos.produtosTabelaPreco` | `list`, `get`                                 |
| `mercos.condicoesPagamento`  | `list`, `get`                                 |
| `mercos.transportadoras`     | `list`, `get`                                 |
| `mercos.usuarios`            | `list`, `get`                                 |
| `mercos.categorias`          | `list`, `get`, `create`, `update`             |
| `mercos.formasPagamento`     | `list`, `get`, `create`, `update`             |
| `mercos.statusCustom`        | `list`, `get`, `create`, `update`             |
| `mercos.estoque`             | `adjust`, `adjustMany`                        |
| `mercos.tokenStatus()`       | Checks the tokens.                            |

Every method takes an options object as its last argument. It holds `timeoutMs` and `signal`,
an `AbortSignal` that cancels the request even while it waits in the queue:
`mercos.pedidos.get(55, { signal })`.

Orders use version 2 of the API. The `get` method works only in the sandbox. In production,
Mercos blocks reads by identifier, and the error carries a hint about it.

Every resource also has `listPages` and `find`. The `find` method reads one record through the
list, so it works in production: `mercos.pedidos.find(55, { since: "2026-09-20 00:00:00" })`. It
returns `undefined` when no record with that ID changed after `since`. It sends the same
requests in both environments, so the sandbox tests what production runs.

`since` and `changedAfter` take a string or a `Date`. A string goes out as it is. Mercos writes
`ultima_alteracao` in Brazilian time, so a `Date` is converted to that zone. The
`mercosTimestamp(date)` function does the same conversion for your own use.

The response to an order create has no total, and Mercos adds taxes that the sent items don't
show. `mercos.pedidos.createAndRead(pedido)` creates the order and returns it as Mercos saved
it, found through the list of the last hour. When the order is created and the read fails, the
`MercosError` has the order's ID in `createdId`. The order exists, so read it with `find` and
don't create it again.

The `statusCustom` resource holds the custom order statuses, the values of the `status_custom`
filter. The `estoque.adjust` method sets the product's balance to `novo_saldo`. It doesn't add or
subtract. When the account has stock control turned off, Mercos refuses the adjustment with 422.
The `estoque.adjustMany` method takes at most 300 adjustments, the Mercos limit for one request,
and one bad adjustment cancels the whole batch.

`produtos.create`, `produtos.update`, `pedidos.create`, and `pedidos.update` also take the grid
bodies that Mercos documents on the same routes. `ProdutoInput` and `PedidoInput` are unions of
the plain body and the grid ones. For a grid product, `produtos.create` also returns
`produtos_grade`. That list has each child's ID and code. Mercos refuses a stock adjustment on
the parent, so those are the IDs that `estoque.adjust` takes.

The `paths` and `operations` types cover the 169 documented operations.

## Other routes

Three generic methods reach the routes that have no named resource. They go through the same
queue, retries, pagination, and errors as the named resources.

```ts
const titulos = mercos.resource("/v1/titulos");
const titulo = { cliente_id: 7, data_vencimento: "2026-01-31", numero_documento: "A-1", valor: 10.5 };
const { id } = await titulos.create(titulo);
await titulos.update(id, { ...titulo, valor: 12 });

for await (const etapa of mercos.list("/v1/funil/{funil_id}/etapas", { params: { funil_id: 3 } })) {
  console.log(etapa.titulo);
}

const { data, headers } = await mercos.request("POST", "/v1/clientes_tabela_preco/liberar_todas", {
  body: { cliente_id: 7 },
});
```

- `resource(path)` returns `list`, `get`, `create`, and `update` for a path with no parameters.
  Its `create` returns `{ id, data }`. The `id` is `undefined` on routes that create no single
  record, such as the batch routes.
- `list(path)` walks any path whose GET returns a list. It takes `changedAfter`, `filters`, and
  `params` for the `{name}` segments of the path.
- `request(method, path)` sends one request and returns `status`, `headers`, and `data`.

A documented path completes in the editor, and its schema types the parameters, the body, and
the result. The schemas are a reconstruction of the documentation and can be wrong. To skip
them, type the path as a `string`: `mercos.request("PUT", path as string, { body })`. The same
goes for a route that Mercos adds later.

## Verified in the sandbox

Tested on 2026-09-19 against `sandbox.mercos.com`, where the documentation was ambiguous:

- An order created through the API starts as `StatusPedido.Gerado` (`"2"`), not as a quote. The
  create body doesn't accept `status`.
- The payment condition is required on create: either `condicao_pagamento_id` or the free-text
  `condicao_pagamento`. Without one of them the API responds 422, even though the schema marks
  neither as required.
- The date of an extra field goes as `yyyy-mm-dd`. The `yyyy-dd-mm` in the documentation is a
  typo: the API rejects it with 422 and names the format `%Y-%m-%d`.
- The API never creates a quote. An order created through it starts as `StatusPedido.Gerado`,
  and both `/v2/pedidos` and `/v1/pedidos` answer 422 to a `status` field. That holds for the
  create and for the update. A quote, status `"1"`, comes only from the Mercos screens. Measured on 2026-09-21.
- In an order update, an item with its `id` changes that item, and an item with no `id` is added,
  even when the product is already in the order. The documented schema of the update leaves the
  item `id` out, and the `PedidoUpdate` type has it. An item with `id` and `excluido: true` is
  removed, and still comes back on a read, marked `excluido: true`. The update is partial: an
  item that the body doesn't name stays as it is. Measured by the `estoque_fratini` app.
- Mercos adds the IPI of the product record to each order item, even when the item sends no
  `ipi`. Measured on 2026-09-20 by the `estoque_fratini` app:

  | Item                     | Sent                     | Subtotal in Mercos | How it adds up      |
  | ------------------------ | ------------------------ | ------------------ | ------------------- |
  | IPI 5%, type `P`         | 3 × 400, 10% discount    | 1134               | 3 × 360 × 1.05      |
  | IPI 12.50, type `V`      | 4 × 200, 10% discount    | 770                | 4 × 180 + 4 × 12.50 |
  | No IPI                   | 2 × 150                  | 300                | 2 × 150             |

  A percent IPI applies after the discount. A fixed IPI is per unit, and the discount doesn't
  reduce it. Rounding to cents happens on the item subtotal. A screen that adds up only price,
  quantity, and discount shows less than the real total, so read the order back.
- The `st` of the product record didn't enter the order: the items came back with `st: 0`. The
  reason is unknown.
- On a read, an absent value comes as `0` or `""`, not as `null`: `tabela_preco_id: 0`,
  `transportadora_id: 0`, `observacoes: ""`. The SDK never rewrites response data, so treat a
  `0` in an ID field as absent.
- The documentation writes `alterado_apos` as `2024-04-10T15:45:00`. Most routes take that, and
  `/v1/divisoes` answers 422 to it: it demands the space, `2024-04-10 15:45:00`. Every route that
  the sandbox has took the space, so the SDK always sends it, and turns a `T` in your string into
  one.
- The API has no route for the company's own data: no logo and no CNPJ. An order carries
  `representada_id`, `representada_nome_fantasia`, and `representada_razao_social`, and
  `token_auth_status` answers with an empty body.
- Mercos writes `ultima_alteracao` in Brazilian time. On 2026-09-20 a change made at 00:12 UTC
  came back stamped 21:12.
- A fractional quantity, such as 1.5, and an item with no `tabela_preco_id` are accepted.
- On 2026-09-20, the order list and the read by ID returned the same 47 fields. Each documented
  schema leaves some out: the list has no `itens`, and the read by ID has no customer fields. The
  `Pedido` type joins the two.

## Development

```sh
pnpm install
pnpm verify   # lint, type check, specification lint, and tests
pnpm build    # emits dist/
```

The types in `src/generated/` come from `spec/mercos-openapi.json`. The scripts assemble that
file from the OpenAPI fragments that each documentation page embeds:

```sh
pnpm spec            # fetch the pages, merge, generate the types and the fixtures
pnpm spec:fetch -- --refresh   # ignore the local cache in .cache/docs
```

`pnpm spec:lint` checks that the merged file is a
structurally valid OpenAPI document, and it's part of `pnpm verify`. `pnpm spec:check` asks the
documentation site, with a single request, whether Mercos changed anything since the last
`pnpm spec`. It exits with 1 when it did.

Manual fixes to the specification live in `spec/patches.json`, each with its reason. To see
what changed in the API, run `pnpm spec` again and read the `git diff` output.

The merge script also repairs two flaws that repeat across the pages. When a page declares an
object and its own example shows a list, or the reverse, the example wins. When two pages
document the same route with different bodies, the bodies become one `oneOf`.

The tests use a fake `fetch` and a fake clock, with no network access. The fixtures come from
the examples in the public documentation.

A second suite runs against the real sandbox. It skips itself unless both variables exist, and
it cancels the order that it creates:

```sh
MERCOS_APPLICATION_TOKEN=... MERCOS_COMPANY_TOKEN=... pnpm test:live
```

## Releasing

1. Write the changes under a `## Unreleased` heading in `CHANGELOG.md`, and commit.
2. Run `pnpm release patch`, or `minor`, or `major`, or an exact version. It sets the version,
   turns the heading into the version and the date, runs `pnpm verify`, commits, tags, and pushes
   the branch and the tag together. Add `--dry-run` to see the steps only.
3. Approve the version on npmjs.com, in the package's staging queue. With two versions in the
   queue, approve them in version order: `latest` follows the last approval.

The pushed tag starts the release workflow. It stages the version on npm with a provenance
statement, and it creates the GitHub release from the changelog entry. Nobody can install
it until the approval, which requires two-factor authentication. The workflow stores no npm
token: on npmjs.com, the package lists this repository and `release.yml` as its trusted
publisher.

## License

[MIT](./LICENSE)
