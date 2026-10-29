#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { npmInputs, npmOutputs, releasedPackages } from "../src/npm";
import { exitWithError, exitWithResult } from "../src/output";
import { outputFile } from "../src/plan";
import { openCheckout } from "../src/project";

const COMMAND = "npm-packages";

try {
  const inputs = npmInputs(process.env);
  const release = releasedPackages(openCheckout(process.cwd(), process.env), inputs.tag);
  appendFileSync(inputs.output, outputFile(npmOutputs(release), `PACKAGES_${crypto.randomUUID()}`));
  exitWithResult(COMMAND, release, 0);
} catch (error) {
  exitWithError(COMMAND, error);
}
