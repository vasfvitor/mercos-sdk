// Cuts a release: `pnpm release 0.4.2`. Sets the version, dates the changelog entry, verifies,
// commits, tags, and pushes. The tag starts .github/workflows/release.yml, which stages the version
// on npm. The one step left is the approval on npmjs.com.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2] ?? "";
const dryRun = process.argv.includes("--dry-run");

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function run(command: string, args: string[]): void {
  console.log(`$ ${command} ${args.join(" ")}`);
  if (!dryRun) execFileSync(command, args, { stdio: "inherit" });
}

if (!/^\d+\.\d+\.\d+$/.test(version)) fail("usage: pnpm release <major.minor.patch> [--dry-run]");

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const newer = version.localeCompare(manifest.version, undefined, { numeric: true }) > 0;
if (!newer) fail(`${version} isn't newer than ${manifest.version}, the version in package.json.`);

if (git("branch", "--show-current") !== "main") fail("releases go out from main.");
// An untracked file doesn't stop a release: only a change to a tracked one would ride along unseen.
if (git("status", "--porcelain", "--untracked-files=no") !== "") fail("commit or stash the pending changes first.");
if (git("tag", "--list", `v${version}`) !== "") fail(`the tag v${version} already exists.`);

const changelog = readFileSync("CHANGELOG.md", "utf8");
const open = `## ${version} - Unreleased`;
if (!changelog.includes(`${open}\n`)) fail(`CHANGELOG.md has no "${open}" heading.`);
// The date where the maintainer is, not in UTC: a release late in the evening keeps its day.
const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
  new Date(),
);

console.log(
  `Releasing ${manifest.version} -> ${version}, dated ${today}.${dryRun ? " Dry run: nothing changes." : ""}`,
);
if (!dryRun) {
  writeFileSync("CHANGELOG.md", changelog.replace(open, `## ${version} - ${today}`));
  writeFileSync(
    "package.json",
    readFileSync("package.json", "utf8").replace(`"version": "${manifest.version}"`, `"version": "${version}"`),
  );
}

try {
  run("pnpm", ["verify"]);
  run("git", ["commit", "--message", `Release ${version}`, "--", "package.json", "CHANGELOG.md"]);
} catch {
  if (!dryRun) execFileSync("git", ["checkout", "--", "package.json", "CHANGELOG.md"]);
  fail("the verify or the commit failed. package.json and CHANGELOG.md are back as they were.");
}
// An annotated tag, because the maintainer's Git signs tags and a signed tag needs a message.
run("git", ["tag", "--message", `mercos-sdk ${version}`, `v${version}`]);
// Atomic: the branch and the tag go up together or not at all.
run("git", ["push", "--atomic", "origin", "main", `v${version}`]);

console.log(`\nPushed. The Release workflow now stages ${version} on npm and creates the GitHub release.`);
console.log("Last step: approve it at https://www.npmjs.com/package/mercos-sdk, in the staging queue.");
