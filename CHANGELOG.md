# Changelog

Este projeto segue o [versionamento semântico](https://semver.org/lang/pt-BR/).

## 0.1.0 - não publicado

Primeira versão.

- Cliente `createMercos` com `fetch` nativo e sem dependências de runtime.
- Fila única por cliente e repetição automática do 429, com teto de espera e de repetições.
- Iterador de paginação sobre `alterado_apos`, com descarte de repetidos e guarda de cursor.
- `MercosError` com `kind` e normalização dos quatro formatos de `erros`.
- Recursos: pedidos, clientes, produtos, tabelas de preço, preços por tabela, condições de
  pagamento, transportadoras, usuários e conferência de tokens.
- Tipos das 169 operações documentadas, gerados a partir de `spec/mercos-openapi.json`.
