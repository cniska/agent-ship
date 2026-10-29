#!/usr/bin/env bun
import { exitWithError, exitWithResult } from "../src/output";
import { mergeTargets, targetInputs } from "../src/targets";

const COMMAND = "target-files";

try {
  exitWithResult(COMMAND, { files: mergeTargets(process.cwd(), targetInputs(process.env)) }, 0);
} catch (error) {
  exitWithError(COMMAND, error);
}
