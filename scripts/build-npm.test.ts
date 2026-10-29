import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeScratchDirs, scratchDir } from "../src/repo.test-support";
import { isTable } from "../src/table";
import { builtPackages, npmEnv, STUB_BINARY } from "./npm-build.test-support";

const VERSION: unknown = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
).version;

const PACKAGES = ["darwin-arm64", "linux-x64", "agent-ship"];

afterEach(removeScratchDirs);

function manifest(out: string, dir: string): unknown {
  return JSON.parse(readFileSync(join(out, dir, "package.json"), "utf8"));
}

function fixedByNpm(text: string): unknown {
  const dir = scratchDir();
  writeFileSync(join(dir, "package.json"), text);
  const ran = spawnSync("npm", ["pkg", "fix"], { cwd: dir, encoding: "utf8", env: npmEnv(dir) });
  if (ran.status !== 0) throw new Error(`npm pkg fix exited ${ran.status}: ${ran.stderr}`);
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function packed(dir: string): readonly string[] {
  const ran = spawnSync("npm", ["pack", "--dry-run", "--json", dir], {
    cwd: scratchDir(),
    encoding: "utf8",
    env: npmEnv(scratchDir()),
  });
  if (ran.status !== 0) throw new Error(`npm pack exited ${ran.status}: ${ran.stderr}`);
  const parsed: unknown = JSON.parse(ran.stdout);
  const result: unknown = Array.isArray(parsed) ? parsed[0] : null;
  const files = isTable(result) && Array.isArray(result.files) ? result.files : [];
  return files.map((file) => (isTable(file) ? String(file.path) : "")).toSorted();
}

describe("the npm packages built from the release tarballs", () => {
  test("give each platform its binary, installed only on that platform", () => {
    const out = builtPackages();
    expect(manifest(out, "darwin-arm64")).toEqual({
      name: "@cniska/agent-ship-darwin-arm64",
      version: VERSION,
      description: "The darwin-arm64 build of @cniska/agent-ship.",
      license: "MIT",
      homepage: "https://github.com/cniska/agent-ship",
      repository: { type: "git", url: "git+https://github.com/cniska/agent-ship.git" },
      os: ["darwin"],
      cpu: ["arm64"],
      files: ["agent-ship"],
    });
    expect(manifest(out, "linux-x64")).toMatchObject({
      name: "@cniska/agent-ship-linux-x64",
      version: VERSION,
      os: ["linux"],
      cpu: ["x64"],
      files: ["agent-ship"],
    });
    expect(readFileSync(join(out, "linux-x64", "agent-ship"), "utf8")).toBe(STUB_BINARY);
  });

  test("give the root package the launcher alone, with both platforms as optional dependencies at its version", () => {
    const out = builtPackages();
    expect(manifest(out, "agent-ship")).toMatchObject({
      name: "@cniska/agent-ship",
      version: VERSION,
      repository: { type: "git", url: "git+https://github.com/cniska/agent-ship.git" },
      bin: { "agent-ship": "bin/agent-ship" },
      files: ["bin/agent-ship"],
      optionalDependencies: {
        "@cniska/agent-ship-darwin-arm64": VERSION,
        "@cniska/agent-ship-linux-x64": VERSION,
      },
    });
    expect(manifest(out, "agent-ship")).not.toHaveProperty("dependencies");
    const launcher = readFileSync(join(out, "agent-ship", "bin", "agent-ship"), "utf8");
    expect(launcher.startsWith("#!/bin/sh\n")).toBe(true);
    expect(launcher).toContain("\nbuilds='darwin-arm64 linux-x64'\n");
    expect(statSync(join(out, "agent-ship", "bin", "agent-ship")).mode & 0o111).toBe(0o111);
  });

  test("pack each package with its own files only", () => {
    const out = builtPackages();
    expect(PACKAGES.map((dir) => packed(join(out, dir)))).toEqual([
      ["agent-ship", "package.json"],
      ["agent-ship", "package.json"],
      ["LICENSE", "README.md", "bin/agent-ship", "package.json"],
    ]);
  });

  test("are published as written, with nothing for npm to correct", () => {
    const out = builtPackages();
    for (const dir of PACKAGES) {
      const text = readFileSync(join(out, dir, "package.json"), "utf8");
      expect(fixedByNpm(text)).toEqual(JSON.parse(text));
    }
  });

  test("would show npm correcting a bin path that starts with ./", () => {
    const text = JSON.stringify({ name: "made-up", version: "0.0.0", bin: { "made-up": "./bin/made-up" } });
    expect(fixedByNpm(text)).toEqual({
      name: "made-up",
      version: "0.0.0",
      bin: { "made-up": "bin/made-up" },
    });
  });
});
