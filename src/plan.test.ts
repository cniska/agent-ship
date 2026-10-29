import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordOf } from "./coded-error";
import { outputFile, outputsOf, type Plan, planInputs, planRelease } from "./plan";
import { openCheckout } from "./project";
import { git, removeScratchDirs, scratchDir } from "./repo.test-support";

const served = new Set<string>();

const failing = new Set<string>();

const asked: string[] = [];

const registry = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    asked.push(name);
    if (failing.has(name)) return new Response("down", { status: 503 });
    if (!served.has(name)) return new Response("{}", { status: 404 });
    return Response.json({ versions: { "1.0.1": {} } });
  },
});

afterAll(() => registry.stop(true));

afterEach(() => {
  served.clear();
  failing.clear();
  asked.length = 0;
  removeScratchDirs();
});

const SHIP = `version = "package.json"
tag = "v<version>"
branch = "main"
check = "true"
signed = false

[channels.npm]
packages = ["@scope/app", "@scope/lib"]
smoke = "app --version"
credentials = ["NPM_SMOKE_KEY"]
`;

function project(): string {
  const dir = scratchDir();
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "ship.toml"), SHIP);
  writeFileSync(join(dir, "package.json"), '{"name":"@scope/app","version":"1.0.1"}\n');
  mkdirSync(join(dir, "packages", "lib"), { recursive: true });
  writeFileSync(join(dir, "packages", "lib", "package.json"), '{"name":"@scope/lib","version":"1.0.1"}\n');
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "feat: app"]);
  return dir;
}

function inputs(tag: string, secrets: readonly string[]) {
  return planInputs({
    TAG: tag,
    SECRET_NAMES: JSON.stringify(secrets),
    GITHUB_OUTPUT: "/dev/null",
    npm_config_registry: registry.url.href,
  });
}

async function refusal(dir: string, tag: string, secrets: readonly string[]) {
  try {
    await planRelease(openCheckout(dir, process.env), inputs(tag, secrets));
  } catch (error) {
    return recordOf(error);
  }
  throw new Error("the plan was not refused");
}

describe("the release plan", () => {
  test("refuses a tag that is not the version source's release tag, naming the tag it would be", async () => {
    const dir = project();
    for (const tag of ["v1.0.2", "v-nope", "app-v1.0.1"]) {
      const error = await refusal(dir, tag, ["NPM_SMOKE_KEY"]);
      expect(error.code).toBe("tag_mismatch");
      expect(error.meta).toEqual({ tag, releaseTags: ["v1.0.1"] });
    }
  });

  test("refuses a credential the channels name that the workflow was not given", async () => {
    const error = await refusal(project(), "v1.0.1", ["OTHER"]);
    expect(error.code).toBe("missing_credential");
    expect(error.meta).toEqual({ credential: "NPM_SMOKE_KEY", channels: ["npm"] });
  });

  test("refuses a package no tracked package.json names", async () => {
    const dir = project();
    git(dir, ["rm", "-q", "packages/lib/package.json"]);
    const error = await refusal(dir, "v1.0.1", ["NPM_SMOKE_KEY"]);
    expect(error.code).toBe("package_not_tracked");
    expect(error.meta).toEqual({ name: "@scope/lib" });
    expect(asked).toEqual([]);
  });

  test("publishes a channel the registry does not serve yet, from each package's directory", async () => {
    served.add("@scope/app");
    const plan = await planRelease(openCheckout(project(), process.env), inputs("v1.0.1", ["NPM_SMOKE_KEY"]));
    expect(plan).toEqual({
      tag: "v1.0.1",
      version: "1.0.1",
      channels: [
        {
          kind: "npm",
          stage: "publish",
          credentials: ["NPM_SMOKE_KEY"],
          packages: [
            { name: "@scope/app", dir: "." },
            { name: "@scope/lib", dir: "packages/lib" },
          ],
          smoke: "app --version",
        },
      ],
    });
  });

  test("skips a channel that already serves the version", async () => {
    served.add("@scope/app");
    served.add("@scope/lib");
    const plan = await planRelease(openCheckout(project(), process.env), inputs("v1.0.1", ["NPM_SMOKE_KEY"]));
    expect(plan.channels.map(({ stage }) => stage)).toEqual(["served"]);
  });

  test("publishes a channel it cannot read, since no publish repeats one already made", async () => {
    served.add("@scope/app");
    failing.add("@scope/lib");
    const plan = await planRelease(openCheckout(project(), process.env), inputs("v1.0.1", ["NPM_SMOKE_KEY"]));
    expect(plan.channels.map(({ stage }) => stage)).toEqual(["publish"]);
  });

  test("refuses inputs the workflow did not set", () => {
    for (const env of [{}, { TAG: "v1", SECRET_NAMES: "[1]", GITHUB_OUTPUT: "/dev/null" }])
      expect(() => planInputs(env)).toThrow();
  });
});

describe("the plan's outputs", () => {
  const plan: Plan = {
    tag: "v1.0.1",
    version: "1.0.1",
    channels: [
      {
        kind: "github-release",
        stage: "served",
        credentials: [],
        build: "scripts/build",
        files: ["dist/a.tar.gz", "dist/b.tar.gz"],
      },
      {
        kind: "homebrew",
        stage: "publish",
        credentials: ["TAP_DISPATCH_TOKEN"],
        tap: "owner/homebrew-tap",
        formula: "Formula/app.rb",
        formulaName: "app",
        token: "TAP_DISPATCH_TOKEN",
      },
    ],
  };

  test("give each channel its stage, an absent channel absent, and the formula's name", () => {
    expect(outputsOf(plan)).toEqual({
      version: "1.0.1",
      "github-release": "served",
      "github-release-credentials": "[]",
      "github-release-build": "scripts/build",
      "github-release-files": "dist/a.tar.gz\ndist/b.tar.gz",
      npm: "absent",
      homebrew: "publish",
      "homebrew-credentials": '["TAP_DISPATCH_TOKEN"]',
      "homebrew-tap": "owner/homebrew-tap",
      "homebrew-formula-name": "app",
      "homebrew-token": "TAP_DISPATCH_TOKEN",
    });
  });

  test("give each npm package its name, then its directory", () => {
    const npm: Plan = {
      tag: "v1.0.1",
      version: "1.0.1",
      channels: [
        {
          kind: "npm",
          stage: "publish",
          credentials: [],
          packages: [
            { name: "@scope/app", dir: "." },
            { name: "@scope/lib", dir: "packages/my lib" },
          ],
          smoke: "app --version",
        },
      ],
    };
    expect(outputsOf(npm)).toMatchObject({
      npm: "publish",
      "npm-packages": "@scope/app .\n@scope/lib packages/my lib",
      "npm-smoke": "app --version",
    });
  });

  test("are written as GitHub's multi-line outputs", () => {
    expect(outputFile({ version: "1.0.1", files: "a\nb" }, "EOF_1")).toBe(
      "version<<EOF_1\n1.0.1\nEOF_1\nfiles<<EOF_1\na\nb\nEOF_1\n",
    );
  });
});
