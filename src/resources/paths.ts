// The single list of routes the SDK covers. The client builds its resources from it, and
// scripts/extract-fixtures.ts picks the fixtures from it, so a new resource goes in one place.
export const PATHS = {
  // Orders use version 2 of the API. Version 1 is deprecated, and only cancel still lives there.
  pedidos: "/v2/pedidos",
  cancelarPedido: "/v1/pedidos/cancelar",
  clientes: "/v1/clientes",
  produtos: "/v1/produtos",
  tabelasPreco: "/v1/tabelas_preco",
  produtosTabelaPreco: "/v1/produtos_tabela_preco",
  condicoesPagamento: "/v1/condicoes_pagamento",
  transportadoras: "/v1/transportadoras",
  usuarios: "/v1/usuarios",
  categorias: "/v1/categorias",
  formasPagamento: "/v1/formas_pagamento",
  // The values of the `status_custom` order filter.
  statusCustom: "/v1/pedidos/status",
  ajustarEstoque: "/v1/ajustar_estoque",
  ajustarEstoqueEmLote: "/v1/ajustar_estoque_em_lote",
  // This route exists only in the documentation prose, with no OpenAPI fragment, so its body is untyped.
  tokenStatus: "/v1/token_auth_status",
} as const;
