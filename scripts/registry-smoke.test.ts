import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeScratchDirs, scratchDir } from "../src/repo.test-support";

const SCRIPT = join(import.meta.dir, "registry-smoke");

const SMOKE = 'printf "%s %s %s %s\\n" "$(app)" "$VERSION" "$PWD" "$(command -v node || echo no-node)"';

afterEach(removeScratchDirs);

function program(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

function smoke(programs: readonly string[], nodeDir: "none" | "with node") {
  const root = scratchDir();
  const bin = join(root, "bin");
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  program(bin, "app", "echo app-ran");
  for (const name of programs) program(bin, name, "exit 0");
  const node = join(root, "node");
  program(node, "node", "exit 0");
  return {
    checkout,
    ran: spawnSync(SCRIPT, [], {
      cwd: checkout,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        BIN: bin,
        SMOKE,
        VERSION: "1.0.1",
        NODE_DIR: nodeDir === "with node" ? node : "",
      },
    }),
  };
}

describe("registry-smoke", () => {
  test("runs the smoke in the checkout with the installed programs on PATH and the version set", () => {
    const { checkout, ran } = smoke([], "none");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(`app-ran 1.0.1 ${checkout} no-node\n`);
  });

  test("refuses a PATH that holds bun, and runs no smoke", () => {
    const { ran } = smoke(["bun"], "with node");
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("bun is on the smoke PATH");
    expect(ran.stdout).toBe("");
  });

  test("refuses a PATH that holds node when the channel does not set smoke-node, and runs no smoke", () => {
    const { ran } = smoke(["node"], "none");
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("node is on the smoke PATH");
    expect(ran.stdout).toBe("");
  });

  test("puts node's directory on PATH when the channel sets smoke-node", () => {
    const { checkout, ran } = smoke([], "with node");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(`app-ran 1.0.1 ${checkout} ${join(checkout, "..", "node", "node")}\n`);
  });
});
