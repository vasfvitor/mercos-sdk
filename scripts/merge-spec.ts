// Junta os fragmentos OpenAPI das páginas em cache num único documento versionado.
// Cada página traz o documento de uma operação só, com chaves de caminho sujas. Aqui elas são
// normalizadas, os rascunhos descartados e as correções manuais de spec/patches.json aplicadas.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extractOpenApi, readIndex, SPEC_FILE } from "./lib/docs.ts";

type Json = Record<string, unknown>;

interface Patches {
  /** Por slug da página: caminho real de uma operação publicada com chave de rascunho. */
  paths: Record<string, string>;
  /** Por slug da página: nome da variante quando duas operações dividem caminho e método. */
  variants: Record<string, string>;
  /** Correções pontuais no documento final, por JSON Pointer. */
  set: { pointer: string; value: unknown; motivo: string }[];
}

const METHODS = new Set(["get", "post", "put", "delete", "patch"]);
const TOKEN_HEADERS = new Set(["applicationtoken", "companytoken"]);

const patches = JSON.parse(readFileSync("spec/patches.json", "utf8")) as Patches;

/** "/v1/eventos/-1-1" e "/v1/clientes?alterado_apos= " viram "/v1/eventos" e "/v1/clientes". */
function normalizePath(key: string): string {
  return key
    .replace(/\?.*$/, "")
    .trim()
    .replace(/(-\d+)+$/, "")
    .replace(/\/+$/, "");
}

function operationId(method: string, path: string): string {
  return `${method}_${path}`
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function setPointer(doc: Json, pointer: string, value: unknown): void {
  const keys = pointer
    .split("/")
    .slice(1)
    .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = doc as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null)
      throw new Error(`Pointer inválido em patches.json: ${pointer}`);
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
}

const paths: Record<string, Json> = {};
const notes: string[] = [];
let operations = 0;

for (const page of readIndex()) {
  if (!existsSync(page.file)) throw new Error(`Página fora do cache: ${page.file}. Rode "pnpm spec:fetch".`);
  const fragment = extractOpenApi(readFileSync(page.file, "utf8"));
  if (!fragment) continue;

  for (const [rawPath, item] of Object.entries(fragment.paths as Record<string, Json>)) {
    for (const [method, rawOperation] of Object.entries(item)) {
      if (!METHODS.has(method)) continue;
      const path = patches.paths[page.slug] ?? normalizePath(rawPath);
      if (!/^\/v\d+\//.test(path)) {
        notes.push(`descartado (rascunho sem correção): ${method.toUpperCase()} ${rawPath} [${page.slug}]`);
        continue;
      }

      let key = path;
      if (paths[key]?.[method]) {
        key = `${path}#${patches.variants[page.slug] ?? page.slug}`;
        if (!patches.variants[page.slug]) notes.push(`variante sem nome em patches.json: ${key}`);
        if (paths[key]?.[method]) throw new Error(`Colisão não resolvida: ${method.toUpperCase()} ${key}`);
      }

      const operation = rawOperation as Json;
      const parameters = ((operation.parameters as Json[] | undefined) ?? []).filter(
        (parameter) => !(parameter.in === "header" && TOKEN_HEADERS.has(String(parameter.name).toLowerCase())),
      );
      paths[key] ??= {};
      paths[key][method] = {
        ...operation,
        operationId: operationId(method, key),
        summary: operation.summary ?? page.title,
        externalDocs: { url: page.url.replace(/\.md$/, "") },
        parameters: parameters.length > 0 ? parameters : undefined,
      };
      operations++;
    }
  }
}

const document: Json = {
  openapi: "3.0.3",
  info: {
    title: "API de integração Mercos",
    version: "1.0.0",
    description:
      "Documento não oficial, montado a partir dos fragmentos publicados em docs.mercos.com. " +
      "Gerado por scripts/merge-spec.ts; não edite à mão, use spec/patches.json.",
  },
  servers: [
    { url: "https://sandbox.mercos.com/api", description: "Sandbox" },
    { url: "https://app.mercos.com/api", description: "Produção" },
  ],
  security: [{ ApplicationToken: [], CompanyToken: [] }],
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
  components: {
    securitySchemes: {
      ApplicationToken: { type: "apiKey", in: "header", name: "ApplicationToken" },
      CompanyToken: { type: "apiKey", in: "header", name: "CompanyToken" },
    },
  },
};

for (const patch of patches.set) setPointer(document, patch.pointer, patch.value);

writeFileSync(SPEC_FILE, `${JSON.stringify(document, null, 2)}\n`);
for (const note of notes) console.warn(`aviso: ${note}`);
console.log(`${operations} operações em ${Object.keys(paths).length} caminhos gravadas em ${SPEC_FILE}.`);
