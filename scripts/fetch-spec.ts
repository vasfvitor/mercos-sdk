// Baixa o índice e as páginas de referência do Mercos para o cache local.
// Uso: node scripts/fetch-spec.ts [--refresh]
// Sem --refresh, páginas já presentes no cache não são baixadas de novo.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { INDEX_FILE, INDEX_URL, PAGES_DIR, parseIndex } from "./lib/docs.ts";

const DELAY_MS = 400;
const MAX_ATTEMPTS = 4;
const refresh = process.argv.includes("--refresh");

async function download(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { "User-Agent": "mercos-sdk spec fetcher" } });
    if (response.ok) return await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) throw new Error(`${response.status} ao baixar ${url}`);
    await sleep(DELAY_MS * 2 ** attempt);
  }
}

mkdirSync(PAGES_DIR, { recursive: true });
const indexText = await download(INDEX_URL);
writeFileSync(INDEX_FILE, indexText);
const pages = parseIndex(indexText);

let downloaded = 0;
for (const page of pages) {
  if (!refresh && existsSync(page.file)) continue;
  writeFileSync(page.file, await download(page.url));
  downloaded++;
  await sleep(DELAY_MS);
}
console.log(`${pages.length} páginas no índice, ${downloaded} baixadas, ${pages.length - downloaded} do cache.`);
