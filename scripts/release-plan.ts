#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { exitWithError, exitWithResult } from "../src/output";
import { outputFile, outputsOf, planInputs, planRelease } from "../src/plan";
import { openCheckout } from "../src/project";

const COMMAND = "release-plan";

try {
  const inputs = planInputs(process.env);
  const plan = await planRelease(openCheckout(process.cwd(), process.env), inputs);
  appendFileSync(inputs.output, outputFile(outputsOf(plan), `PLAN_${crypto.randomUUID()}`));
  exitWithResult(COMMAND, plan, 0);
} catch (error) {
  exitWithError(COMMAND, error);
}
