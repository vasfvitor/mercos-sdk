# mercos-sdk

SDK TypeScript **não oficial** para a [API de integração do Mercos](https://docs.mercos.com).
Usa só o `fetch` nativo, não tem dependências de runtime e já trata as duas exigências da
homologação do Mercos: paginação e throttling.

[English version](./README.en.md)

> Este projeto não tem vínculo com a Mercos. Os tipos saem da documentação pública e podem
> divergir do comportamento real da API. Problemas e correções são bem-vindos.

## Instalação

```sh
npm install mercos-sdk
```

Requer Node 20 ou mais recente. Também roda em Deno, Bun e Cloudflare Workers, porque depende
apenas de `fetch`, `URLSearchParams` e `AbortSignal`.

## Uso

```ts
import { collect, createMercos, MercosError, StatusPedido } from "mercos-sdk";

const mercos = createMercos({
  applicationToken: process.env.MERCOS_APPLICATION_TOKEN!,
  companyToken: process.env.MERCOS_COMPANY_TOKEN!,
  environment: "sandbox", // ou "production", depois da homologação
});

// Confere se o par de tokens é aceito.
await mercos.tokenStatus();

// Listagens são iteradores assíncronos. A paginação acontece por baixo.
for await (const cliente of mercos.clientes.list({ changedAfter: "2024-01-01 00:00:00" })) {
  console.log(cliente.id, cliente.razao_social);
}

// Ou tudo de uma vez, com filtros da rota.
const orcamentos = await collect(mercos.pedidos.list({ filters: { status: StatusPedido.Orcamento } }));

// Criar um pedido devolve o ID que o Mercos manda no header MeusPedidosID.
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

## Só no servidor

A API do Mercos recusa o preflight de CORS, então não funciona a partir do navegador. Além
disso, os dois tokens dão acesso total à conta e não podem chegar ao cliente. O SDK se recusa
a iniciar quando detecta um navegador. Chame-o do seu backend e exponha ao navegador apenas as
rotas de que a sua aplicação precisa.

## O que o SDK trata por você

### Throttling

O limite de requisições do Mercos é global, vale para todas as rotas. Por isso cada cliente
criado com `createMercos` envia uma requisição por vez, mesmo que você dispare várias em
paralelo. Ao receber um 429, o SDK espera o `tempo_ate_permitir_novamente` informado mais meio
segundo e reenvia. A fila fica parada durante a espera.

Dois limites devolvem o controle para você, com um `MercosError` de `kind` igual a
`"rate_limit"` e o campo `retryAfterSeconds`:

| Opção            | Padrão | Significado                                             |
| ---------------- | ------ | ------------------------------------------------------- |
| `maxRetries`     | 5      | Repetições da mesma requisição depois de um 429.        |
| `maxWaitSeconds` | 60     | Espera máxima aceita para um único 429, em segundos.    |

Use **um** cliente por par de tokens no processo. Dois clientes não dividem a fila.

### Paginação

As listagens do Mercos são incrementais. O cursor é `alterado_apos`, e o header
`MEUSPEDIDOS_LIMITOU_REGISTROS` com valor 1 avisa que há mais páginas. O iterador do SDK:

- usa como próximo cursor a **penúltima** `ultima_alteracao` distinta da página, devolvida
  exatamente como o servidor escreveu, sem depender da ordem dos registros. Esse campo tem
  resolução de um segundo, e o corte da página pode cair no meio de um segundo. Recuar um
  instante faz o último segundo ser relido inteiro, então nada se perde, seja o
  `alterado_apos` do servidor estrito ou inclusivo;
- descarta os registros que voltam repetidos por causa desse recuo;
- lança um erro de `kind` igual a `"pagination"` se o servidor prometer mais páginas e a
  página inteira tiver a mesma `ultima_alteracao`, porque aí não há para onde recuar. Falhar
  alto é melhor do que entrar em laço infinito ou perder dados em silêncio. Em pedidos, um
  `registros_por_pagina` maior costuma resolver.

Para sincronizar de forma incremental, guarde a maior `ultima_alteracao` que você recebeu e
passe-a em `changedAfter` na próxima execução.

### Erros

Todo erro lançado pelo SDK é um `MercosError`. O campo `kind` diz o que aconteceu:

| `kind`                | Quando                                                        |
| --------------------- | ------------------------------------------------------------- |
| `auth`                | 401 ou 403: tokens ausentes, inválidos ou sem permissão.      |
| `validation`          | 400, 412 ou 422. Veja `fieldErrors`.                          |
| `not_found`           | 404.                                                          |
| `rate_limit`          | 429 além dos limites configurados.                            |
| `server`              | 5xx.                                                          |
| `network`             | O `fetch` falhou. A causa original fica em `cause`.           |
| `unexpected_response` | Resposta fora do contrato, como um 201 sem `MeusPedidosID`.   |
| `pagination`          | O cursor não avançou.                                         |
| `config`              | Opções inválidas em `createMercos`.                           |

A API devolve `erros` em quatro formatos diferentes conforme a rota. O SDK normaliza todos
para `fieldErrors: { campo?: string; mensagem: string }[]`.

Os tokens nunca aparecem em mensagens de erro. Se a API ecoar um token no corpo da resposta,
o SDK o mascara antes de montar o erro.

## Recursos cobertos

| Recurso                      | Operações                                     |
| ---------------------------- | --------------------------------------------- |
| `mercos.pedidos`             | `list`, `get`, `create`, `update`, `cancel`   |
| `mercos.clientes`            | `list`, `get`, `create`, `update`             |
| `mercos.produtos`            | `list`, `get`, `create`, `update`             |
| `mercos.tabelasPreco`        | `list`, `get`                                 |
| `mercos.produtosTabelaPreco` | `list`, `get`                                 |
| `mercos.condicoesPagamento`  | `list`, `get`                                 |
| `mercos.transportadoras`     | `list`, `get`                                 |
| `mercos.usuarios`            | `list`, `get`                                 |
| `mercos.tokenStatus()`       | Confere os tokens.                            |

Todo método recebe um objeto de opções como último argumento. Hoje ele tem `signal`, um
`AbortSignal` que cancela a requisição mesmo enquanto ela espera na fila:
`mercos.pedidos.get(55, { signal })`.

Pedidos usam a versão 2 da API. `get` por ID só funciona no sandbox: em produção o Mercos
bloqueia essa leitura, e o erro traz uma dica a respeito.

`produtos.create`, `produtos.update`, `pedidos.create` e `pedidos.update` também aceitam os corpos
de grade que o Mercos documenta nas mesmas rotas. `ProdutoInput` e `PedidoInput` são uniões do
corpo simples com os de grade.

Os tipos de **todas** as 169 operações documentadas estão disponíveis em `paths` e
`operations`, mesmo para rotas que ainda não têm método no cliente.

## Homologação no Mercos

Antes de liberar a produção, o Mercos revisa a integração. Os dois pontos que a revisão cobra,
tratamento do 429 e paginação completa, são comportamento padrão deste SDK. O processo está em
[docs.mercos.com/reference/homologação](https://docs.mercos.com/reference/homologação).

## Verificado no sandbox

Testado em 2026-09-19 contra `sandbox.mercos.com`, onde a documentação era ambígua:

- Um pedido criado pela API nasce como `StatusPedido.Gerado` (`"2"`), não como orçamento. O corpo
  de criação não aceita `status`.
- A condição de pagamento é obrigatória na criação: `condicao_pagamento_id` ou o texto livre
  `condicao_pagamento`. Sem nenhum dos dois, a API responde 422, embora o esquema não marque
  nenhum como obrigatório.
- A data de um campo extra vai como `yyyy-mm-dd`. O `yyyy-dd-mm` da documentação é erro de
  digitação: a API recusa com 422 e informa o formato `%Y-%m-%d`.

## Desenvolvimento

```sh
pnpm install
pnpm verify   # lint, checagem de tipos e testes
pnpm build    # emite dist/
```

Os tipos em `src/generated/` saem de `spec/mercos-openapi.json`, que por sua vez é montado a
partir dos fragmentos OpenAPI embutidos em cada página da documentação:

```sh
pnpm spec            # baixa as páginas, junta, gera os tipos e as fixtures
pnpm spec:fetch -- --refresh   # ignora o cache local em .cache/docs
```

Correções manuais da especificação ficam em `spec/patches.json`, cada uma com o motivo. Rodar
`pnpm spec` de novo e olhar o `git diff` mostra o que mudou na API.

O script de junção também conserta dois defeitos que se repetem nas páginas. Quando a página
declara um objeto e o próprio exemplo mostra uma lista, ou o contrário, vale o exemplo. Quando duas
páginas documentam a mesma rota com corpos diferentes, os corpos viram um `oneOf` só.

Os testes usam um `fetch` falso e um relógio falso, sem rede. Nenhum dado real de empresa entra
no repositório: as fixtures vêm dos exemplos da documentação pública.

Uma segunda suíte roda contra o sandbox de verdade. Ela se pula sozinha se as duas variáveis não
existirem, e cancela o pedido que cria:

```sh
MERCOS_APPLICATION_TOKEN=... MERCOS_COMPANY_TOKEN=... pnpm test:live
```

## Licença

[MIT](./LICENSE)
