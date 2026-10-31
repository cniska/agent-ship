#!/usr/bin/env bun
import { version } from "../package.json";
import { githubApiOf, registryOf } from "./channels";
import { COMMANDS } from "./cli-commands";
import { type Command, PROGRAM, type Runtime, usageError } from "./cli-contract";
import { cacheDirOf, platformOf } from "./notice";
import { exitWithError, exitWithOutcome, exitWithResult, exitWithVersion, type Outcome } from "./output";

const HELP_FLAG = "--help";

const LOOKUP_LIMIT_MS = 2000;

const VERSION_FLAG = "--version";

const FLAGS = [
  { name: HELP_FLAG, usage: `${PROGRAM} ${HELP_FLAG}`, summary: "list the commands and flags" },
  { name: VERSION_FLAG, usage: `${PROGRAM} ${VERSION_FLAG}`, summary: "print the version alone on one line" },
];

const runtime: Runtime = {
  cwd: process.cwd(),
  processEnv: process.env,
  registry: registryOf(process.env.npm_config_registry),
  clock: { now: () => Date.now(), sleep: (ms) => Bun.sleepSync(ms) },
  notice: {
    home: process.env.HOME || null,
    cacheDir: cacheDirOf(process.env.XDG_CACHE_HOME, process.env.HOME),
    platform: platformOf(process.platform, process.arch),
    githubApi: githubApiOf(process.env.GITHUB_API_URL),
    limitMs: LOOKUP_LIMIT_MS,
  },
};

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

exitWithOutcome(command.name, await ranOrExited(command));
