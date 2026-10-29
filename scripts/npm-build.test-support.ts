import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "../src/repo.test-support";

const SCRIPT = join(import.meta.dir, "build-npm.ts");

const NPM_KEY_PREFIX = "npm_";

export const STUB_BINARY = "#!/bin/sh\necho stub\n";

export function npmEnv(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.toLowerCase().startsWith(NPM_KEY_PREFIX)) env[name] = value;
  }
  const globalConfig = join(dir, "global-npmrc");
  const userConfig = join(dir, "user-npmrc");
  writeFileSync(globalConfig, "");
  writeFileSync(userConfig, "");
  env.npm_config_globalconfig = globalConfig;
  env.npm_config_userconfig = userConfig;
  env.npm_config_cache = join(dir, "npm-cache");
  env.npm_config_update_notifier = "false";
  return env;
}

function stubTarball(artifacts: string, target: string): void {
  const staging = join(artifacts, target);
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "agent-ship"), STUB_BINARY);
  chmodSync(join(staging, "agent-ship"), 0o755);
  const packed = spawnSync("tar", [
    "-czf",
    join(artifacts, `agent-ship-${target}.tar.gz`),
    "-C",
    staging,
    "agent-ship",
  ]);
  if (packed.status !== 0) throw new Error(`tar exited ${packed.status}`);
}

export function builtPackages(): string {
  const dir = scratchDir();
  const artifacts = join(dir, "artifacts");
  for (const target of ["darwin-arm64", "linux-x64"]) stubTarball(artifacts, target);
  const out = join(dir, "npm");
  const ran = spawnSync(process.execPath, [SCRIPT, artifacts, out], { encoding: "utf8" });
  if (ran.status !== 0) throw new Error(`build-npm exited ${ran.status}: ${ran.stderr}`);
  return out;
}
