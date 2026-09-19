// Acesso ao cache local da documentação do Mercos, compartilhado pelos scripts de especificação.
import { existsSync, readFileSync } from "node:fs";

export const INDEX_URL = "https://docs.mercos.com/llms.txt";
const CACHE_DIR = ".cache/docs";
export const INDEX_FILE = `${CACHE_DIR}/llms.txt`;
export const PAGES_DIR = `${CACHE_DIR}/pages`;
export const SPEC_FILE = "spec/mercos-openapi.json";

export interface PageRef {
  title: string;
  url: string;
  slug: string;
  file: string;
}

/** Lê o índice na ordem em que a documentação apresenta as páginas. */
export function parseIndex(text: string): PageRef[] {
  const pages: PageRef[] = [];
  for (const match of text.matchAll(/^- \[(.+?)\]\((https:\/\/docs\.mercos\.com\/reference\/(.+?)\.md)\)/gm)) {
    const [, title, url, rawSlug] = match;
    const slug = decodeURIComponent(rawSlug!);
    pages.push({ title: title!, url: url!, slug, file: `${PAGES_DIR}/${encodeURIComponent(slug)}.md` });
  }
  return pages;
}

export function readIndex(): PageRef[] {
  if (!existsSync(INDEX_FILE)) throw new Error(`Índice ausente em ${INDEX_FILE}. Rode "pnpm spec:fetch" antes.`);
  return parseIndex(readFileSync(INDEX_FILE, "utf8"));
}

/** Extrai o documento OpenAPI embutido na página. Páginas só de prosa devolvem undefined. */
export function extractOpenApi(markdown: string): Record<string, unknown> | undefined {
  const match = markdown.match(/# OpenAPI definition\s*\n+(`{3,})json\n([\s\S]*?)\n\1/);
  return match ? (JSON.parse(match[2]!) as Record<string, unknown>) : undefined;
}
