import { spawnSync } from "node:child_process";
import { faults } from "./coded-error";

export type ProcessEnv = Readonly<Record<string, string | undefined>>;

export type Ran = { readonly status: number; readonly stdout: string; readonly stderr: string };

const SIGNALLED_STATUS = 128;

const fault = faults<{
  readonly program_unavailable: { readonly program: string; readonly detail: string };
}>({
  program_unavailable: {
    message: ({ program, detail }) => `${program} could not run: ${detail}`,
    resolve: ({ program }) => `install ${program} and put it on PATH, then run the command again`,
  },
});

export type Spawned =
  | (Ran & { readonly started: true })
  | { readonly started: false; readonly detail: string };

export type ExecOptions = { readonly cwd: string; readonly env: ProcessEnv };

export function spawnProgram(
  program: string,
  args: readonly string[],
  options: ExecOptions,
  limitMs: number | null = null,
): Spawned {
  const run = spawnSync(program, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: Number.POSITIVE_INFINITY,
    ...(limitMs === null ? {} : { timeout: limitMs, killSignal: "SIGKILL" }),
  });
  if (run.error) return { started: false, detail: run.error.message };
  return { started: true, status: run.status ?? SIGNALLED_STATUS, stdout: run.stdout, stderr: run.stderr };
}

export function execute(program: string, args: readonly string[], options: ExecOptions): Ran {
  const spawned = spawnProgram(program, args, options);
  if (!spawned.started) throw fault("program_unavailable", { program, detail: spawned.detail });
  return spawned;
}
