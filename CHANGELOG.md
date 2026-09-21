# Changelog

This project follows [semantic versioning](https://semver.org/).

## 0.4.1 - Unreleased

- When `pedidos.createAndRead` creates the order and then fails to read it, the error now has the
  order's ID in the new `createdId` field of `MercosError`. Before, a failed read lost the ID.
- `since` and `changedAfter` now also take a `Date`, converted to Brazilian time, which is the zone
  of `ultima_alteracao`. The new `mercosTimestamp` function does the same conversion.
- The `onAttempt` event has a new `error` field: `"network"` or `"timeout"` when no response came.
- `produtos.create` now returns `produtos_grade`, a list with the ID and the code of each child of
  a grid product. Those are the IDs that take a stock adjustment. The list is empty for a plain product.

## 0.4.0 - 2026-09-20

- New `onAttempt` option: a function called after every HTTP attempt, with the method, the route,
  the status, the duration, the attempt number, and the wait before the next attempt.
- New `minIntervalMs` option: the shortest time between the starts of two requests.
- New `listPages` on every resource and on the client: the same walk as `list`, one array per
  request.
- New `find` on every resource: one record by ID through the list, which works in production.
- New `pedidos.createAndRead`: creates the order and returns it as Mercos saved it, with the total.
- Fixed: the token mask no longer touches the data of a good response. It applies only to what
  feeds an error. Before, a field name or a value that contained the token text came back changed.
- The client and its resources are now frozen. An assignment over a resource fails where it's
  written. To wrap the client, build a new object around it.

## 0.3.1 - 2026-09-20

- Fixed: the `Pedido` type now has the customer fields that `pedidos.list` returns, such as
  `cliente_razao_social`. Before, it had only the fields of the read by ID.
- New filters: `representada_id` wherever `divisao_id` exists, for accounts with no divisions, and
  `excluido` on `produtos.list`.
- Fixed in the types of the generic methods: `/v2/pedidos` now takes `registros_por_pagina`, a list
  in `status_custom`, and a text or a number in `status` and `status_faturamento`.

## 0.3.0 - 2026-09-20

- New `request`, `list`, and `resource` methods on the client. They reach any route, typed by the
  documented schemas, through the same queue, retries, pagination, and errors as the named
  resources.
- `estoque.adjustMany` now refuses a batch of more than 300 adjustments before it sends anything.
  That's the Mercos limit for one request.
- Fixed in the types: the route that reads one user's rule for one customer named both of its
  path parameters `id`. They're now `usuario_id` and `cliente_id`.

## 0.2.0 - 2026-09-20

- New resources: `categorias`, `formasPagamento`, and `statusCustom`, each with `list`, `get`,
  `create`, and `update`.
- New `estoque` resource with `adjust` for one product and `adjustMany` for a batch.

## 0.1.2 - 2026-09-19

- The release workflow now stages the version on npm, and a maintainer approves it there. It
  doesn't publish directly anymore.
- Version 0.1.1 has a tag and no npm release, because npm refused the direct publish. Its changes
  ship in this version.

## 0.1.1 - 2026-09-19

- Fixed: when the API sends a validation error with an empty field name, as it does for an order
  with no payment condition, the entry in `fieldErrors` now has no `campo`. Before, `campo` was
  an empty string.
- Shorter README text and package description.

## 0.1.0 - 2026-09-19

First version.

- A `createMercos` client built on native `fetch`, with no runtime dependencies.
- A single request queue per client, and automatic retry on 429 responses, with a ceiling on
  the wait and on the retry count.
- A pagination iterator over `alterado_apos` that steps the cursor back so that records in
  the same second aren't lost, and that drops the repeats.
- A time limit on every attempt, 30 seconds by default, and up to two retries of a read after
  a network failure, a timeout, or a 502, 503, or 504. A write is never repeated.
- A `MercosError` class with a `kind` field, which normalizes the four shapes of `erros`.
- Resources: orders, customers, products, price tables, prices per table, payment conditions,
  carriers, users, and a token check.
- Types for the 169 documented operations, generated from `spec/mercos-openapi.json`. Grid
  products and grid orders share the route, and the input type, of the plain ones.
- A live test suite for the sandbox, `pnpm test:live`, that runs only when the tokens exist.
