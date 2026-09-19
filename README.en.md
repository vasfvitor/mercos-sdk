# mercos-sdk

An **unofficial** TypeScript SDK for the [Mercos integration API](https://docs.mercos.com).
Mercos is a Brazilian B2B ordering platform. The SDK uses only native `fetch`, has no runtime
dependencies, and handles the two behaviors that the Mercos approval review checks:
pagination and throttling.

[Versão em português](./README.md)

> This project has no affiliation with Mercos. The types come from the public documentation
> and can differ from how the API behaves. Issues and fixes are welcome.

## Install

```sh
npm install mercos-sdk
```

The SDK requires Node 20 or later. It also runs on Deno, Bun, and Cloudflare Workers, because
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

// Check that the API accepts the token pair.
await mercos.tokenStatus();

// Lists are async iterators. Pagination happens underneath.
for await (const cliente of mercos.clientes.list({ alteradoApos: "2024-01-01 00:00:00" })) {
  console.log(cliente.id, cliente.razao_social);
}

// Or collect everything, with the filters that the route accepts.
const quotes = await collect(mercos.pedidos.list({ filtros: { status: StatusPedido.Orcamento } }));

// Creating an order returns the identifier that Mercos sends in the MeusPedidosID header.
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

## What the SDK handles for you

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

Use **one** client per token pair in a process. Two clients don't share a queue.

### Pagination

Mercos lists are incremental. The cursor is `alterado_apos`, and the
`MEUSPEDIDOS_LIMITOU_REGISTROS` header with a value of 1 signals more pages. The iterator:

- Uses the **second-highest** distinct `ultima_alteracao` on the page as the next cursor,
  sent back exactly as the server wrote it, without relying on record order. That field has
  one-second resolution, and a page can end in the middle of a second. Stepping back one
  value makes the next page read the last second again in full. Nothing gets lost, whether
  the server treats `alterado_apos` as strict or inclusive.
- Drops the records that come back repeated because of that step back.
- Throws an error whose `kind` is `"pagination"` when the server promises more pages and
  the whole page shares one `ultima_alteracao` value, because no earlier value exists to
  step back to. Failing loudly beats an infinite loop or silent data loss. For orders, a
  larger `registros_por_pagina` value usually fixes it.

For incremental sync, store the highest `ultima_alteracao` that you received and pass it as
`alteradoApos` on the next run.

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
| `mercos.tokenStatus()`       | Checks the tokens.                            |

Orders use version 2 of the API. The `get` method works only in the sandbox. In production,
Mercos blocks reads by identifier, and the error carries a hint about it.

The `paths` and `operations` types cover **all** 169 documented operations, including routes
that don't have a client method yet.

## Mercos approval review

Before Mercos grants production access, it reviews the integration. The two behaviors that
the review requires, 429 handling and complete pagination, are the defaults in this SDK. The
[approval page](https://docs.mercos.com/reference/homologação) describes the process.

## Open questions

Only sandbox tests with a valid `CompanyToken` can settle these:

- Whether an order created through the API starts as a quote. The create body has no `status`
  field.
- Whether the payment condition is required on create. The prose says yes and the schema says
  no.
- Whether the date format for extra fields in the documentation is a typo.

## Development

```sh
pnpm install
pnpm verify   # lint, type check, and tests
pnpm build    # emits dist/
```

The types in `src/generated/` come from `spec/mercos-openapi.json`. The scripts assemble that
file from the OpenAPI fragments that each documentation page embeds:

```sh
pnpm spec            # fetch the pages, merge, generate the types and the fixtures
pnpm spec:fetch -- --refresh   # ignore the local cache in .cache/docs
```

Manual fixes to the specification live in `spec/patches.json`, each with its reason. To see
what changed in the API, run `pnpm spec` again and read the `git diff` output.

The tests use a fake `fetch` and a fake clock, with no network access. No real company data
enters the repository: the fixtures come from the examples in the public documentation.

## License

[MIT](./LICENSE)
