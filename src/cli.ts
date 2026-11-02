#!/usr/bin/env bun
import { name as packageName, version } from "../package.json";
import { githubApiOf, registryOf } from "./channels";
import { COMMANDS } from "./cli-commands";
import { type Command, type Outcome, PROGRAM, type Runtime, usageError } from "./cli-contract";
import { exitWithError, exitWithResult, exitWithVersion, printNotice } from "./output";
import { stateHomeOf, updateLine } from "./update";

const HELP_FLAG = "--help";

const VERSION_FLAG = "--version";

const UPDATE_LIMIT_MS = 1000;

const FLAGS = [
  { name: HELP_FLAG, usage: `${PROGRAM} ${HELP_FLAG}`, summary: "list the commands and flags" },
  { name: VERSION_FLAG, usage: `${PROGRAM} ${VERSION_FLAG}`, summary: "print the version alone on one line" },
];

const runtime: Runtime = {
  cwd: process.cwd(),
  processEnv: process.env,
  registry: registryOf(process.env.npm_config_registry),
  clock: { now: () => Date.now(), sleep: (ms) => Bun.sleepSync(ms) },
};

const notice = await updateLine({
  program: PROGRAM,
  pkg: packageName,
  executable: process.execPath,
  running: version,
  stateHome: stateHomeOf(process.env.XDG_STATE_HOME, process.env.HOME),
  off: Boolean(process.env.CI || process.env.AGENT_SHIP_NO_UPDATE_CHECK),
  registry: runtime.registry,
  githubApi: githubApiOf(process.env.GITHUB_API_URL),
  limitMs: UPDATE_LIMIT_MS,
  now: runtime.clock.now(),
});

if (notice !== null) printNotice(notice);

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

async function ranOrExited(chosen: Command): Promise<Outcome> {
  try {
    return await chosen.run(args, runtime);
  } catch (error) {
    return exitWithError(chosen.name, error);
  }
}

const { value, status } = await ranOrExited(command);

exitWithResult(command.name, value, status);
