import { parseArgs } from "node:util";
import { check } from "./check";
import { type Command, PROGRAM, type Runtime, usageError } from "./cli-contract";
import { messageOf } from "./coded-error";
import { type Checkout, chooseApp, openCheckout, type Project } from "./project";

function refuseArguments(command: Command, detail: string): never {
  throw usageError("bad_arguments", { command: command.name, detail, usage: command.usage });
}

function positionalsOf(command: Command, args: readonly string[]): readonly string[] {
  const read = (() => {
    try {
      return parseArgs({ args: [...args], options: {}, allowPositionals: true, strict: true });
    } catch (error) {
      return refuseArguments(command, messageOf(error));
    }
  })();
  const empty = read.positionals.some((positional) => positional.trim() === "");
  if (empty) refuseArguments(command, "got an empty argument");
  return read.positionals;
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

const checkCommand: Command = {
  name: "check",
  usage: `${PROGRAM} check [<app>]`,
  summary: "judge whether HEAD is ready to release, changing nothing",
  run(args: readonly string[], runtime: Runtime): unknown {
    const positionals = positionalsOf(this, args);
    atMost(this, positionals, 1);
    const checkout = openCheckout(runtime.cwd, runtime.processEnv);
    return check(projectFor(this, checkout, positionals[0] ?? null));
  },
};

export const COMMANDS: readonly Command[] = [checkCommand];
