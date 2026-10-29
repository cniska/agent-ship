import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { check } from "./check";
import { type Command, type Outcome, PROGRAM, type Runtime, usageError } from "./cli-contract";
import { messageOf } from "./coded-error";
import { doctor, failed as doctorFailed } from "./doctor";
import { appOfTag, type Checkout, chooseApp, openCheckout, type Project } from "./project";
import { rehearse, release, type Target } from "./release";
import { failed as statusFailed, status } from "./status";
import { isLevel, parseVersion } from "./version";

function refuseArguments(command: Command, detail: string): never {
  throw usageError("bad_arguments", { command: command.name, detail, usage: command.usage });
}

type Read = {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
};

const DRY_RUN = "dry-run";

const NO_OPTIONS: ParseArgsOptionsConfig = {};

const RELEASE_OPTIONS: ParseArgsOptionsConfig = { [DRY_RUN]: { type: "boolean" } };

function argumentsOf(command: Command, args: readonly string[], options: ParseArgsOptionsConfig): Read {
  const read = (() => {
    try {
      return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
    } catch (error) {
      return refuseArguments(command, messageOf(error));
    }
  })();
  const empty = read.positionals.some((positional) => positional.trim() === "");
  if (empty) refuseArguments(command, "got an empty argument");
  return { positionals: read.positionals, values: read.values };
}

function targetOf(word: string): Target | null {
  if (isLevel(word)) return { kind: "level", level: word };
  const version = parseVersion(word);
  return version === null ? null : { kind: "version", version };
}

function releaseArguments(command: Command, positionals: readonly string[]) {
  const [first = null, second = null] = positionals;
  const target = first === null ? null : targetOf(first);
  if (second !== null && target === null)
    return refuseArguments(command, `${first} is neither patch, minor, major nor a version x.y.z`);
  if (target === null) return { target: { kind: "bump" } as const, app: first };
  return { target, app: second };
}

function atMost(command: Command, positionals: readonly string[], count: number): void {
  if (positionals.length > count)
    refuseArguments(command, `takes at most ${count}, and got: ${positionals.join(" ")}`);
}

function projectFor(command: Command, checkout: Checkout, app: string | null): Project {
  const choice = chooseApp(checkout.config, app);
  if (!choice.found) return refuseArguments(command, choice.problem);
  return { ...checkout, app: choice.app };
}

function succeeded(value: unknown): Outcome {
  return { value, status: 0 };
}

const checkCommand: Command = {
  name: "check",
  usage: `${PROGRAM} check [<app>]`,
  summary: "judge whether HEAD is ready to release, changing nothing",
  run(args: readonly string[], runtime: Runtime): Outcome {
    const { positionals } = argumentsOf(this, args, NO_OPTIONS);
    atMost(this, positionals, 1);
    const checkout = openCheckout(runtime.cwd, runtime.processEnv);
    return succeeded(check(projectFor(this, checkout, positionals[0] ?? null)));
  },
};

const releaseCommand: Command = {
  name: "release",
  usage: `${PROGRAM} release [<patch|minor|major|<version>>] [<app>] [--dry-run]`,
  summary: "bump the version, commit and tag the release, and print the push command",
  run(args: readonly string[], runtime: Runtime): Outcome {
    const { positionals, values } = argumentsOf(this, args, RELEASE_OPTIONS);
    atMost(this, positionals, 2);
    const { target, app } = releaseArguments(this, positionals);
    const project = projectFor(this, openCheckout(runtime.cwd, runtime.processEnv), app);
    return succeeded(values[DRY_RUN] === true ? rehearse(project, target) : release(project, target));
  },
};

const statusCommand: Command = {
  name: "status",
  usage: `${PROGRAM} status <tag>`,
  summary: "wait on the runs the tag started, then say whether each channel serves its version",
  async run(args: readonly string[], runtime: Runtime): Promise<Outcome> {
    const { positionals } = argumentsOf(this, args, NO_OPTIONS);
    const [tag] = positionals;
    if (tag === undefined) return refuseArguments(this, "needs the tag to report on");
    atMost(this, positionals, 1);
    const checkout = openCheckout(runtime.cwd, runtime.processEnv);
    const chosen = appOfTag(checkout.config, tag);
    if (chosen === null) return refuseArguments(this, `${tag} matches no tag pattern in ship.toml`);
    const { registry, clock } = runtime;
    const report = await status(
      { ...checkout, app: chosen.app },
      { tag, version: chosen.version, registry, clock },
    );
    return { value: report, status: statusFailed(report) ? 1 : 0 };
  },
};

const doctorCommand: Command = {
  name: "doctor",
  usage: `${PROGRAM} doctor`,
  summary: "check git, gh and each credential the channels need, with the fix for each that fails",
  run(args: readonly string[], runtime: Runtime): Outcome {
    const { positionals } = argumentsOf(this, args, NO_OPTIONS);
    atMost(this, positionals, 0);
    const report = doctor(runtime.cwd, runtime.processEnv);
    return { value: report, status: doctorFailed(report) ? 1 : 0 };
  },
};

export const COMMANDS: readonly Command[] = [checkCommand, releaseCommand, statusCommand, doctorCommand];
