#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { version } from "../package.json";

type Platform = { readonly os: "darwin" | "linux"; readonly cpu: "arm64" | "x64" };

const PLATFORMS: readonly Platform[] = [
  { os: "darwin", cpu: "arm64" },
  { os: "linux", cpu: "x64" },
];

const SCOPE = "@cniska";
const NAME = "agent-ship";
const ROOT = join(import.meta.dir, "..");
const LAUNCHER = join(ROOT, "npm", NAME);
const BUILDS_TOKEN = "__BUILDS__";
const HOMEPAGE = "https://github.com/cniska/agent-ship";
const REPOSITORY = { type: "git", url: "git+https://github.com/cniska/agent-ship.git" } as const;
const SUMMARY =
  "Release tooling for coding agents: check, make and publish a release to every channel a project ships to, from one config file per repository.";
const KEYWORDS = ["agent", "release", "npm", "homebrew", "github-release", "cli"];
const PACKAGE_FILES = ["README.md", "LICENSE"];
const EXECUTABLE = 0o755;
const USAGE = 2;

const targetOf = ({ os, cpu }: Platform): string => `${os}-${cpu}`;

const platformPackage = (platform: Platform): string => `${SCOPE}/${NAME}-${targetOf(platform)}`;

function platformManifest(platform: Platform): Record<string, unknown> {
  return {
    name: platformPackage(platform),
    version,
    description: `The ${targetOf(platform)} build of ${SCOPE}/${NAME}.`,
    license: "MIT",
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    os: [platform.os],
    cpu: [platform.cpu],
    files: [NAME],
  };
}

function rootManifest(): Record<string, unknown> {
  return {
    name: `${SCOPE}/${NAME}`,
    version,
    description: SUMMARY,
    license: "MIT",
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    bugs: { url: `${HOMEPAGE}/issues` },
    keywords: KEYWORDS,
    bin: { [NAME]: `bin/${NAME}` },
    files: [`bin/${NAME}`],
    optionalDependencies: Object.fromEntries(
      PLATFORMS.map((platform) => [platformPackage(platform), version]),
    ),
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function extractBinary(tarball: string, into: string): void {
  const ran = spawnSync("tar", ["-xzf", tarball, "-C", into, NAME], { stdio: "inherit" });
  if (ran.status !== 0) throw new Error(`${tarball} holds no ${NAME} binary`);
}

function build(artifactsDir: string, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
  for (const platform of PLATFORMS) {
    const dir = join(outDir, targetOf(platform));
    mkdirSync(dir, { recursive: true });
    extractBinary(join(artifactsDir, `${NAME}-${targetOf(platform)}.tar.gz`), dir);
    writeJson(join(dir, "package.json"), platformManifest(platform));
  }
  const root = join(outDir, NAME);
  mkdirSync(join(root, "bin"), { recursive: true });
  writeJson(join(root, "package.json"), rootManifest());
  const launcher = readFileSync(LAUNCHER, "utf8").replace(BUILDS_TOKEN, PLATFORMS.map(targetOf).join(" "));
  writeFileSync(join(root, "bin", NAME), launcher);
  chmodSync(join(root, "bin", NAME), EXECUTABLE);
  for (const file of PACKAGE_FILES) copyFileSync(join(ROOT, file), join(root, file));
}

const [artifactsDir, outDir, ...extra] = process.argv.slice(2);
if (artifactsDir === undefined || outDir === undefined || extra.length > 0) {
  process.stderr.write("usage: bun scripts/build-npm.ts <artifacts-dir> <out-dir>\n");
  process.exit(USAGE);
}
build(artifactsDir, outDir);
process.stdout.write(`${outDir}: ${SCOPE}/${NAME} ${version} and ${PLATFORMS.length} platform packages\n`);
