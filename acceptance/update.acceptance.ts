import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decode } from "@toon-format/toon";
import { version } from "../package.json";
import {
  type Ran,
  registryFails,
  registryRequests,
  removeScratchDirs,
  run,
  tapHolds,
  type World,
  world,
  write,
} from "./harness";

afterEach(removeScratchDirs);

const ENTRY = join(import.meta.dir, "..", "src", "cli.ts");

const HOMEBREW = join("homebrew", "Cellar", "agent-ship", version, "bin", "agent-ship");

const NPM = join("npm", "lib", "node_modules", "@cniska", "agent-ship-host", "agent-ship");

const BUN = join("bun", "install", "global", "node_modules", "@cniska", "agent-ship-host", "agent-ship");

const BY_HAND = join("by-hand", "agent-ship");

const REGISTRY_PATH = "GET /@cniska%2fagent-ship";

const TAP_PATH = "GET /repos/cniska/homebrew-tap/contents/Formula/agent-ship.rb";

const DAY_MS = 24 * 60 * 60 * 1000;

const [major = "0"] = version.split(".");

const NEWER = `${Number(major) + 1}.0.0`;

const NEWEST = `${Number(major) + 2}.0.0`;

function compiled(w: World): string {
  const out = join(w.root, "compiled", "agent-ship");
  const built = spawnSync(process.execPath, ["build", "--compile", ENTRY, "--outfile", out], {
    encoding: "utf8",
  });
  if (built.status !== 0) throw new Error(`bun build exited ${built.status}: ${built.stderr}`);
  return out;
}

function placed(w: World, binary: string, at: string): string {
  const path = join(w.root, at);
  mkdirSync(dirname(path), { recursive: true });
  linkSync(binary, path);
  return path;
}

function latestOnRegistry(w: World, latest: string): void {
  write(w.registry, "@cniska/agent-ship.json", `${JSON.stringify({ "dist-tags": { latest } })}\n`);
}

function latestInTap(w: World, latest: string): void {
  const urls = ["darwin-arm64", "linux-x64"].map(
    (target) =>
      `    url "https://github.com/cniska/agent-ship/releases/download/v${latest}/agent-ship-${target}.tar.gz"`,
  );
  tapHolds(
    w,
    "cniska/homebrew-tap",
    "Formula/agent-ship.rb",
    `class AgentShip < Formula\n${urls.join("\n")}\nend\n`,
  );
}

function ranAs(w: World, program: string, args: readonly string[], env: Record<string, string> = {}): Ran {
  return run(w, w.root, args, { LAUNCH_PROGRAM: program, ...env });
}

function line(latest: string, command: string): string {
  return `agent-ship ${latest} is out (running ${version}): run ${command}; if you cannot, tell the user.\n`;
}

function recordPath(w: World): string {
  return join(String(w.env.XDG_STATE_HOME), "agent-ship", "update-check.json");
}

test("AC-37 a Homebrew, npm or bun install behind its channel's latest prints the line on stderr before any command's own output, and any other install checks nothing", () => {
  const brewed = world();
  const binary = compiled(brewed);
  latestInTap(brewed, NEWER);
  const homebrew = placed(brewed, binary, HOMEBREW);
  expect(ranAs(brewed, homebrew, ["--version"])).toEqual({
    exitCode: 0,
    stdout: `${version}\n`,
    stderr: line(NEWER, "brew upgrade agent-ship"),
  });
  expect(registryRequests(brewed)).toEqual([TAP_PATH]);

  for (const [at, command] of [
    [NPM, "npm update -g @cniska/agent-ship"],
    [BUN, "bun update -g @cniska/agent-ship"],
  ] as const) {
    const w = world();
    latestOnRegistry(w, NEWER);
    const program = placed(w, binary, at);
    expect(ranAs(w, program, ["--version"])).toEqual({
      exitCode: 0,
      stdout: `${version}\n`,
      stderr: line(NEWER, command),
    });
    const refused = ranAs(w, program, ["check"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe("");
    const [first, ...rest] = refused.stderr.split("\n");
    expect(`${first}\n`).toBe(line(NEWER, command));
    expect(decode(rest.join("\n"))).toMatchObject({ ok: false, error: { code: "not_a_checkout" } });
    expect(registryRequests(w)).toEqual([REGISTRY_PATH]);
  }

  const current = world();
  latestOnRegistry(current, version);
  expect(ranAs(current, placed(current, binary, NPM), ["--version"])).toEqual({
    exitCode: 0,
    stdout: `${version}\n`,
    stderr: "",
  });

  const byHand = world();
  latestOnRegistry(byHand, NEWER);
  latestInTap(byHand, NEWER);
  expect(ranAs(byHand, placed(byHand, binary, BY_HAND), ["--version"])).toEqual({
    exitCode: 0,
    stdout: `${version}\n`,
    stderr: "",
  });
  expect(registryRequests(byHand)).toEqual([]);
});

test("AC-38 the channel is asked at most once a day, a failed ask counts as that day's and prints nothing, and an unwritable record asks nothing", () => {
  const w = world();
  const binary = compiled(w);
  latestOnRegistry(w, NEWER);
  const npm = placed(w, binary, NPM);
  const command = "npm update -g @cniska/agent-ship";
  expect(ranAs(w, npm, ["--version"]).stderr).toBe(line(NEWER, command));
  expect(ranAs(w, npm, ["--version"]).stderr).toBe(line(NEWER, command));
  expect(registryRequests(w)).toEqual([REGISTRY_PATH]);

  const kept = JSON.parse(readFileSync(recordPath(w), "utf8"));
  writeFileSync(recordPath(w), JSON.stringify({ ...kept, checked: kept.checked - DAY_MS - 60 * 60 * 1000 }));
  latestOnRegistry(w, NEWEST);
  expect(ranAs(w, npm, ["--version"]).stderr).toBe(line(NEWEST, command));
  expect(registryRequests(w)).toEqual([REGISTRY_PATH, REGISTRY_PATH]);

  const failing = world();
  latestOnRegistry(failing, NEWER);
  registryFails(failing);
  const failingNpm = placed(failing, binary, NPM);
  expect(ranAs(failing, failingNpm, ["--version"])).toEqual({
    exitCode: 0,
    stdout: `${version}\n`,
    stderr: "",
  });
  expect(JSON.parse(readFileSync(recordPath(failing), "utf8"))).toMatchObject({
    install: "npm",
    latest: null,
  });
  expect(ranAs(failing, failingNpm, ["--version"]).stderr).toBe("");
  expect(registryRequests(failing)).toEqual([REGISTRY_PATH]);

  const unwritable = world();
  latestOnRegistry(unwritable, NEWER);
  writeFileSync(join(String(unwritable.env.XDG_STATE_HOME), "agent-ship"), "not a directory\n");
  expect(ranAs(unwritable, placed(unwritable, binary, NPM), ["--version"])).toEqual({
    exitCode: 0,
    stdout: `${version}\n`,
    stderr: "",
  });
  expect(registryRequests(unwritable)).toEqual([]);
});

test("AC-39 with CI or AGENT_SHIP_NO_UPDATE_CHECK set, nothing is asked and nothing printed", () => {
  const w = world();
  const binary = compiled(w);
  latestOnRegistry(w, NEWER);
  const npm = placed(w, binary, NPM);
  for (const variable of ["CI", "AGENT_SHIP_NO_UPDATE_CHECK"])
    expect(ranAs(w, npm, ["--version"], { [variable]: "1" })).toEqual({
      exitCode: 0,
      stdout: `${version}\n`,
      stderr: "",
    });
  expect(registryRequests(w)).toEqual([]);
  expect(ranAs(w, npm, ["--version"]).stderr).toBe(line(NEWER, "npm update -g @cniska/agent-ship"));
});
