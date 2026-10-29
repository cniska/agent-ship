import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeScratchDirs, scratchDir } from "../src/repo.test-support";

const SCRIPT = join(import.meta.dir, "release-secrets");

const SECRETS = {
  github_token: "ghs_madeup",
  TAP_DISPATCH_TOKEN: "made-up-token",
  SIGNING_KEY: "first line\nsecond line",
  EMPTY: "",
};

afterEach(removeScratchDirs);

function run(credentials: readonly string[]) {
  const dir = scratchDir();
  const output = join(dir, "output");
  const env = join(dir, "env");
  writeFileSync(output, "");
  writeFileSync(env, "");
  const ran = spawnSync(SCRIPT, [], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SECRETS: JSON.stringify(SECRETS),
      CREDENTIALS: JSON.stringify(credentials),
      GITHUB_OUTPUT: output,
      GITHUB_ENV: env,
    },
  });
  return { ...ran, output: readFileSync(output, "utf8"), env: readFileSync(env, "utf8") };
}

describe("release-secrets", () => {
  test("masks every line of every secret and records the names that hold a value", () => {
    const ran = run([]);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(
      [
        "::add-mask::ghs_madeup",
        "::add-mask::made-up-token",
        "::add-mask::first line",
        "::add-mask::second line",
        "",
      ].join("\n"),
    );
    expect(ran.output).toBe('names=["github_token","TAP_DISPATCH_TOKEN","SIGNING_KEY"]\n');
    expect(ran.env).toBe("");
  });

  test("exposes only the credentials it is given, each as a multi-line variable", () => {
    const ran = run(["SIGNING_KEY"]);
    expect(ran.status).toBe(0);
    const [opening = "", ...rest] = ran.env.split("\n");
    const delimiter = opening.replace("SIGNING_KEY<<", "");
    expect(delimiter).toMatch(/^SECRET_[0-9a-f]{32}$/);
    expect(rest).toEqual(["first line", "second line", delimiter, ""]);
  });

  test("refuses a credential the secrets do not hold, after masking", () => {
    for (const name of ["EMPTY", "ABSENT"]) {
      const ran = run([name]);
      expect(ran.status).toBe(1);
      expect(ran.stderr).toBe(`release-secrets: ${name} is not among the secrets the workflow was given\n`);
      expect(ran.stdout).toContain("::add-mask::made-up-token");
      expect(ran.env).toBe("");
    }
  });
});
