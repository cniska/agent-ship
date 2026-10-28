import { usageErrors } from "./coded-error";
import type { ProcessEnv } from "./exec";
import type { Clock } from "./status";

export const PROGRAM = "agent-ship";

export type Runtime = {
  readonly cwd: string;
  readonly processEnv: ProcessEnv;
  readonly registry: string;
  readonly clock: Clock;
};

export type ResultStatus = 0 | 1;

export type Outcome = { readonly value: unknown; readonly status: ResultStatus };

export type Command = {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  run(args: readonly string[], runtime: Runtime): Outcome | Promise<Outcome>;
};

export const usageError = usageErrors<{
  readonly unknown_command: { readonly name: string; readonly usage: string };
  readonly wrong_arity: { readonly command: string; readonly got: readonly string[]; readonly usage: string };
  readonly bad_arguments: { readonly command: string; readonly detail: string; readonly usage: string };
}>({
  unknown_command: {
    message: ({ name }) => `${name} is not an ${PROGRAM} command; ${PROGRAM} --help lists them`,
    resolve: ({ usage }) => usage,
  },
  wrong_arity: {
    message: ({ command, got }) => `${PROGRAM} ${command} takes no argument, and got: ${got.join(" ")}`,
    resolve: ({ usage }) => usage,
  },
  bad_arguments: {
    message: ({ command, detail }) => `${PROGRAM} ${command}: ${detail}`,
    resolve: ({ usage }) => usage,
  },
});
