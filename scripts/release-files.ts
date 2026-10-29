#!/usr/bin/env bun
import { exitWithError, exitWithResult } from "../src/output";
import { publishFiles, publishInputs } from "../src/publish";

const COMMAND = "release-files";

try {
  const inputs = publishInputs(process.env);
  const calls = publishFiles({ root: process.cwd(), env: process.env }, inputs);
  exitWithResult(COMMAND, { tag: inputs.tag, calls: calls.map((call) => `gh ${call.join(" ")}`) }, 0);
} catch (error) {
  exitWithError(COMMAND, error);
}
