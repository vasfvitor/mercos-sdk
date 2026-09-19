// Salva os exemplos embutidos na especificação como fixtures de teste, um arquivo por operação.
// Só entram os recursos que o SDK cobre. Os exemplos vêm da documentação pública, sem dado real.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { SPEC_FILE } from "./lib/docs.ts";

const OUTPUT_DIR = "test/fixtures";
const RESOURCES =
  /^\/(v2\/pedidos|v1\/(pedidos\/cancelar|clientes|produtos|tabelas_preco|produtos_tabela_preco|condicoes_pagamento|transportadoras|usuarios))(\/\{id\})?(#.*)?$/;

interface Example {
  value?: unknown;
}
interface Media {
  examples?: Record<string, Example>;
  example?: unknown;
}
interface Operation {
  operationId: string;
  requestBody?: { content?: Record<string, Media> };
  responses?: Record<string, { content?: Record<string, Media> }>;
}

function firstExample(media: Media | undefined): unknown {
  if (!media) return undefined;
  const named = Object.values(media.examples ?? {})[0];
  return unwrap(named?.value ?? media.example);
}

/** Alguns exemplos foram publicados como JSON dentro de uma string. Texto que não é JSON fica como está. */
function unwrap(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const spec = JSON.parse(readFileSync(SPEC_FILE, "utf8")) as { paths: Record<string, Record<string, Operation>> };
rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

let count = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  if (!RESOURCES.test(path)) continue;
  for (const [method, operation] of Object.entries(item)) {
    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const example = firstExample(response.content?.["application/json"]);
      if (example !== undefined) responses[status] = example;
    }
    const fixture = {
      method: method.toUpperCase(),
      path,
      request: firstExample(operation.requestBody?.content?.["application/json"]),
      responses,
    };
    writeFileSync(`${OUTPUT_DIR}/${operation.operationId}.json`, `${JSON.stringify(fixture, null, 2)}\n`);
    count++;
  }
}
console.log(`${count} fixtures gravadas em ${OUTPUT_DIR}.`);
