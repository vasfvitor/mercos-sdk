import { MercosError } from "./errors.ts";
import type { Http, Query } from "./http.ts";

/** Ponto de partida quando quem chama quer tudo. É o valor que a documentação do Mercos usa. */
const INICIO = "2000-01-01T00:00:00";
const LIMITED_HEADER = "MEUSPEDIDOS_LIMITOU_REGISTROS";

export interface ListOptions {
  /** Traz só registros alterados depois deste instante, no formato que o Mercos devolve em `ultima_alteracao`. */
  alteradoApos?: string;
  signal?: AbortSignal;
}

/** O pouco que a paginação precisa enxergar num registro, seja ele de qual recurso for. */
interface Paginado {
  id?: unknown;
  ultima_alteracao?: unknown;
}

/** O servidor escreve "2024-04-10 15:45:00" e a documentação usa "2024-04-10T15:45:00". Só para comparar. */
function comparable(timestamp: string): string {
  return timestamp.replace("T", " ");
}

function recordKey(record: Paginado): string {
  return record.id === undefined ? JSON.stringify(record) : `${String(record.id)}|${String(record.ultima_alteracao)}`;
}

/**
 * Percorre uma listagem incremental do Mercos. O cursor seguinte é uma `ultima_alteracao` da
 * própria página, devolvida exatamente como o servidor escreveu, e o laço termina quando o header
 * MEUSPEDIDOS_LIMITOU_REGISTROS deixa de vir com valor 1.
 */
export async function* paginate<T extends object>(
  http: Http,
  path: string,
  options: ListOptions & { filtros?: Query } = {},
): AsyncGenerator<T> {
  let cursor = options.alteradoApos ?? INICIO;
  // Registros já entregues que a página seguinte vai trazer de novo, por causa do recuo do cursor.
  let seen = new Set<string>();

  for (;;) {
    const response = await http.request<unknown>("GET", path, {
      query: { ...options.filtros, alterado_apos: cursor },
      signal: options.signal,
    });
    if (!Array.isArray(response.data)) {
      throw new MercosError("unexpected_response", `GET ${path} não devolveu uma lista.`, {
        method: "GET",
        path,
        body: response.data,
      });
    }
    const records = response.data as Paginado[];

    for (const record of records) {
      // Num gerador assíncrono o tipo do yield é Awaited<T>, que o compilador não reduz para T genérico.
      if (seen.size === 0 || !seen.has(recordKey(record))) yield record as Awaited<T>;
    }

    if (response.headers.get(LIMITED_HEADER) !== "1") return;

    // Os dois maiores instantes distintos à frente do cursor. `raw` volta para o servidor como veio.
    const current = comparable(cursor);
    let top: { raw: string; key: string } | undefined;
    let second: { raw: string; key: string } | undefined;
    for (const { ultima_alteracao: raw } of records) {
      if (typeof raw !== "string") continue;
      const key = comparable(raw);
      if (key <= current || key === top?.key) continue;
      if (top === undefined || key > top.key) {
        second = top;
        top = { raw, key };
      } else if (second === undefined || key > second.key) {
        second = { raw, key };
      }
    }

    // `ultima_alteracao` tem resolução de um segundo, e o corte da página pode cair no meio de um
    // segundo. Por isso o cursor recua para o PENÚLTIMO instante: o último é relido inteiro na
    // página seguinte, seja o alterado_apos do servidor ">" ou ">=". Com um instante só, não há
    // para onde recuar sem arriscar perda silenciosa ou laço infinito.
    if (second === undefined) {
      throw new MercosError(
        "pagination",
        `GET ${path} avisou que há mais registros, mas a página inteira tem a mesma ultima_alteracao ` +
          `("${top?.raw ?? cursor}"). Avançar o cursor daqui poderia perder registros em silêncio. ` +
          "Se a rota aceitar registros_por_pagina, tente uma página maior.",
        { method: "GET", path },
      );
    }
    const { key: nextKey } = second;
    seen = new Set(
      records
        .filter(({ ultima_alteracao: raw }) => typeof raw === "string" && comparable(raw) >= nextKey)
        .map(recordKey),
    );
    cursor = second.raw;
  }
}

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}
