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

The `statusCustom` resource holds the custom order statuses, the values of the `status_custom`
filter. The `estoque.adjust` method sets the product's balance to `novo_saldo`. It doesn't add or
subtract. When the account has stock control turned off, Mercos refuses the adjustment with 422.
The `estoque.adjustMany` method takes at most 300 adjustments, the Mercos limit for one request,
and one bad adjustment cancels the whole batch.

`produtos.create`, `produtos.update`, `pedidos.create`, and `pedidos.update` also take the grid
bodies that Mercos documents on the same routes. `ProdutoInput` and `PedidoInput` are unions of
the plain body and the grid ones.

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

1. Set the version in `package.json` and date the entry in `CHANGELOG.md`.
2. Publish a GitHub release whose tag is `v` plus that version, such as `v0.1.0`.

3. Approve the version on npmjs.com, in the package's staging queue.

The release workflow stages the version on npm with a provenance statement. Nobody can install
it until the approval, which requires two-factor authentication. The workflow stores no npm
token: on npmjs.com, the package lists this repository and `release.yml` as its trusted
publisher.

## License

[MIT](./LICENSE)
