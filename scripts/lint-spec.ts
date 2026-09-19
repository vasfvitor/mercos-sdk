// Checks that spec/mercos-openapi.json is a structurally valid OpenAPI document. The merge script
// rewrites schemas, so a slip there could emit a broken file that the type generator still accepts.
import { createConfig, lint } from "@redocly/openapi-core";
import { SPEC_FILE } from "./lib/docs.ts";

// Only structure. The style rules (descriptions, tags, operation naming) would judge the Mercos
// documentation, which this project doesn't control.
const config = await createConfig({
  rules: {
    struct: "error",
    "no-unresolved-refs": "error",
    "operation-operationId-unique": "error",
    "no-identical-paths": "error",
    "path-parameters-defined": "error",
    "no-invalid-schema-examples": "off",
  },
});

const problems = await lint({ ref: SPEC_FILE, config });
for (const problem of problems) {
  const where = problem.location[0]?.pointer ?? "";
  console.error(`${problem.severity}: ${problem.ruleId}: ${problem.message} (${where})`);
}
if (problems.some((problem) => problem.severity === "error")) process.exitCode = 1;
else console.log(`${SPEC_FILE} is a valid OpenAPI document.`);
