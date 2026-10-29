import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recordOf } from "./coded-error";
import { npmInputs, npmOutputs, releasedPackages } from "./npm";
import { openCheckout } from "./project";
import { git, removeScratchDirs, scratchDir } from "./repo.test-support";

afterEach(removeScratchDirs);

const HEAD = `version = "package.json"
tag = "v<version>"
branch = "main"
check = "true"
signed = false
`;

const BUILT = `${HEAD}
[channels.npm]
build = "make npm"
out = "dist/npm"
packages = ["@scope/app-darwin-arm64", "@scope/app-linux-x64", "@scope/app"]
smoke = "app --version"
`;

const TRACKED = `${HEAD}
[channels.npm]
packages = ["@scope/app", "@scope/lib"]
smoke = "app --version"
`;

type Manifest = {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};

function write(dir: string, path: string, manifest: Manifest | string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
}

function repo(ship: string): string {
  const dir = scratchDir();
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "ship.toml"), ship);
  writeFileSync(join(dir, ".gitignore"), "dist/\n");
  write(dir, "package.json", { name: "@scope/app", version: "1.0.1" });
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "feat: app"]);
  return dir;
}

function built(dir: string, root: Manifest = rootManifest()): void {
  write(dir, "dist/npm/darwin-arm64/package.json", { name: "@scope/app-darwin-arm64", version: "1.0.1" });
  write(dir, "dist/npm/linux-x64/package.json", { name: "@scope/app-linux-x64", version: "1.0.1" });
  write(dir, "dist/npm/app/package.json", root);
}

function rootManifest(): Manifest {
  return {
    name: "@scope/app",
    version: "1.0.1",
    optionalDependencies: { "@scope/app-darwin-arm64": "1.0.1", "@scope/app-linux-x64": "1.0.1" },
  };
}

function released(dir: string, tag = "v1.0.1") {
  return releasedPackages(openCheckout(dir, process.env), tag);
}

function refusal(dir: string, tag = "v1.0.1") {
  try {
    released(dir, tag);
  } catch (error) {
    return recordOf(error);
  }
  throw new Error("the packages were not refused");
}

describe("a built npm channel's packages", () => {
  test("publish from the directory under out whose package.json names each, the root installed alone", () => {
    const dir = repo(BUILT);
    built(dir);
    write(dir, "dist/npm/app/node_modules/@scope/app-linux-x64/package.json", {
      name: "@scope/app-linux-x64",
      version: "1.0.1",
    });
    expect(released(dir)).toEqual({
      publish: [
        { name: "@scope/app-darwin-arm64", dir: "dist/npm/darwin-arm64" },
        { name: "@scope/app-linux-x64", dir: "dist/npm/linux-x64" },
        { name: "@scope/app", dir: "dist/npm/app" },
      ],
      install: ["@scope/app"],
    });
  });

  test("are refused when the build wrote no package.json naming one, never reading the tracked ones", () => {
    const dir = repo(BUILT);
    write(dir, "dist/npm/app/package.json", rootManifest());
    write(dir, "dist/npm/darwin-arm64/package.json", { name: "@scope/app-darwin-arm64", version: "1.0.1" });
    expect(refusal(dir)).toMatchObject({
      code: "package_not_built",
      meta: { name: "@scope/app-linux-x64", out: "dist/npm" },
    });
  });

  test("are refused when the build wrote nothing under out", () => {
    expect(refusal(repo(BUILT))).toMatchObject({
      code: "package_not_built",
      meta: { name: "@scope/app-darwin-arm64", out: "dist/npm" },
    });
  });

  test("are refused when one's version is not the release's", () => {
    const dir = repo(BUILT);
    built(dir);
    write(dir, "dist/npm/linux-x64/package.json", { name: "@scope/app-linux-x64", version: "1.0.0" });
    expect(refusal(dir)).toMatchObject({
      code: "package_version_mismatch",
      meta: { name: "@scope/app-linux-x64", dir: "dist/npm/linux-x64", version: "1.0.0", expected: "1.0.1" },
    });
  });

  test("are refused when one is listed before a package it depends on", () => {
    const dir = repo(
      BUILT.replace(
        '"@scope/app-darwin-arm64", "@scope/app-linux-x64", "@scope/app"',
        '"@scope/app-darwin-arm64", "@scope/app", "@scope/app-linux-x64"',
      ),
    );
    built(dir);
    expect(refusal(dir)).toMatchObject({
      code: "package_order",
      meta: { name: "@scope/app", dependency: "@scope/app-linux-x64" },
    });
  });
});

describe("a tracked npm channel's packages", () => {
  test("publish from the directory of the tracked package.json naming each, and install each no other depends on", () => {
    const dir = repo(TRACKED);
    write(dir, "packages/lib/package.json", { name: "@scope/lib", version: "1.0.1" });
    write(dir, "packages/other/package.json", '{"version":"1.0.1"}');
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "feat: lib"]);
    expect(released(dir)).toEqual({
      publish: [
        { name: "@scope/app", dir: "." },
        { name: "@scope/lib", dir: "packages/lib" },
      ],
      install: ["@scope/app", "@scope/lib"],
    });
  });

  test("install only the package nothing depends on", () => {
    const dir = repo(TRACKED.replace('"@scope/app", "@scope/lib"', '"@scope/lib", "@scope/app"'));
    write(dir, "package.json", {
      name: "@scope/app",
      version: "1.0.1",
      dependencies: { "@scope/lib": "1.0.1" },
    });
    write(dir, "packages/lib/package.json", { name: "@scope/lib", version: "1.0.1" });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "feat: lib"]);
    expect(released(dir).install).toEqual(["@scope/app"]);
  });

  test("are refused when no tracked package.json names one, though an untracked one does", () => {
    const dir = repo(TRACKED);
    write(dir, "packages/lib/package.json", { name: "@scope/lib", version: "1.0.1" });
    expect(refusal(dir)).toMatchObject({ code: "package_not_tracked", meta: { name: "@scope/lib" } });
  });
});

describe("the npm job's packages", () => {
  test("are refused for a tag of no app, or of an app with no npm channel", () => {
    const dir = repo(BUILT);
    expect(refusal(dir, "nope")).toMatchObject({
      code: "workflow_input_invalid",
      meta: { variable: "TAG", problem: "is not a release tag of ship.toml" },
    });
    const bare = repo(`${HEAD}\n[channels.homebrew]\ntap = "o/t"\nformula = "F.rb"\ncredentials = ["T"]\n`);
    expect(refusal(bare)).toMatchObject({
      code: "workflow_input_invalid",
      meta: { variable: "TAG", problem: "is the tag of an app with no npm channel" },
    });
  });

  test("read the tag and the output file the workflow sets", () => {
    expect(npmInputs({ TAG: "v1.0.1", GITHUB_OUTPUT: "/dev/null" })).toEqual({
      tag: "v1.0.1",
      output: "/dev/null",
    });
    expect(() => npmInputs({ TAG: "v1.0.1" })).toThrow("GITHUB_OUTPUT is not set");
  });

  test("are written as each package's name and directory, then the names to install", () => {
    expect(
      npmOutputs({
        publish: [
          { name: "@scope/app-linux-x64", dir: "dist/npm/linux x64" },
          { name: "@scope/app", dir: "dist/npm/app" },
        ],
        install: ["@scope/app"],
      }),
    ).toEqual({
      publish: "@scope/app-linux-x64 dist/npm/linux x64\n@scope/app dist/npm/app",
      install: "@scope/app",
    });
  });
});
