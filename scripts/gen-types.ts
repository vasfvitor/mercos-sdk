// Gera src/generated/mercos.ts a partir do documento OpenAPI versionado. Só tipos, nenhum runtime.
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { SPEC_FILE } from "./lib/docs.ts";

const OUTPUT = "src/generated/mercos.ts";
const HEADER = `// Arquivo gerado por scripts/gen-types.ts a partir de ${SPEC_FILE}. Não edite à mão.\n\n`;

const ast = await openapiTS(pathToFileURL(SPEC_FILE), { alphabetize: true });
mkdirSync("src/generated", { recursive: true });
writeFileSync(OUTPUT, HEADER + astToString(ast));
console.log(`Tipos gravados em ${OUTPUT}.`);
