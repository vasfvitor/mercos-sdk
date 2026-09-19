# Changelog

This project follows [semantic versioning](https://semver.org/).

## 0.1.0 - unreleased

First version.

- A `createMercos` client built on native `fetch`, with no runtime dependencies.
- A single request queue per client, and automatic retry on 429 responses, with a ceiling on
  the wait and on the retry count.
- A pagination iterator over `alterado_apos` that steps the cursor back so that records in
  the same second aren't lost, and that drops the repeats.
- A `MercosError` class with a `kind` field, which normalizes the four shapes of `erros`.
- Resources: orders, customers, products, price tables, prices per table, payment conditions,
  carriers, users, and a token check.
- Types for the 169 documented operations, generated from `spec/mercos-openapi.json`.
