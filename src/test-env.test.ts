import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { userInfo } from "node:os";
import { git, removeScratchDirs, scratchDir } from "./repo.test-support";
import { isolateGit } from "./test-env";

afterAll(removeScratchDirs);

afterEach(() => {
  delete process.env.GIT_NAMESPACE;
  delete process.env.GIT_CEILING_DIRECTORIES;
});

describe("isolateGit", () => {
  test("keeps a stray GIT_ key from reaching a test's git", () => {
    const dir = scratchDir();
    process.env.GIT_NAMESPACE = "stray";
    process.env.GIT_CEILING_DIRECTORIES = dir;

    isolateGit(process.env);
    const seen = git(dir, ["-c", "alias.seen-env=!env", "seen-env"])
      .split("\n")
      .map((line) => line.split("=")[0]);

    expect(seen).toContain("GIT_CONFIG_GLOBAL");
    expect(seen).not.toContain("GIT_NAMESPACE");
    expect(seen).not.toContain("GIT_CEILING_DIRECTORIES");
  });
});

describe("the preloaded test environment", () => {
  test("moves home and the XDG directories off the account's home", () => {
    const account = userInfo().homedir;
    for (const dir of [
      process.env.HOME,
      process.env.XDG_DATA_HOME,
      process.env.XDG_CONFIG_HOME,
      process.env.XDG_STATE_HOME,
    ]) {
      expect(dir).toBeString();
      expect(dir?.startsWith(account)).toBe(false);
    }
  });
});
