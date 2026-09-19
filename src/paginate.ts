import { MercosError } from "./errors.ts";
import type { Http, Query } from "./http.ts";

/** Ponto de partida quando quem chama quer tudo. É o valor que a documentação do Mercos usa. */
export const INICIO = "2000-01-01T00:00:00";
const LIMITED_HEADER = "MEUSPEDIDOS_LIMITOU_REGISTROS";

export interface ListOptions {
  /** Traz só registros alterados depois deste instante, no formato que o Mercos devolve em `ultima_alteracao`. */
  alteradoApos?: string;
  signal?: AbortSignal;
}

interface Registro {
  id?: unknown;
  ultima_alteracao?: unknown;
}

/** O servidor escreve "2024-04-10 15:45:00" e a documentação usa "2024-04-10T15:45:00". Só para comparar. */
function comparable(timestamp: string): string {
  return timestamp.replace("T", " ");
}

function recordKey(record: Registro): string {
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
  options: ListOptions = {},
  query: Query = {},
): AsyncGenerator<T> {
  let cursor = options.alteradoApos ?? INICIO;
  // Registros já entregues que a página seguinte vai trazer de novo, por causa do recuo do cursor.
  let seen = new Set<string>();

  for (;;) {
    const response = await http.request<unknown>("GET", path, {
      query: { ...query, alterado_apos: cursor },
      signal: options.signal,
    });
    if (!Array.isArray(response.data)) {
      throw new MercosError("unexpected_response", `GET ${path} não devolveu uma lista.`, {
        method: "GET",
        path,
        body: response.data,
      });
    }
    const records = response.data as Registro[];

    // Instantes distintos da página que estão à frente do cursor, do menor para o maior.
    const ahead = [
      ...new Set(
        records
          .map((record) => record.ultima_alteracao)
          .filter(
            (changed): changed is string => typeof changed === "string" && comparable(changed) > comparable(cursor),
          ),
      ),
    ].sort((a, b) => (comparable(a) < comparable(b) ? -1 : 1));

    for (const record of records) {
      if (!seen.has(recordKey(record))) yield record as Awaited<T>;
    }

    if (response.headers.get(LIMITED_HEADER) !== "1") return;

    // `ultima_alteracao` tem resolução de um segundo, e o corte da página pode cair no meio de um
    // segundo. Por isso o cursor recua para o PENÚLTIMO instante: o último é relido inteiro na
    // página seguinte, seja o alterado_apos do servidor ">" ou ">=". Com um instante só, não há
    // para onde recuar sem arriscar perda silenciosa ou laço infinito.
    const next = ahead.at(-2);
    if (next === undefined) {
      throw new MercosError(
        "pagination",
        `GET ${path} avisou que há mais registros, mas a página inteira tem a mesma ultima_alteracao ` +
          `("${ahead[0] ?? cursor}"). Avançar o cursor daqui poderia perder registros em silêncio. ` +
          "Se a rota aceitar registros_por_pagina, tente uma página maior.",
        { method: "GET", path },
      );
    }
    seen = new Set(
      records
        .filter(
          (record) =>
            typeof record.ultima_alteracao === "string" && comparable(record.ultima_alteracao) >= comparable(next),
        )
        .map(recordKey),
    );
    cursor = next;
  }
}

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}
