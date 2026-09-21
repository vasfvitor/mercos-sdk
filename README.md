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

A opção `minIntervalMs` define o menor tempo entre o início de duas requisições. O padrão é 0. Em
2026-09-20, a conta sandbox aceitava uma requisição a cada 5,5 segundos, mais ou menos. Seis
leituras seguidas levaram cinco respostas 429 sem intervalo, e nenhuma com 5500 ms ou mais. A
rodada espaçada também foi mais rápida, 28 segundos contra 33, e fez metade das requisições. O
limite de uma conta de produção pode ser outro, então meça com o `onAttempt` antes de escolher
um valor.

### Observar as requisições

A opção `onAttempt` é chamada depois de cada tentativa HTTP, repetições incluídas. Serve para o
registro de requisições que a homologação do Mercos pede, ou para métricas.

```ts
const mercos = createMercos({
  applicationToken,
  companyToken,
  minIntervalMs: 6000,
  onAttempt({ method, route, status, attempt, durationMs, retryInSeconds }) {
    console.log(method, route, status, `tentativa ${attempt}`, `${durationMs} ms`, retryInSeconds ?? "");
  },
});
```

O evento tem `method`, `path` como foi enviado, `route` com cada trecho numérico como `{id}`,
`attempt` a partir de 1, `status`, `durationMs` e `retryInSeconds` quando outra tentativa vem
depois. O `status` é `undefined` numa falha de rede ou num timeout, e `error` diz qual dos dois
foi. O evento não tem corpo, query
nem header, então registrá-lo não vaza token nem dado de cliente. Um erro lançado pela função é
ignorado.

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

`listPages` faz o mesmo percurso de `list` e entrega um array por requisição, já sem os
repetidos. Serve para salvar o progresso a cada página.

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
| `mercos.categorias`          | `list`, `get`, `create`, `update`             |
| `mercos.formasPagamento`     | `list`, `get`, `create`, `update`             |
| `mercos.statusCustom`        | `list`, `get`, `create`, `update`             |
| `mercos.estoque`             | `adjust`, `adjustMany`                        |
| `mercos.tokenStatus()`       | Confere os tokens.                            |

Todo método recebe um objeto de opções como último argumento. Ele tem `timeoutMs` e `signal`, um
`AbortSignal` que cancela a requisição mesmo enquanto ela espera na fila:
`mercos.pedidos.get(55, { signal })`.

Pedidos usam a versão 2 da API. `get` por ID só funciona no sandbox: em produção o Mercos
bloqueia essa leitura, e o erro traz uma dica a respeito.

Todo recurso também tem `listPages` e `find`. O `find` lê um registro pela listagem, então
funciona em produção: `mercos.pedidos.find(55, { since: "2026-09-20 00:00:00" })`. Ele devolve
`undefined` quando nenhum registro com esse ID mudou depois de `since`. As requisições são as
mesmas nos dois ambientes, então o sandbox testa o que roda em produção.

`since` e `changedAfter` aceitam um texto ou um `Date`. O texto vai como está. O Mercos grava
`ultima_alteracao` no horário do Brasil, então um `Date` é convertido para esse fuso. A função
`mercosTimestamp(date)` faz a mesma conversão para uso seu.

A resposta da criação de um pedido não traz o total, e o Mercos soma impostos que os itens
enviados não mostram. `mercos.pedidos.createAndRead(pedido)` cria o pedido e o devolve como o
Mercos gravou, achado pela listagem da última hora. Quando o pedido é criado e a leitura falha, o
`MercosError` traz o ID do pedido em `createdId`. O pedido existe, então leia-o com `find` e não
crie de novo.

`statusCustom` são os status personalizados de pedido, os valores do filtro `status_custom`.
`estoque.adjust` define o saldo do produto como `novo_saldo`, não soma nem subtrai. Com o controle
de estoque desligado na conta, o Mercos recusa o ajuste com 422. `estoque.adjustMany` aceita no
máximo 300 ajustes, o limite do Mercos por requisição, e um ajuste com erro cancela o lote todo.

`produtos.create`, `produtos.update`, `pedidos.create` e `pedidos.update` também aceitam os corpos
de grade que o Mercos documenta nas mesmas rotas. `ProdutoInput` e `PedidoInput` são uniões do
corpo simples com os de grade. Para um produto de grade, `produtos.create` também devolve
`produtos_grade`, o ID e o código de cada filho. O Mercos recusa ajuste de estoque no produto
pai, então são esses os IDs que o `estoque.adjust` aceita.

Os tipos `paths` e `operations` cobrem as 169 operações documentadas.

## Outras rotas

Três métodos genéricos alcançam as rotas que não têm recurso com nome. Eles passam pela mesma
fila, pelas mesmas repetições, pela mesma paginação e pelos mesmos erros dos recursos com nome.

```ts
const titulos = mercos.resource("/v1/titulos");
const titulo = { cliente_id: 7, data_vencimento: "2026-01-31", numero_documento: "A-1", valor: 10.5 };
const { id } = await titulos.create(titulo);
await titulos.update(id, { ...titulo, valor: 12 });

for await (const etapa of mercos.list("/v1/funil/{funil_id}/etapas", { params: { funil_id: 3 } })) {
  console.log(etapa.titulo);
}

const { data, headers } = await mercos.request("POST", "/v1/clientes_tabela_preco/liberar_todas", {
  body: { cliente_id: 7 },
});
```

- `resource(path)` devolve `list`, `get`, `create` e `update` para um caminho sem parâmetros. O
  `create` devolve `{ id, data }`, e o `id` é `undefined` nas rotas que não criam um registro
  único, como as de lote.
- `list(path)` percorre qualquer caminho cujo GET devolve uma lista. Aceita `changedAfter`,
  `filters` e `params`, para os trechos `{nome}` do caminho.
- `request(method, path)` faz uma requisição e devolve `status`, `headers` e `data`.

Um caminho documentado aparece no autocompletar, e o esquema dele tipa os parâmetros, o corpo e
o resultado. Os esquemas são uma reconstrução da documentação e podem estar errados. Para
ignorá-los, passe o caminho como `string`: `mercos.request("PUT", path as string, { body })`. O
mesmo vale para uma rota que o Mercos criar depois.

## Verificado no sandbox

Testado em 2026-09-19 contra `sandbox.mercos.com`, onde a documentação era ambígua:

- Um pedido criado pela API nasce como `StatusPedido.Gerado` (`"2"`), não como orçamento. O corpo
  de criação não aceita `status`.
- A condição de pagamento é obrigatória na criação: `condicao_pagamento_id` ou o texto livre
  `condicao_pagamento`. Sem nenhum dos dois, a API responde 422, embora o esquema não marque
  nenhum como obrigatório.
- A data de um campo extra vai como `yyyy-mm-dd`. O `yyyy-dd-mm` da documentação é erro de
  digitação: a API recusa com 422 e informa o formato `%Y-%m-%d`.
- O Mercos soma o IPI do cadastro do produto a cada item do pedido, mesmo quando o item não
  manda `ipi`. Medido em 2026-09-20 pelo app `estoque_fratini`:

  | Item                     | Enviado                  | Subtotal no Mercos | Conta que fecha     |
  | ------------------------ | ------------------------ | ------------------ | ------------------- |
  | IPI 5%, tipo `P`         | 3 × 400, desconto 10%    | 1134               | 3 × 360 × 1,05      |
  | IPI 12,50, tipo `V`      | 4 × 200, desconto 10%    | 770                | 4 × 180 + 4 × 12,50 |
  | Sem IPI                  | 2 × 150                  | 300                | 2 × 150             |

  O IPI percentual incide depois do desconto. O IPI em valor fixo é por unidade, e o desconto
  não o reduz. O arredondamento para centavos acontece no subtotal do item. Uma tela que soma só
  preço, quantidade e desconto mostra menos que o total real, então leia o pedido de volta.
- O `st` do cadastro do produto não entrou no pedido: os itens voltaram com `st: 0`. O motivo é
  desconhecido.
- Na leitura, um valor ausente vem como `0` ou `""`, não como `null`: `tabela_preco_id: 0`,
  `transportadora_id: 0`, `observacoes: ""`. O SDK nunca reescreve os dados da resposta, então
  trate um `0` num campo de ID como ausência.
- A documentação escreve `alterado_apos` como `2024-04-10T15:45:00`. A maioria das rotas aceita, e
  a `/v1/divisoes` responde 422: ela exige o espaço, `2024-04-10 15:45:00`. Todas as rotas que o
  sandbox tem aceitaram o espaço, então o SDK sempre manda assim, e troca o `T` do seu texto por
  um espaço.
- A API não tem rota para os dados da própria empresa, como logotipo ou CNPJ. O pedido traz
  `representada_id`, `representada_nome_fantasia` e `representada_razao_social`, e o
  `token_auth_status` responde com o corpo vazio.
- O Mercos grava `ultima_alteracao` no horário do Brasil. Em 2026-09-20, uma alteração feita
  às 00:12 UTC voltou marcada como 21:12.
- Quantidade fracionada, como 1,5, e item sem `tabela_preco_id` são aceitos.
- Em 2026-09-20, a lista de pedidos e a leitura por ID devolveram os mesmos 47 campos. Cada
  esquema documentado deixa alguns de fora: a lista não tem `itens`, e a leitura por ID não tem os
  campos do cliente. O tipo `Pedido` junta os dois.

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

1. Escreva as mudanças sob um título `## 0.4.2 - Unreleased` no `CHANGELOG.md`, e faça o commit.
2. Rode `pnpm release 0.4.2`. Ele ajusta a versão, data o título, roda o `pnpm verify`, faz o
   commit, cria a tag e envia o branch e a tag juntos. Com `--dry-run` ele só mostra os passos.
3. Aprove a versão no npmjs.com, na fila de staging do pacote. Com duas versões na fila, aprove
   na ordem das versões: a `latest` segue a última aprovação.

A tag enviada dispara o workflow de release. Ele envia a versão para o staging do npm, com
atestado de procedência, e cria a release no GitHub a partir da entrada do changelog. Ela só
fica instalável depois da aprovação, que exige 2FA. Nenhum token do npm fica guardado: no
npmjs.com, o pacote lista este repositório e o `release.yml` como publicador confiável.

## Licença

[MIT](./LICENSE)
