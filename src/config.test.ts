import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordOf } from "./coded-error";
import { loadConfig } from "./config";
import { removeScratchDirs, scratchDir } from "./repo.test-support";

afterEach(removeScratchDirs);

const SHIP = `version = "package.json"
tag = "v<version>"
branch = "main"
check = "true"
signed = false

[channels.npm]
packages = ["@scope/app"]
smoke = "app --version"
`;

function configWith(npm: string) {
  const dir = scratchDir();
  writeFileSync(join(dir, "ship.toml"), `${SHIP}${npm}`);
  writeFileSync(join(dir, "package.json"), '{"name":"@scope/app","version":"1.0.1"}');
  return loadConfig(dir);
}

function invalidKey(npm: string) {
  try {
    configWith(npm);
  } catch (error) {
    return recordOf(error);
  }
  throw new Error("ship.toml was not refused");
}

function npmSource(npm: string) {
  const config = configWith(npm);
  const channel = config.kind === "single" ? config.app.channels[0] : undefined;
  return channel?.kind === "npm" ? channel.source : null;
}

function smokeNodeOf(npm: string) {
  const config = configWith(npm);
  const channel = config.kind === "single" ? config.app.channels[0] : undefined;
  return channel?.kind === "npm" ? channel.smokeNode : "no npm channel";
}

describe("the npm channel's smoke-node", () => {
  test("is false when the channel does not name it, and what it names otherwise", () => {
    expect(smokeNodeOf("")).toBe(false);
    expect(smokeNodeOf("smoke-node = true\n")).toBe(true);
    expect(smokeNodeOf("smoke-node = false\n")).toBe(false);
  });

  test("is refused when it is not true or false", () => {
    const error = invalidKey('smoke-node = "yes"\n');
    expect([error.code, error.message]).toEqual([
      "config_invalid",
      "ship.toml: channels.npm.smoke-node must be true or false",
    ]);
  });
});

describe("the npm channel's source", () => {
  test("is the tracked package.json files with no build, and the build's out with one", () => {
    expect(npmSource("")).toEqual({ kind: "tracked" });
    expect(npmSource('build = "make npm"\nout = "dist/npm"\n')).toEqual({
      kind: "built",
      build: "make npm",
      out: "dist/npm",
    });
  });

  test("is refused with a build and no out, an out and no build, or an out outside the checkout", () => {
    const cases = [
      { npm: 'build = "make npm"\n', key: "channels.npm.out" },
      { npm: 'out = "dist/npm"\n', key: "channels.npm.build" },
      { npm: 'build = "make npm"\nout = "/tmp/npm"\n', key: "channels.npm.out" },
      { npm: 'build = "make npm"\nout = "dist/../../npm"\n', key: "channels.npm.out" },
      { npm: 'build = ""\nout = "dist/npm"\n', key: "channels.npm.build" },
    ];
    for (const { npm, key } of cases) {
      const error = invalidKey(npm);
      expect([error.code, error.message.startsWith(`ship.toml: ${key} `)]).toEqual(["config_invalid", true]);
    }
  });
});

const RELEASE = `
[channels.github-release]
build = "scripts/build"
files = ["dist/app.tar.gz"]
`;

function assembleOf(extra: string) {
  const config = configWith(`${RELEASE}${extra}`);
  const channel = config.kind === "single" ? config.app.channels[1] : undefined;
  return channel?.kind === "github-release" ? channel.assemble : "no github-release channel";
}

describe("the github-release channel's assemble", () => {
  test("is the command it names, or null when it names none", () => {
    expect(assembleOf('assemble = "scripts/sums"\n')).toBe("scripts/sums");
    expect(assembleOf("")).toBeNull();
  });

  test("is refused when empty", () => {
    const error = invalidKey(`${RELEASE}assemble = ""\n`);
    expect([error.code, error.message.startsWith("ship.toml: channels.github-release.assemble ")]).toEqual([
      "config_invalid",
      true,
    ]);
  });
});
