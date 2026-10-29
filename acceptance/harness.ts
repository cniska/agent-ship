import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { decode } from "@toon-format/toon";
import type { State as GhState } from "./gh";

const LAUNCH = join(import.meta.dir, "launch.ts");

const GH = join(import.meta.dir, "gh.ts");

const PROGRAMS = ["git", "ssh-keygen"];

const LINUX = "linux";

type Env = Readonly<Record<string, string>>;

export type World = {
  readonly root: string;
  readonly env: Env;
  readonly bin: string;
  readonly ghState: string;
  readonly ghLog: string;
  readonly registry: string;
  readonly registryLog: string;
  readonly tap: string;
};

export type Ran = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

export type Shown = Readonly<Record<string, unknown>>;

const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-ship-acceptance-")));
  scratchDirs.push(dir);
  return dir;
}

export function removeScratchDirs(): void {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

export function deniedNetwork(command: readonly string[]): readonly string[] {
  if (process.platform !== LINUX) return command;
  const searched = `${process.env.PATH ?? ""}:/usr/sbin:/sbin`;
  return [
    firstOnPath("unshare", searched),
    "--user",
    "--map-root-user",
    "--net",
    "--",
    "/bin/sh",
    "-c",
    '"$0" link set lo up && exec "$@"',
    firstOnPath("ip", searched),
    ...command,
  ];
}

function quoted(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

export function binWith(
  root: string,
  programs: readonly string[],
  name = "bin",
  searched = process.env.PATH ?? "",
): string {
  const bin = join(root, name);
  mkdirSync(bin);
  for (const program of programs) symlinkSync(firstOnPath(program, searched), join(bin, program));
  return bin;
}

export function world(): World {
  const root = scratchDir();
  const home = join(root, "home");
  const xdg = { XDG_DATA_HOME: "data", XDG_CONFIG_HOME: "config", XDG_STATE_HOME: "state" };
  for (const dir of [home, ...Object.values(xdg).map((name) => join(root, name))]) mkdirSync(dir);
  const bin = binWith(root, PROGRAMS);
  const launcher = deniedNetwork([process.execPath, LAUNCH]).map(quoted).join(" ");
  script(join(bin, "agent-ship"), `exec ${launcher} "$@"`);
  script(join(bin, "gh"), `exec ${quoted(process.execPath)} ${quoted(GH)} "$@"`);
  const stands = join(root, "stand-ins");
  const stand = {
    ghState: join(stands, "gh.json"),
    ghLog: join(stands, "gh.log"),
    registry: join(stands, "registry"),
    registryLog: join(stands, "registry.log"),
    tap: join(stands, "tap"),
  };
  mkdirSync(stand.registry, { recursive: true });
  mkdirSync(stand.tap);
  writeFileSync(stand.ghState, "{}\n");
  return {
    root,
    bin,
    ...stand,
    env: {
      PATH: bin,
      HOME: home,
      ...Object.fromEntries(Object.entries(xdg).map(([variable, name]) => [variable, join(root, name)])),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "author@example.test",
      GIT_COMMITTER_NAME: "Test Author",
      GIT_COMMITTER_EMAIL: "author@example.test",
      GH_STAND_IN_STATE: stand.ghState,
      GH_STAND_IN_LOG: stand.ghLog,
      GH_STAND_IN_TAP: stand.tap,
      REGISTRY_STAND_IN: stand.registry,
      REGISTRY_STAND_IN_LOG: stand.registryLog,
    },
  };
}

export function run(w: World, cwd: string, args: readonly string[], env: Env = {}): Ran {
  const ran = spawnSync(join(w.bin, "agent-ship"), [...args], {
    cwd,
    encoding: "utf8",
    env: { ...w.env, ...env },
  });
  return { exitCode: ran.status ?? -1, stdout: ran.stdout, stderr: ran.stderr };
}

function isShown(value: unknown): value is Shown {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shown(value: unknown): Shown {
  if (!isShown(value)) throw new Error(`expected a record, got: ${JSON.stringify(value)}`);
  return value;
}

export function shownList(value: unknown): readonly Shown[] {
  if (!Array.isArray(value)) throw new Error(`expected a list, got: ${JSON.stringify(value)}`);
  return value.map(shown);
}

function expectExit(ran: Ran, status: number): void {
  if (ran.exitCode !== status)
    throw new Error(`expected exit ${status}, got ${ran.exitCode}:\n${ran.stdout}${ran.stderr}`);
}

function shownAt(text: string, key: string): Shown {
  const decoded: unknown = decode(text);
  const found = isShown(decoded) ? decoded[key] : undefined;
  if (!isShown(found)) throw new Error(`expected a record at ${key}, got:\n${text}`);
  return found;
}

export function result(ran: Ran, status = 0): Shown {
  expectExit(ran, status);
  return shownAt(ran.stdout, "result");
}

export function failure(ran: Ran, status: number): Shown {
  expectExit(ran, status);
  if (ran.stdout !== "") throw new Error(`expected nothing on stdout, got:\n${ran.stdout}`);
  return shownAt(ran.stderr, "error");
}

export function refusal(ran: Ran): Shown {
  return failure(ran, 1);
}

export function codeOf(ran: Ran): unknown {
  return refusal(ran).code;
}

export function usageCodeOf(ran: Ran): unknown {
  return failure(ran, 2).code;
}

export function git(w: World, cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe", env: w.env }).trim();
}

export function write(dir: string, file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

export function commit(
  w: World,
  dir: string,
  message: string,
  files: Readonly<Record<string, string>> = {},
): string {
  for (const [file, text] of Object.entries(files)) write(dir, file, text);
  git(w, dir, ["add", "--all"]);
  git(w, dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(w, dir, ["rev-parse", "HEAD"]);
}

export function push(w: World, dir: string): void {
  git(w, dir, ["push", "-q", "origin", "HEAD:main"]);
}

export function packageJson(version: string, name = "app"): string {
  return `${JSON.stringify({ name, version }, null, 2)}\n`;
}

export function bareRemote(w: World, dir: string): string {
  const bare = join(w.root, "remotes", "origin.git");
  mkdirSync(dirname(bare), { recursive: true });
  git(w, w.root, ["init", "-q", "--bare", "-b", "main", bare]);
  git(w, dir, ["remote", "add", "origin", bare]);
  git(w, dir, ["push", "-q", "origin", "main"]);
  return bare;
}

export function emptyRepo(w: World, name = "repo"): string {
  const dir = join(w.root, name);
  mkdirSync(dir);
  git(w, dir, ["init", "-q", "-b", "main"]);
  return dir;
}

export const SHIP_TOML = `version = "package.json"
tag = "v<version>"
branch = "main"
check = "exit 0"
signed = false

[channels.homebrew]
tap = "owner/homebrew-tap"
formula = "Formula/app.rb"
credentials = ["TAP_DISPATCH_TOKEN"]
`;

export const APPS_TOML = (web: string, cli: string) => `branch = "main"
signed = false

[apps.web]
version = "web/package.json"
tag = "<app>-v<version>"
check = "exit 0"
${web}
[apps.web.channels.homebrew]
tap = "owner/homebrew-tap"
formula = "Formula/web.rb"
credentials = ["TAP_DISPATCH_TOKEN"]

[apps.cli]
version = "cli/package.json"
tag = "<app>-v<version>"
check = "exit 0"
${cli}
[apps.cli.channels.homebrew]
tap = "owner/homebrew-tap"
formula = "Formula/cli.rb"
credentials = ["TAP_DISPATCH_TOKEN"]
`;

export const TOKEN_ENV = { TAP_DISPATCH_TOKEN: "test-tap-token" };

export type Released = { readonly w: World; readonly dir: string; readonly origin: string };

export function releasedRepo(
  options: { readonly tagged?: string; readonly version?: string; readonly shipToml?: string } = {},
): Released {
  const w = world();
  const dir = emptyRepo(w);
  const tagged = options.tagged ?? "1.0.0";
  commit(w, dir, "chore: start", {
    "package.json": packageJson(tagged),
    ".gitignore": ".env\n",
    "ship.toml": options.shipToml ?? SHIP_TOML,
  });
  git(w, dir, ["tag", "-a", "-m", `v${tagged}`, `v${tagged}`]);
  commit(w, dir, "fix: handle empty input", { "package.json": packageJson(options.version ?? "1.0.1") });
  const origin = bareRemote(w, dir);
  return { w, dir, origin };
}

export function snapshot(w: World, dir: string, origin: string): string {
  return [
    git(w, dir, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(w, dir, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    git(w, origin, ["for-each-ref", "--format=%(refname) %(objectname)"]),
  ].join("\n");
}

export function ghAnswers(w: World, state: GhState): void {
  writeFileSync(w.ghState, `${JSON.stringify(state)}\n`);
}

function loggedLines(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

export function ghCalls(w: World): readonly (readonly string[])[] {
  return loggedLines(w.ghLog).map((line): readonly string[] => {
    const parsed: unknown = JSON.parse(line);
    if (!Array.isArray(parsed) || !parsed.every((word) => typeof word === "string"))
      throw new Error(`the gh stand-in logged what is not a call: ${line}`);
    return parsed;
  });
}

export function registryServes(w: World, name: string, versions: readonly string[]): void {
  const listed = Object.fromEntries(versions.map((version) => [version, { name, version }]));
  write(w.registry, `${name}.json`, `${JSON.stringify({ name, versions: listed })}\n`);
}

export function registryFails(w: World): void {
  write(w.registry, "FAILING", "\n");
}

export function registryRequests(w: World): readonly string[] {
  return loggedLines(w.registryLog);
}

export function tapHolds(w: World, tap: string, path: string, text: string): void {
  write(join(w.tap, tap), path, text);
}
