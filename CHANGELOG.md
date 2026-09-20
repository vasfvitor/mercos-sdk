# Changelog

This project follows [semantic versioning](https://semver.org/).

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
