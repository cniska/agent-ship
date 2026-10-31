import { afterEach, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  githubRequests,
  type Ran,
  registryRequests,
  removeScratchDirs,
  run,
  usageCodeOf,
  type World,
  world,
  write,
} from "./harness";

afterEach(removeScratchDirs);

const ASK = ["notice", "tool", "owner/tool"];

const REFUSED =
  "If the upgrade is refused as a third-party install, do not retry it: hand the owner that exact command to run.";

const DAY_AND_AN_HOUR_MS = 25 * 60 * 60 * 1000;

type Layout = "homebrew" | "npm" | "bun" | "github" | "checkout";

function homeOf(w: World): string {
  return String(w.env.HOME);
}

function programPath(w: World, layout: Layout): string {
  const paths: Readonly<Record<Layout, readonly string[]>> = {
    homebrew: [w.root, "brew", "Cellar", "tool", "1.0.0", "bin", "tool"],
    npm: [w.root, "npm", "lib", "node_modules", "@scope", "tool", "tool"],
    bun: [homeOf(w), ".bun", "install", "global", "node_modules", "@scope", "tool", "tool"],
    github: [homeOf(w), ".local", "bin", "tool"],
    checkout: [w.root, "code", "tool", "bin", "tool"],
  };
  return join(...paths[layout]);
}

function install(w: World, layout: Layout, printed = "1.0.0"): void {
  const path = programPath(w, layout);
  write(dirname(path), "tool", `#!/bin/sh\necho ${printed}\n`);
  chmodSync(path, 0o755);
  if (layout === "homebrew")
    write(
      join(w.root, "brew", "Cellar", "tool", "1.0.0"),
      "INSTALL_RECEIPT.json",
      '{"source":{"tap":"owner/tap"}}\n',
    );
  symlinkSync(path, join(w.bin, "tool"));
}

function registryLatest(w: World, version: string): void {
  write(
    w.registry,
    "@scope/tool.json",
    `${JSON.stringify({ name: "@scope/tool", "dist-tags": { latest: version } })}\n`,
  );
}

function latestRelease(w: World, version: string): void {
  write(w.github, "repos/owner/tool/releases/latest", `${JSON.stringify({ tag_name: `v${version}` })}\n`);
}

function tapFormula(w: World, version: string): void {
  const url = (target: string) =>
    `      url "https://github.com/owner/tool/releases/download/v${version}/tool-${target}.tar.gz"\n`;
  write(
    w.github,
    "repos/owner/homebrew-tap/contents/Formula/tool.rb",
    `class Tool < Formula\n  on_macos do\n${url("darwin-arm64")}  end\n  on_linux do\n${url("linux-x64")}  end\nend\n`,
  );
}

function hostPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

function record(w: World): unknown {
  return JSON.parse(readFileSync(join(w.root, "cache", "agent-ship", "notice", "tool.json"), "utf8"));
}

function note(command: string): string {
  return `tool 1.0.0 is installed, and 1.1.0 is out. Upgrade it now, before other work, by running: \`${command}\` ${REFUSED}\n`;
}

function silent(ran: Ran): void {
  expect(ran).toEqual({ exitCode: 0, stdout: "", stderr: "" });
}

test("AC-37 notice names the installed and newest versions and the upgrade for the channel the copy came from, and says nothing when current or from a checkout", () => {
  const brew = world();
  install(brew, "homebrew");
  tapFormula(brew, "1.1.0");
  expect(run(brew, brew.root, ASK)).toEqual({
    exitCode: 0,
    stdout: note("brew upgrade owner/tap/tool"),
    stderr: "",
  });
  expect(githubRequests(brew)).toEqual([
    "GET /repos/owner/homebrew-tap/contents/Formula/tool.rb application/vnd.github.raw+json",
  ]);

  for (const [layout, command] of [
    ["npm", "npm install --global @scope/tool@latest"],
    ["bun", "bun add --global @scope/tool@latest"],
  ] as const) {
    const w = world();
    install(w, layout);
    registryLatest(w, "1.1.0");
    expect(run(w, w.root, ASK)).toEqual({ exitCode: 0, stdout: note(command), stderr: "" });
  }

  const release = world();
  install(release, "github");
  latestRelease(release, "1.1.0");
  const download = "https://github.com/owner/tool/releases/download/v1.1.0";
  const tarball = `tool-${hostPlatform()}.tar.gz`;
  expect(run(release, release.root, ASK)).toEqual({
    exitCode: 0,
    stdout: note(
      `(d=$(mktemp -d) && cd "$d" && curl -fsSL -O ${download}/${tarball} -O ${download}/SHA256SUMS.txt && shasum -a 256 --check --ignore-missing SHA256SUMS.txt && tar -xzf ${tarball} && mv tool '${homeOf(release)}/.local/bin/tool')`,
    ),
    stderr: "",
  });

  const current = world();
  install(current, "npm");
  registryLatest(current, "1.0.0");
  silent(run(current, current.root, ASK));

  const checkout = world();
  install(checkout, "checkout");
  registryLatest(checkout, "1.1.0");
  latestRelease(checkout, "1.1.0");
  silent(run(checkout, checkout.root, ASK));
  expect(registryRequests(checkout)).toEqual([]);
  expect(githubRequests(checkout)).toEqual([]);
});

test("AC-38 a failed lookup, a missing program and an unreadable version leave notice silent, with the failure's cause in its record", () => {
  const failing = world();
  install(failing, "npm");
  write(failing.registry, "FAILING", "\n");
  silent(run(failing, failing.root, ASK));
  expect(record(failing)).toMatchObject({
    source: "npm @scope/tool",
    found: { kind: "failed", code: "http_503" },
  });

  const limited = world();
  install(limited, "github");
  write(limited.github, "RATE_LIMITED", "\n");
  silent(run(limited, limited.root, ASK));
  expect(record(limited)).toMatchObject({
    source: "github owner/tool",
    found: { kind: "failed", code: "http_403" },
  });

  const absent = world();
  registryLatest(absent, "1.1.0");
  silent(run(absent, absent.root, ASK));

  const unversioned = world();
  install(unversioned, "npm", "dev");
  registryLatest(unversioned, "1.1.0");
  silent(run(unversioned, unversioned.root, ASK));
  for (const w of [absent, unversioned]) expect(registryRequests(w)).toEqual([]);
});

test("AC-39 notice asks the network at most once a day per program, a failed lookup included", () => {
  const w = world();
  install(w, "npm");
  registryLatest(w, "1.1.0");
  const expected = note("npm install --global @scope/tool@latest");
  expect(run(w, w.root, ASK).stdout).toBe(expected);
  expect(run(w, w.root, ASK).stdout).toBe(expected);
  expect(registryRequests(w)).toEqual(["GET /@scope%2ftool"]);

  registryLatest(w, "1.2.0");
  const later = run(w, w.root, ASK, { CLOCK_STAND_IN_OFFSET_MS: String(DAY_AND_AN_HOUR_MS) });
  expect(later.stdout).toBe(expected.replace("1.1.0 is out", "1.2.0 is out"));
  expect(registryRequests(w)).toHaveLength(2);

  const failing = world();
  install(failing, "npm");
  write(failing.registry, "FAILING", "\n");
  silent(run(failing, failing.root, ASK));
  rmSync(join(failing.registry, "FAILING"));
  registryLatest(failing, "1.1.0");
  silent(run(failing, failing.root, ASK));
  expect(registryRequests(failing)).toHaveLength(1);
});

test("AC-40 notice without a program and an owner/repo, with an extra argument, or with either malformed is bad_arguments", () => {
  const w = world();
  for (const args of [
    ["notice"],
    ["notice", "tool"],
    ["notice", "tool", "owner/tool", "extra"],
    ["notice", "tool", "owner"],
    ["notice", "../tool", "owner/tool"],
  ])
    expect(usageCodeOf(run(w, w.root, args))).toBe("bad_arguments");
});
