import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeScratchDirs, scratchDir } from "../src/repo.test-support";

const MANIFEST = join(import.meta.dir, "..", "package.json");
const NPM_KEY_PREFIX = "npm_";

afterEach(removeScratchDirs);

function npmEnv(globalConfig: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.toLowerCase().startsWith(NPM_KEY_PREFIX)) env[name] = value;
  }
  env.npm_config_globalconfig = globalConfig;
  env.npm_config_update_notifier = "false";
  return env;
}

function fixedByNpm(manifest: string): unknown {
  const dir = scratchDir();
  const path = join(dir, "package.json");
  const globalConfig = join(dir, "global-npmrc");
  writeFileSync(path, manifest);
  writeFileSync(globalConfig, "");
  const ran = spawnSync("npm", ["pkg", "fix"], { cwd: dir, encoding: "utf8", env: npmEnv(globalConfig) });
  if (ran.status !== 0) throw new Error(`npm pkg fix exited ${ran.status}: ${ran.stderr}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("package.json", () => {
  test("npm publishes it as written, correcting nothing", () => {
    const manifest = readFileSync(MANIFEST, "utf8");
    expect(fixedByNpm(manifest)).toEqual(JSON.parse(manifest));
  });

  test("the npm on PATH corrects a bin path that starts with ./", () => {
    const manifest = JSON.stringify({
      name: "made-up",
      version: "0.0.0",
      bin: { "made-up": "./bin/made-up" },
    });
    expect(fixedByNpm(manifest)).toEqual({
      name: "made-up",
      version: "0.0.0",
      bin: { "made-up": "bin/made-up" },
    });
  });
});
