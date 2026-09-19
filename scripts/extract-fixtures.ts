// Only the resources the SDK covers go in. The examples come from the public docs, with no real data.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PATHS } from "../src/resources/paths.ts";
import { SPEC_FILE } from "./lib/docs.ts";

const OUTPUT_DIR = "test/fixtures";
const COVERED = new Set<string>(Object.values(PATHS));
/** "/v2/pedidos/{id}" is covered because "/v2/pedidos" is. */
const isCovered = (path: string) => COVERED.has(path.replace(/\/\{id\}$/, ""));

interface Example {
  value?: unknown;
}
interface Media {
  schema?: { oneOf?: unknown[] };
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

/**
 * A request body with variants names its examples "variant" or "variant: title". Returns the first
 * example of each variant, other than the default one that `firstExample` already covers.
 */
function variantExamples(media: Media | undefined): Map<string, unknown> {
  const variants = new Map<string, unknown>();
  const [first, ...rest] = Object.entries(media?.examples ?? {});
  const firstVariant = first?.[0].split(": ")[0];
  for (const [name, example] of rest) {
    const variant = name.split(": ")[0]!;
    if (variant !== firstVariant && !variants.has(variant)) variants.set(variant, unwrap(example.value));
  }
  return variants;
}

/** Some examples were published as JSON inside a string. Text that isn't JSON stays as it is. */
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
  if (!isCovered(path)) continue;
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
    const request = operation.requestBody?.content?.["application/json"];
    const variants = [["", fixture.request], ...(request?.schema?.oneOf ? variantExamples(request) : [])] as const;
    for (const [variant, body] of variants) {
      const name = [operation.operationId, ...(variant ? [variant.replace(/\W+/g, "_")] : [])].join("_");
      writeFileSync(`${OUTPUT_DIR}/${name}.json`, `${JSON.stringify({ ...fixture, request: body }, null, 2)}\n`);
      count++;
    }
  }
}
console.log(`${count} fixtures written to ${OUTPUT_DIR}.`);
