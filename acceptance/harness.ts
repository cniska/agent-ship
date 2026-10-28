import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "src", "cli.ts");

type Env = Readonly<Record<string, string>>;

type World = { readonly root: string; readonly env: Env };

const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-ship-acceptance-")));
  scratchDirs.push(dir);
  return dir;
}

export function removeScratchDirs(): void {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function world(): World {
  const root = scratchDir();
  const home = join(root, "home");
  const xdg = { XDG_DATA_HOME: "data", XDG_CONFIG_HOME: "config", XDG_STATE_HOME: "state" };
  for (const dir of [home, ...Object.values(xdg).map((name) => join(root, name))]) mkdirSync(dir);
  return {
    root,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      ...Object.fromEntries(Object.entries(xdg).map(([variable, name]) => [variable, join(root, name)])),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "author@example.test",
      GIT_COMMITTER_NAME: "Test Author",
      GIT_COMMITTER_EMAIL: "author@example.test",
    },
  };
}

function launcher(bin: string): void {
  const path = join(bin, "agent-ship");
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${ENTRY}" "$@"\n`);
  chmodSync(path, 0o755);
}

function isExecutableFile(path: string): boolean {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats?.isFile() === true && (stats.mode & 0o111) !== 0;
}

function isMiseShim(path: string): boolean {
  return basename(realpathSync(path)) === "mise";
}

function firstOnPath(tool: string, searched: string): string {
  const found = searched
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, tool))
    .find((path) => isExecutableFile(path) && !isMiseShim(path));
  if (found === undefined) throw new Error(`${tool} is not on PATH`);
  return found;
}

export function binWith(
  w: World,
  programs: readonly string[],
  cli: boolean,
  name = "bin",
  searched = process.env.PATH ?? "",
): string {
  const bin = join(w.root, name);
  mkdirSync(bin);
  for (const program of programs) symlinkSync(firstOnPath(program, searched), join(bin, program));
  if (cli) launcher(bin);
  return bin;
}

export function git(w: World, cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe", env: w.env }).trim();
}

function commit(w: World, dir: string, file: string): string {
  writeFileSync(join(dir, file), `${file}\n`);
  git(w, dir, ["add", file]);
  git(w, dir, ["commit", "-q", "-m", file]);
  return git(w, dir, ["rev-parse", "HEAD"]);
}

export function repo(w: World, name = "repo"): string {
  const dir = join(w.root, name);
  mkdirSync(dir);
  git(w, dir, ["init", "-q", "-b", "main"]);
  commit(w, dir, "first");
  return dir;
}

export function bareRemote(w: World, dir: string): string {
  const bare = join(w.root, "remotes", "origin.git");
  mkdirSync(dirname(bare), { recursive: true });
  git(w, w.root, ["init", "-q", "--bare", "-b", "main", bare]);
  git(w, dir, ["remote", "add", "origin", bare]);
  git(w, dir, ["push", "-q", "origin", "main"]);
  return bare;
}
