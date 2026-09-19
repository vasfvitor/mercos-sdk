// Values that the Mercos documentation describes only in prose, so the generated types lack them.
// Names stay in Portuguese because they are the API's own vocabulary.

// Statuses are strings because that is how the API returns them ("status": "2"). In a filter
// query the value travels as text anyway, so the same constant works in both directions.

/** Order `status`. A quote is an order with status "1". */
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

/** `tipo_ipi`: whether the `ipi` field is a percentage or a fixed amount in reais. */
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
