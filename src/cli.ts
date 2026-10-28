#!/usr/bin/env bun
import { version } from "../package.json";
import { COMMANDS } from "./cli-commands";
import { type Command, type Outcome, PROGRAM, type Runtime, usageError } from "./cli-contract";
import { exitWithError, exitWithResult, exitWithVersion } from "./cli-output";

const HELP_FLAG = "--help";

const VERSION_FLAG = "--version";

const FLAGS = [
  { name: HELP_FLAG, usage: `${PROGRAM} ${HELP_FLAG}`, summary: "list the commands and flags" },
  { name: VERSION_FLAG, usage: `${PROGRAM} ${VERSION_FLAG}`, summary: "print the version alone on one line" },
];

const runtime: Runtime = { cwd: process.cwd(), processEnv: process.env };

const [requested = HELP_FLAG, ...args] = process.argv.slice(2);

const flag = FLAGS.find((known) => known.name === requested);

if (flag !== undefined && args.length > 0)
  exitWithError(PROGRAM, usageError("wrong_arity", { command: flag.name, got: args, usage: flag.usage }));

if (requested === HELP_FLAG)
  exitWithResult(
    PROGRAM,
    {
      commands: COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary })),
      flags: FLAGS,
    },
    0,
  );

if (requested === VERSION_FLAG) exitWithVersion(version);

const command = COMMANDS.find((known) => known.name === requested);

if (command === undefined)
  exitWithError(
    PROGRAM,
    usageError("unknown_command", {
      name: requested,
      usage: `${PROGRAM} ${[...COMMANDS, ...FLAGS].map(({ name }) => name).join("|")}`,
    }),
  );

function ranOrExited(chosen: Command): Outcome {
  try {
    return chosen.run(args, runtime);
  } catch (error) {
    return exitWithError(chosen.name, error);
  }
}

const { value, status } = ranOrExited(command);

exitWithResult(command.name, value, status);
