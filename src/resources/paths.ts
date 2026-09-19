// Única lista das rotas que o SDK cobre. O cliente monta os recursos daqui e
// scripts/extract-fixtures.ts escolhe as fixtures daqui, então um recurso novo entra num lugar só.
export const PATHS = {
  // Pedidos usam a versão 2 da API. A versão 1 está depreciada e só o cancelamento continua nela.
  pedidos: "/v2/pedidos",
  cancelarPedido: "/v1/pedidos/cancelar",
  clientes: "/v1/clientes",
  produtos: "/v1/produtos",
  tabelasPreco: "/v1/tabelas_preco",
  produtosTabelaPreco: "/v1/produtos_tabela_preco",
  condicoesPagamento: "/v1/condicoes_pagamento",
  transportadoras: "/v1/transportadoras",
  usuarios: "/v1/usuarios",
  // Esta rota só existe na prosa da documentação, sem fragmento OpenAPI, então o corpo fica sem tipo.
  tokenStatus: "/v1/token_auth_status",
} as const;
