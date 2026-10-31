import { writeSync } from "node:fs";
import { encode } from "@toon-format/toon";
import { unreachable } from "./assert";
import { EXIT_STATUS, recordOf } from "./coded-error";

export type ResultStatus = 0 | 1;

export type Outcome =
  | { readonly kind: "result"; readonly value: unknown; readonly status: ResultStatus }
  | { readonly kind: "text"; readonly text: string | null };

const STDOUT = 1;

const STDERR = 2;

export function exitWithResult(command: string, value: unknown, status: ResultStatus): never {
  writeSync(STDOUT, `${encode({ command, ok: true, result: value ?? null })}\n`);
  return process.exit(status);
}

function exitWithText(text: string | null): never {
  if (text !== null) writeSync(STDOUT, `${text}\n`);
  return process.exit(0);
}

export function exitWithOutcome(command: string, outcome: Outcome): never {
  switch (outcome.kind) {
    case "result":
      return exitWithResult(command, outcome.value, outcome.status);
    case "text":
      return exitWithText(outcome.text);
    default:
      return unreachable(outcome);
  }
}

export function exitWithVersion(version: string): never {
  writeSync(STDOUT, `${version}\n`);
  return process.exit(0);
}

export function exitWithError(command: string, error: unknown): never {
  const record = recordOf(error);
  writeSync(STDERR, `${encode({ command, ok: false, error: record })}\n`);
  return process.exit(EXIT_STATUS[record.kind]);
}
