// Valores que a documentação do Mercos descreve só em prosa, por isso não aparecem nos tipos gerados.

// Os status são strings porque é assim que a API os devolve ("status": "2"). Na query dos
// filtros o valor vai como texto de qualquer forma, então a mesma constante serve para os dois lados.

/** `status` do pedido. Um orçamento é um pedido com status "1". */
export const StatusPedido = {
  Cancelado: "0",
  Orcamento: "1",
  Gerado: "2",
} as const;
export type StatusPedido = (typeof StatusPedido)[keyof typeof StatusPedido];

export const StatusFaturamento = {
  NaoFaturado: "0",
  ParcialmenteFaturado: "1",
  Faturado: "2",
} as const;
export type StatusFaturamento = (typeof StatusFaturamento)[keyof typeof StatusFaturamento];

/** `tipo_ipi`: o campo `ipi` é um percentual ou um valor fixo em reais. */
export const TipoIpi = {
  Percentual: "P",
  ValorFixo: "V",
} as const;
export type TipoIpi = (typeof TipoIpi)[keyof typeof TipoIpi];

export const Moeda = {
  Real: "0",
  Dolar: "1",
  Euro: "2",
  Outra: "3",
} as const;
export type Moeda = (typeof Moeda)[keyof typeof Moeda];

export const TipoCliente = {
  PessoaJuridica: "J",
  PessoaFisica: "F",
} as const;
export type TipoCliente = (typeof TipoCliente)[keyof typeof TipoCliente];

export const TipoTabelaPreco = {
  PrecoLivre: "P",
  Acrescimo: "A",
  Desconto: "D",
} as const;
export type TipoTabelaPreco = (typeof TipoTabelaPreco)[keyof typeof TipoTabelaPreco];
