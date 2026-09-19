// Usage: node scripts/fetch-spec.ts [--refresh]
// Without --refresh, pages already in the cache aren't downloaded again.
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
    if (!retryable || attempt === MAX_ATTEMPTS) throw new Error(`${response.status} while downloading ${url}`);
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
console.log(
  `${pages.length} pages in the index, ${downloaded} downloaded, ${pages.length - downloaded} from the cache.`,
);
