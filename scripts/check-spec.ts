// Tells whether the Mercos documentation changed since the last `pnpm spec`, with a single request.
// Usage: node scripts/check-spec.ts [--update]
// Every reference page embeds the whole official OpenAPI file in its HTML. That file has the same
// flaws as the per-page fragments, so it doesn't replace them, but its hash is a cheap change detector.
// Exits with 1 when the documentation changed. With --update, records the current hash instead.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PAGE_URL = "https://docs.mercos.com/reference/obter-todos-os-pedidos";
const HASH_FILE = "spec/upstream.json";

interface Upstream {
  sha256: string;
  operations: number;
  /** When Mercos last saved the file, as the documentation site reports it. */
  updatedAt: string | undefined;
}

const response = await fetch(PAGE_URL, { headers: { "User-Agent": "mercos-sdk spec checker" } });
if (!response.ok) throw new Error(`${response.status} while downloading ${PAGE_URL}`);
const state = (await response.text()).match(/<script id="ssr-props"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!state) throw new Error("The page no longer embeds its state. The documentation site changed its layout.");

const props = JSON.parse(state) as {
  document?: { api?: { schema?: { paths?: Record<string, Record<string, unknown>> } } };
  apiDefinitions?: { updated_at?: string }[];
};
const schema = props.document?.api?.schema;
if (!schema?.paths) throw new Error("The page state no longer carries the OpenAPI file at document.api.schema.");

const current: Upstream = {
  sha256: createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
  operations: Object.values(schema.paths).reduce((count, item) => count + Object.keys(item).length, 0),
  updatedAt: props.apiDefinitions?.[0]?.updated_at,
};

if (process.argv.includes("--update")) {
  writeFileSync(HASH_FILE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Recorded the upstream file: ${current.operations} operations, saved by Mercos at ${current.updatedAt}.`);
} else {
  const known = existsSync(HASH_FILE) ? (JSON.parse(readFileSync(HASH_FILE, "utf8")) as Upstream) : undefined;
  if (known?.sha256 === current.sha256) {
    console.log(`No change upstream since ${known.updatedAt}.`);
  } else {
    console.error(
      `The Mercos documentation changed: ${known?.operations ?? "?"} operations recorded, ${current.operations} now, ` +
        `saved at ${current.updatedAt}. Run "pnpm spec -- --refresh" and read the diff.`,
    );
    process.exitCode = 1;
  }
}
