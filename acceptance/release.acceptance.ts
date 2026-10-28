import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  APPS_TOML,
  bareRemote,
  codeOf,
  commit,
  emptyRepo,
  git,
  packageJson,
  push,
  refusal,
  releasedRepo,
  removeScratchDirs,
  result,
  run,
  SHIP_TOML,
  snapshot,
  TOKEN_ENV,
  usageCodeOf,
  type World,
  world,
  write,
} from "./harness";

afterEach(removeScratchDirs);

function shipped(w: World, dir: string, args: readonly string[]) {
  return run(w, dir, args, TOKEN_ENV);
}

function versionIn(dir: string, file = "package.json"): unknown {
  const manifest: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
  return typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "version") : null;
}

function headOf(w: World, dir: string): string {
  return git(w, dir, ["rev-parse", "HEAD"]);
}

function shortOf(w: World, dir: string): string {
  return git(w, dir, ["rev-parse", "--short", "HEAD"]);
}

function versionMade(w: World, dir: string, args: readonly string[]): unknown {
  return result(shipped(w, dir, args)).version;
}

function at142() {
  const repo = releasedRepo();
  commit(repo.w, repo.dir, "fix: set 1.4.2", { "package.json": packageJson("1.4.2") });
  push(repo.w, repo.dir);
  return repo;
}

function afterCommit(message: string) {
  const repo = releasedRepo();
  commit(repo.w, repo.dir, message);
  push(repo.w, repo.dir);
  return repo;
}

function oneBehind(message: string) {
  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "chore: start", {
    "package.json": packageJson("1.0.0"),
    "ship.toml": SHIP_TOML,
    ".gitignore": ".env\n",
  });
  git(w, dir, ["tag", "-a", "-m", "v1.0.0", "v1.0.0"]);
  commit(w, dir, message);
  bareRemote(w, dir);
  return { w, dir };
}

function untaggedRepo() {
  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "chore: start", {
    "package.json": packageJson("0.1.0"),
    "ship.toml": SHIP_TOML,
    ".gitignore": ".env\n",
  });
  commit(w, dir, "feat!: drop x");
  bareRemote(w, dir);
  return { w, dir };
}

function signingKey(w: World, dir: string): void {
  const home = w.env.HOME ?? "";
  const key = join(home, ".ssh", "id_ed25519");
  mkdirSync(join(home, ".ssh"));
  git(w, dir, ["config", "gpg.format", "ssh"]);
  const made = Bun.spawnSync([join(w.bin, "ssh-keygen"), "-q", "-t", "ed25519", "-N", "", "-f", key], {
    env: { ...w.env },
  });
  if (made.exitCode !== 0) throw new Error(`ssh-keygen failed: ${made.stderr.toString()}`);
  const allowed = join(home, "allowed_signers");
  write(home, "allowed_signers", `author@example.test ${readFileSync(`${key}.pub`, "utf8")}`);
  git(w, dir, ["config", "user.signingkey", key]);
  git(w, dir, ["config", "gpg.ssh.allowedSignersFile", allowed]);
}

test("AC-12 release patch writes the version, commits it alone, tags it and prints the push command, pushing nothing", () => {
  const { w, dir, origin } = releasedRepo();
  const originRefs = git(w, origin, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  const made = result(shipped(w, dir, ["release", "patch"]));
  const madeAt = headOf(w, dir);
  expect(made).toEqual({
    app: null,
    version: "1.0.2",
    tag: "v1.0.2",
    commit: madeAt,
    push: "git push origin main && git push origin v1.0.2",
  });
  expect(versionIn(dir)).toBe("1.0.2");
  expect(git(w, dir, ["log", "-1", "--format=%s"])).toBe("chore: release v1.0.2");
  expect(git(w, dir, ["show", "--name-only", "--format=", "HEAD"])).toBe("package.json");
  expect(git(w, dir, ["cat-file", "-t", "v1.0.2"])).toBe("tag");
  expect(git(w, dir, ["rev-parse", "v1.0.2^{commit}"])).toBe(madeAt);
  expect(git(w, origin, ["for-each-ref", "--format=%(refname) %(objectname)"])).toBe(originRefs);
});

test("AC-13 a level raises its part and zeroes the rest, a version is taken as given, and a signed tag verifies", () => {
  const minor = at142();
  expect(versionMade(minor.w, minor.dir, ["release", "minor"])).toBe("1.5.0");
  const major = at142();
  expect(versionMade(major.w, major.dir, ["release", "major"])).toBe("2.0.0");
  const given = at142();
  expect(versionMade(given.w, given.dir, ["release", "3.0.0"])).toBe("3.0.0");
  git(given.w, given.dir, ["push", "-q", "origin", "main", "v3.0.0"]);
  commit(given.w, given.dir, "fix: z");
  push(given.w, given.dir);
  expect(codeOf(shipped(given.w, given.dir, ["release", "2.9.9"]))).toBe("version_not_newer");

  const loose = at142();
  expect(usageCodeOf(shipped(loose.w, loose.dir, ["release", "next"]))).toBe("bad_arguments");
  expect(usageCodeOf(shipped(loose.w, loose.dir, ["release", "3.1"]))).toBe("bad_arguments");
  write(loose.dir, "untracked.txt", "x\n");
  expect(usageCodeOf(shipped(loose.w, loose.dir, ["release", "3.1"]))).toBe("bad_arguments");

  const signed = releasedRepo();
  signingKey(signed.w, signed.dir);
  commit(signed.w, signed.dir, "chore: sign", {
    "ship.toml": SHIP_TOML.replace("signed = false", "signed = true"),
  });
  push(signed.w, signed.dir);
  expect(result(shipped(signed.w, signed.dir, ["release"]))).toMatchObject({ tag: "v1.0.2" });
  expect(() => git(signed.w, signed.dir, ["tag", "-v", "v1.0.2"])).not.toThrow();
});

test("AC-14 with no level, release takes the bump the commits since the previous tag warrant", () => {
  const plain = releasedRepo();
  expect(versionMade(plain.w, plain.dir, ["release"])).toBe("1.0.2");
  const feature = afterCommit("feat: add x");
  expect(versionMade(feature.w, feature.dir, ["release"])).toBe("1.1.0");
  const breaking = afterCommit("fix!: drop x");
  expect(versionMade(breaking.w, breaking.dir, ["release"])).toBe("2.0.0");

  const fixed = oneBehind("fix: x");
  expect(versionMade(fixed.w, fixed.dir, ["release"])).toBe("1.0.1");
  const featured = oneBehind("feat: add x");
  expect(versionMade(featured.w, featured.dir, ["release"])).toBe("1.1.0");
  const below = oneBehind("feat: add x");
  expect(codeOf(shipped(below.w, below.dir, ["release", "patch"]))).toBe("bump_below_commits");
});

test("AC-15 a level or version below the bump is refused naming it and its commits, and changes nothing", () => {
  const repo = afterCommit("feat: add x");
  const before = snapshot(repo.w, repo.dir, repo.origin);
  const decider = { commit: shortOf(repo.w, repo.dir), subject: "feat: add x" };
  for (const args of [
    ["release", "patch"],
    ["release", "1.0.9"],
  ]) {
    const error = refusal(shipped(repo.w, repo.dir, args));
    expect(error.code).toBe("bump_below_commits");
    expect(error.meta).toMatchObject({ bump: "minor", commits: [decider] });
    expect(snapshot(repo.w, repo.dir, repo.origin)).toBe(before);
  }
  expect(versionIn(repo.dir)).toBe("1.0.1");
  for (const [level, made] of [
    ["minor", "1.1.0"],
    ["major", "2.0.0"],
    ["1.1.0", "1.1.0"],
    ["1.2.3", "1.2.3"],
  ] as const) {
    const fresh = afterCommit("feat: add x");
    expect(versionMade(fresh.w, fresh.dir, ["release", level])).toBe(made);
  }
  expect(codeOf(shipped(repo.w, repo.dir, ["release", "0.9.0"]))).toBe("version_not_newer");
  write(repo.dir, "untracked.txt", "x\n");
  expect(codeOf(shipped(repo.w, repo.dir, ["release", "patch"]))).toBe("dirty_tree");
});

test("AC-16 with no previous tag, release tags the recorded version at HEAD and makes no commit", () => {
  const { w, dir } = untaggedRepo();
  const before = headOf(w, dir);
  expect(result(shipped(w, dir, ["release"]))).toEqual({
    app: null,
    version: "0.1.0",
    tag: "v0.1.0",
    commit: before,
    push: "git push origin main && git push origin v0.1.0",
  });
  expect(headOf(w, dir)).toBe(before);
  expect(git(w, dir, ["cat-file", "-t", "v0.1.0"])).toBe("tag");
  expect(git(w, dir, ["rev-parse", "v0.1.0^{commit}"])).toBe(before);
  expect(versionIn(dir)).toBe("0.1.0");
  const fresh = untaggedRepo();
  expect(versionMade(fresh.w, fresh.dir, ["release", "patch"])).toBe("0.1.1");
  const same = untaggedRepo();
  const at = headOf(same.w, same.dir);
  expect(result(shipped(same.w, same.dir, ["release", "0.1.0"]))).toMatchObject({
    tag: "v0.1.0",
    commit: at,
  });
  expect(headOf(same.w, same.dir)).toBe(at);
});

test("AC-17 a refused or failed release leaves the version, the branch and the tags as they were, and a rerun converges", () => {
  const { w, dir, origin } = releasedRepo();
  write(dir, "untracked.txt", "x\n");
  const dirty = snapshot(w, dir, origin);
  expect(codeOf(shipped(w, dir, ["release", "patch"]))).toBe("dirty_tree");
  expect(snapshot(w, dir, origin)).toBe(dirty);
  rmSync(join(dir, "untracked.txt"));

  commit(w, dir, "chore: fail the check", { "ship.toml": SHIP_TOML.replace("exit 0", "exit 1") });
  push(w, dir);
  const failing = snapshot(w, dir, origin);
  const failed = refusal(shipped(w, dir, ["release", "patch"]));
  expect(failed.code).toBe("check_failed");
  expect(snapshot(w, dir, origin)).toBe(failing);

  commit(w, dir, "chore: pass the check", { "ship.toml": SHIP_TOML });
  push(w, dir);
  const hook = join(dir, ".git", "hooks", "pre-commit");
  write(dir, ".git/hooks/pre-commit", "#!/bin/sh\necho refused by the hook >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const hooked = snapshot(w, dir, origin);
  const refused = refusal(shipped(w, dir, ["release", "patch"]));
  expect(refused.code).toBe("release_failed");
  expect(refused.meta).toMatchObject({ step: "commit" });
  expect(snapshot(w, dir, origin)).toBe(hooked);
  expect(versionIn(dir)).toBe("1.0.1");

  rmSync(hook);
  expect(versionMade(w, dir, ["release", "patch"])).toBe("1.0.2");
});

test("AC-18 release --dry-run prints what release would make, skips the check command and changes nothing", () => {
  const { w, dir, origin } = releasedRepo();
  const before = snapshot(w, dir, origin);
  const rehearsed = {
    app: null,
    version: "1.0.2",
    tag: "v1.0.2",
    subject: "chore: release v1.0.2",
    push: "git push origin main && git push origin v1.0.2",
  };
  expect(result(shipped(w, dir, ["release", "--dry-run"]))).toEqual(rehearsed);
  expect(snapshot(w, dir, origin)).toBe(before);
  commit(w, dir, "chore: fail the check", { "ship.toml": SHIP_TOML.replace("exit 0", "exit 1") });
  push(w, dir);
  expect(result(shipped(w, dir, ["release", "--dry-run"]))).toEqual(rehearsed);
  commit(w, dir, "feat: add x");
  push(w, dir);
  expect(codeOf(shipped(w, dir, ["release", "patch", "--dry-run"]))).toBe("bump_below_commits");

  const untagged = untaggedRepo();
  expect(result(shipped(untagged.w, untagged.dir, ["release", "--dry-run"]))).toMatchObject({
    version: "0.1.0",
    tag: "v0.1.0",
    subject: null,
  });
});

function appsRepo() {
  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "chore: start", {
    "ship.toml": APPS_TOML(
      'notes = ["web/notes/**"]\n\n[[apps.web.floors]]\npaths = ["web/**"]\nlevel = "minor"\n',
      'notes = ["cli/notes/**"]\n',
    ),
    "web/package.json": packageJson("1.0.0", "web"),
    "cli/package.json": packageJson("1.0.0", "cli"),
    ".gitignore": ".env\n",
  });
  git(w, dir, ["tag", "-a", "-m", "web-v1.0.0", "web-v1.0.0"]);
  git(w, dir, ["tag", "-a", "-m", "cli-v1.0.0", "cli-v1.0.0"]);
  commit(w, dir, "fix: set versions", {
    "web/package.json": packageJson("1.0.1", "web"),
    "cli/package.json": packageJson("1.0.1", "cli"),
  });
  bareRemote(w, dir);
  return { w, dir };
}

function appsWithNotes() {
  const repo = appsRepo();
  commit(repo.w, repo.dir, "fix: x", { "web/a.ts": "x\n", "cli/a.ts": "x\n" });
  push(repo.w, repo.dir);
  commit(repo.w, repo.dir, "docs: web notes", { "web/notes/a.md": "notes\n" });
  return repo;
}

test("AC-19 with apps, each command acts on the app it names, with that app's tags, floors and notes", () => {
  const { w, dir } = appsRepo();
  expect(result(shipped(w, dir, ["check", "cli"]))).toMatchObject({ app: "cli", tag: "cli-v1.0.1" });
  expect(usageCodeOf(shipped(w, dir, ["check"]))).toBe("bad_arguments");
  expect(usageCodeOf(shipped(w, dir, ["check", "api"]))).toBe("bad_arguments");
  const single = releasedRepo();
  expect(usageCodeOf(shipped(single.w, single.dir, ["check", "cli"]))).toBe("bad_arguments");

  commit(w, dir, "fix: x", { "web/a.ts": "x\n", "cli/a.ts": "x\n" });
  push(w, dir);
  expect(result(shipped(w, dir, ["check", "cli"]))).toMatchObject({ bump: { level: "patch" } });
  expect(result(shipped(w, dir, ["check", "web"]))).toMatchObject({ bump: { level: "minor" } });
  commit(w, dir, "docs: web notes", { "web/notes/a.md": "notes\n" });
  expect(result(shipped(w, dir, ["check", "web"]))).toMatchObject({ app: "web" });
  expect(codeOf(shipped(w, dir, ["check", "cli"]))).toBe("unpushed_commits");

  const levelled = appsWithNotes();
  push(levelled.w, levelled.dir);
  expect(result(shipped(levelled.w, levelled.dir, ["release", "patch", "cli"]))).toMatchObject({
    app: "cli",
    version: "1.0.2",
    tag: "cli-v1.0.2",
  });
  expect(git(levelled.w, levelled.dir, ["show", "--name-only", "--format=", "HEAD"])).toBe(
    "cli/package.json",
  );
  expect(versionIn(levelled.dir, "web/package.json")).toBe("1.0.1");
  const bumped = appsWithNotes();
  push(bumped.w, bumped.dir);
  expect(result(shipped(bumped.w, bumped.dir, ["release", "cli"]))).toMatchObject({
    version: "1.0.2",
    tag: "cli-v1.0.2",
  });
});

test("AC-31 after a pushed release, check reads its tag as the previous one and release takes the next bump", () => {
  const { w, dir } = releasedRepo();
  expect(versionMade(w, dir, ["release", "patch"])).toBe("1.0.2");
  git(w, dir, ["push", "-q", "origin", "main", "v1.0.2"]);
  commit(w, dir, "feat: add x");
  push(w, dir);
  expect(result(shipped(w, dir, ["check"]))).toMatchObject({
    version: "1.0.2",
    tag: "v1.0.2",
    previous: "v1.0.2",
    commits: 1,
    bump: { level: "minor", commits: [{ commit: shortOf(w, dir), subject: "feat: add x" }] },
  });
  expect(versionMade(w, dir, ["release"])).toBe("1.1.0");
});
