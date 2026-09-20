// Merges the OpenAPI fragments from the cached pages into a single committed document.
// Each page carries the document for one operation only, with messy path keys. This script
// normalizes them, drops the drafts, and applies the manual fixes from spec/patches.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BASE_URLS } from "../src/client.ts";
import { extractOpenApi, readIndex, SPEC_FILE } from "./lib/docs.ts";

type Json = Record<string, unknown>;

interface Patches {
  /** By page slug: the real path of an operation published under a draft key. */
  paths: Record<string, string>;
  /** By page slug: the variant name when two operations share a path and a method. */
  variants: Record<string, string>;
  /** Read-by-ID paths whose page declares, and exemplifies, an array, while the API returns one record. */
  records: { paths: string[]; reason: string };
  /** Targeted fixes to the final document, by JSON Pointer. One fact, one entry. */
  set: { pointers: string[]; value: unknown; reason: string }[];
}

const METHODS = new Set(["get", "post", "put", "delete", "patch"]);
const TOKEN_HEADERS = new Set(["applicationtoken", "companytoken"]);

const patches = JSON.parse(readFileSync("spec/patches.json", "utf8")) as Patches;

/** "/v1/eventos/-1-1" and "/v1/clientes?alterado_apos= " become "/v1/eventos" and "/v1/clientes". */
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
  let node = doc;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null)
      throw new Error(`Invalid pointer in patches.json: ${pointer}`);
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
}

/** Fields that every record carries. The pages declare them and almost never mark them as required. */
const ALWAYS_PRESENT = ["id", "ultima_alteracao"];

/**
 * Whether an example is a list or a single record. Some pages publish the example as a JSON string,
 * not always valid JSON, so for strings the first character decides.
 */
function container(example: unknown): "list" | "record" | undefined {
  const opening = typeof example === "string" ? example.trimStart()[0] : undefined;
  if (Array.isArray(example) || opening === "[") return "list";
  if ((typeof example === "object" && example !== null) || opening === "{") return "record";
  return undefined;
}

/**
 * Fixes the shape of a GET 200 schema. The pages often declare `object` for a list, or `array` for
 * a single record, while the example on the same page shows the real container. The example wins.
 */
function fixRecordSchema(path: string, operation: Json): void {
  const responses = operation.responses as Record<string, { content?: Record<string, Json> }> | undefined;
  const content = responses?.["200"]?.content?.["application/json"];
  const schema = content?.schema as Json | undefined;
  if (!content || !schema) return;

  const examples = [
    content.example,
    ...Object.values((content.examples ?? {}) as Record<string, Json>).map((e) => e.value),
  ].map(container);
  const lists = examples.includes("list");
  const records = examples.includes("record");
  let record = (schema.type === "array" ? schema.items : schema) as Json | undefined;
  if (schema.type === "object" && lists && !records) content.schema = { type: "array", items: schema };
  else if (schema.type === "array" && record && ((records && !lists) || patches.records.paths.includes(path)))
    content.schema = record;

  record = ((content.schema as Json).items ?? content.schema) as Json;
  const declared = Object.keys((record.properties ?? {}) as Json);
  const required = new Set([
    ...((record.required as string[] | undefined) ?? []),
    ...ALWAYS_PRESENT.filter((key) => declared.includes(key)),
  ]);
  if (required.size > 0) record.required = [...required];
}

type Media = { schema?: Json; example?: unknown; examples?: Record<string, Json> };

/** Example name for the operation that owns the path, next to the variants folded into it. */
const BASE_EXAMPLE = "default";

function namedExamples(media: Media, name: string): Record<string, Json> {
  if (media.examples)
    return Object.fromEntries(Object.entries(media.examples).map(([key, value]) => [`${name}: ${key}`, value]));
  return media.example === undefined ? {} : { [name]: { value: media.example } };
}

/**
 * Two pages can document the same path and method with different bodies: a plain order and an order
 * with grid products, for instance. OpenAPI allows one operation per path and method, so the bodies
 * become a `oneOf` inside the operation that owns the path, and each one keeps its example.
 */
function foldVariant(base: Json, variant: Json, name: string): void {
  const media = (operation: Json) =>
    (operation.requestBody as { content?: Record<string, Media> } | undefined)?.content?.["application/json"];
  const into = media(base);
  const from = media(variant);
  if (into && from?.schema) {
    const link = (variant.externalDocs as { url: string }).url;
    const body = { title: name, description: `${String(variant.summary)}. ${link}`, ...from.schema };
    const folded = into.schema?.oneOf as Json[] | undefined;
    into.examples = { ...(folded ? into.examples : namedExamples(into, BASE_EXAMPLE)), ...namedExamples(from, name) };
    into.schema = { oneOf: [...(folded ?? [{ title: BASE_EXAMPLE, ...into.schema }]), body] };
    delete into.example;
  } else if (from) {
    base.requestBody ??= variant.requestBody;
  }
  base.responses = { ...(variant.responses as Json), ...(base.responses as Json) };
}

const paths: Record<string, Json> = {};
const notes: string[] = [];
let operations = 0;

for (const page of readIndex()) {
  if (!existsSync(page.file)) throw new Error(`Page missing from the cache: ${page.file}. Run "pnpm spec:fetch".`);
  const fragment = extractOpenApi(readFileSync(page.file, "utf8"));
  if (!fragment) continue;

  for (const [rawPath, item] of Object.entries(fragment.paths as Record<string, Json>)) {
    for (const [method, rawOperation] of Object.entries(item)) {
      if (!METHODS.has(method)) continue;
      const path = patches.paths[page.slug] ?? normalizePath(rawPath);
      if (!/^\/v\d+\//.test(path)) {
        notes.push(`dropped (draft with no fix): ${method.toUpperCase()} ${rawPath} [${page.slug}]`);
        continue;
      }

      let key = path;
      if (paths[key]?.[method]) {
        key = `${path}#${patches.variants[page.slug] ?? page.slug}`;
        if (!patches.variants[page.slug]) notes.push(`variant with no name in patches.json: ${key}`);
        if (paths[key]?.[method]) throw new Error(`Unresolved collision: ${method.toUpperCase()} ${key}`);
      }

      const operation = rawOperation as Json;
      if (method === "get") fixRecordSchema(path, operation);
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

// The pointers in patches.json name the variant keys, so the fixes go in before the variants fold.
for (const patch of patches.set) for (const pointer of patch.pointers) setPointer({ paths }, pointer, patch.value);

// The divisions page says that accounts with no divisions send `representada_id` wherever the others
// send `divisao_id`. The route pages document only the second one. This runs after the patches,
// because some of them append to a parameter list by index.
for (const item of Object.values(paths)) {
  const parameters = (item.get as Json | undefined)?.parameters as Json[] | undefined;
  const divisao = parameters?.find((parameter) => parameter.name === "divisao_id" && parameter.in === "query");
  if (parameters && divisao && !parameters.some((parameter) => parameter.name === "representada_id")) {
    parameters.push({
      ...divisao,
      name: "representada_id",
      description: "Para contas sem divisões, no lugar de `divisao_id`.",
    });
  }
}

for (const key of Object.keys(paths).filter((path) => path.includes("#"))) {
  const [path, name] = key.split("#") as [string, string];
  for (const [method, variant] of Object.entries(paths[key]!))
    foldVariant(paths[path]![method] as Json, variant as Json, name);
  delete paths[key];
}

const document: Json = {
  openapi: "3.0.3",
  info: {
    title: "Mercos integration API",
    version: "1.0.0",
    description:
      "Unofficial document, assembled from the fragments published at docs.mercos.com. " +
      "Generated by scripts/merge-spec.ts. Do not edit by hand; use spec/patches.json.",
  },
  servers: [
    { url: BASE_URLS.sandbox, description: "Sandbox" },
    { url: BASE_URLS.production, description: "Production" },
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

writeFileSync(SPEC_FILE, `${JSON.stringify(document, null, 2)}\n`);
for (const note of notes) console.warn(`warning: ${note}`);
console.log(`${operations} operations across ${Object.keys(paths).length} paths written to ${SPEC_FILE}.`);
