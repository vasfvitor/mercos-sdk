# mercos-sdk

SDK TypeScript **não oficial** para a [API de integração do Mercos](https://docs.mercos.com).
Usa o `fetch` nativo, sem dependências de runtime. Trata o 429 e a paginação, os dois pontos que a
[homologação do Mercos](https://docs.mercos.com/reference/homologação) cobra antes de liberar a
produção.

[English version](./README.en.md)

> Este projeto não tem vínculo com a Mercos. Os tipos saem da documentação pública e podem
> divergir do comportamento real da API.

## Instalação

```sh
npm install mercos-sdk
```

Requer Node 22 ou mais recente. Também roda em Deno, Bun e Cloudflare Workers, porque depende
apenas de `fetch`, `URLSearchParams` e `AbortSignal`.

## Uso

```ts
import { collect, createMercos, MercosError, StatusPedido } from "mercos-sdk";

const mercos = createMercos({
  applicationToken: process.env.MERCOS_APPLICATION_TOKEN!,
  companyToken: process.env.MERCOS_COMPANY_TOKEN!,
  environment: "sandbox", // ou "production", depois da homologação
});

await mercos.tokenStatus();

// A paginação acontece dentro do iterador.
for await (const cliente of mercos.clientes.list({ changedAfter: "2024-01-01 00:00:00" })) {
  console.log(cliente.id, cliente.razao_social);
}

const orcamentos = await collect(mercos.pedidos.list({ filters: { status: StatusPedido.Orcamento } }));

// O ID vem do header MeusPedidosID.
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

## Comportamento

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

Use um cliente por par de tokens no processo. Dois clientes não dividem a fila.

### Timeout e falhas passageiras

Cada tentativa tem um tempo limite, de 30 segundos por padrão. Sem isso, uma requisição que nunca
responde seguraria a fila, e com ela todas as chamadas seguintes. Passado o limite, a chamada falha
com um `MercosError` de `kind` igual a `"timeout"`. Ajuste `timeoutMs` no `createMercos` ou numa
chamada só: `mercos.pedidos.get(55, { timeoutMs: 5000 })`. Zero desliga o limite.

Uma leitura (`GET`) que falha na rede, estoura o tempo ou recebe 502, 503 ou 504 é reenviada até
duas vezes, depois de 1 e de 2 segundos. Uma escrita nunca é reenviada: a primeira tentativa pode
ter criado o pedido mesmo sem a resposta ter chegado. `maxRetries: 0` também desliga essas
repetições.

### Paginação

As listagens do Mercos são incrementais. O cursor é `alterado_apos`, e o header
`MEUSPEDIDOS_LIMITOU_REGISTROS` com valor 1 avisa que há mais páginas. O iterador do SDK:

- usa como próximo cursor a penúltima `ultima_alteracao` distinta da página, devolvida como o
  servidor escreveu. Esse campo tem resolução de um segundo, e o corte da página pode cair no
  meio de um segundo. Com o recuo, o último segundo é relido inteiro, seja o `alterado_apos` do
  servidor estrito ou inclusivo;
- descarta os registros que voltam repetidos por causa desse recuo;
- lança um erro de `kind` igual a `"pagination"` se o servidor prometer mais páginas e a
  página inteira tiver a mesma `ultima_alteracao`, porque aí não há para onde recuar. Em
  pedidos, um `registros_por_pagina` maior costuma resolver.

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
| `timeout`             | Sem resposta dentro de `timeoutMs`.                           |
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

Todo método recebe um objeto de opções como último argumento. Ele tem `timeoutMs` e `signal`, um
`AbortSignal` que cancela a requisição mesmo enquanto ela espera na fila:
`mercos.pedidos.get(55, { signal })`.

Pedidos usam a versão 2 da API. `get` por ID só funciona no sandbox: em produção o Mercos
bloqueia essa leitura, e o erro traz uma dica a respeito.

`produtos.create`, `produtos.update`, `pedidos.create` e `pedidos.update` também aceitam os corpos
de grade que o Mercos documenta nas mesmas rotas. `ProdutoInput` e `PedidoInput` são uniões do
corpo simples com os de grade.

Os tipos `paths` e `operations` cobrem as 169 operações documentadas, inclusive rotas que ainda
não têm método no cliente.

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
pnpm verify   # lint, checagem de tipos, lint da especificação e testes
pnpm build    # emite dist/
```

Os tipos em `src/generated/` saem de `spec/mercos-openapi.json`, que por sua vez é montado a
partir dos fragmentos OpenAPI embutidos em cada página da documentação:

```sh
pnpm spec            # baixa as páginas, junta, gera os tipos e as fixtures
pnpm spec:fetch -- --refresh   # ignora o cache local em .cache/docs
```

`pnpm spec:lint` confere que o arquivo montado é um
OpenAPI estruturalmente válido, e faz parte do `pnpm verify`. `pnpm spec:check` pergunta ao site da
documentação, com uma requisição só, se o Mercos mudou algo desde o último `pnpm spec`. Sai com 1
quando mudou.

Correções manuais da especificação ficam em `spec/patches.json`, cada uma com o motivo. Rodar
`pnpm spec` de novo e olhar o `git diff` mostra o que mudou na API.

O script de junção também conserta dois defeitos que se repetem nas páginas. Quando a página
declara um objeto e o próprio exemplo mostra uma lista, ou o contrário, vale o exemplo. Quando duas
páginas documentam a mesma rota com corpos diferentes, os corpos viram um `oneOf` só.

Os testes usam um `fetch` falso e um relógio falso, sem rede. As fixtures vêm dos exemplos da
documentação pública.

Uma segunda suíte roda contra o sandbox de verdade. Ela se pula sozinha se as duas variáveis não
existirem, e cancela o pedido que cria:

```sh
MERCOS_APPLICATION_TOKEN=... MERCOS_COMPANY_TOKEN=... pnpm test:live
```

## Publicação

1. Ajuste a versão no `package.json` e date a entrada no `CHANGELOG.md`.
2. Publique uma release no GitHub com a tag `v` mais essa versão, por exemplo `v0.1.0`.

3. Aprove a versão no npmjs.com, na fila de staging do pacote.

O workflow de release envia a versão para o staging do npm, com atestado de procedência. Ela só
fica instalável depois da aprovação, que exige 2FA. Nenhum token do npm fica guardado: no
npmjs.com, o pacote lista este repositório e o `release.yml` como publicador confiável.

## Licença

[MIT](./LICENSE)
