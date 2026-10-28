import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  APPS_TOML,
  bareRemote,
  codeOf,
  commit,
  emptyRepo,
  failure,
  ghAnswers,
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
  shown,
  shownList,
  TOKEN_ENV,
  type World,
  world,
  write,
} from "./harness";

afterEach(removeScratchDirs);

function checked(w: World, dir: string, args: readonly string[] = ["check"]) {
  return run(w, dir, args, TOKEN_ENV);
}

function short(w: World, dir: string): string {
  return git(w, dir, ["rev-parse", "--short", "HEAD"]);
}

test("AC-1 a missing ship.toml, a directory outside git, and each malformed ship.toml are refused naming the key", () => {
  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "chore: start", { "package.json": packageJson("1.0.0") });
  expect(codeOf(checked(w, dir))).toBe("config_missing");
  expect(codeOf(checked(w, w.root))).toBe("not_a_checkout");
  const invalid = (toml: string, version = "1.0.0") => {
    write(dir, "ship.toml", toml);
    write(dir, "package.json", packageJson(version));
    const error = refusal(checked(w, dir));
    expect(error.code).toBe("config_invalid");
    return shown(error.meta).key;
  };
  expect(invalid("version = [")).toBeNull();
  expect(invalid(SHIP_TOML.replace('version = "package.json"\n', ""))).toBe("version");
  expect(invalid(`colour = "blue"\n${SHIP_TOML}`)).toBe("colour");
  expect(invalid(`${SHIP_TOML}\n[channels.carrier-pigeon]\ncredentials = []\n`)).toBe(
    "channels.carrier-pigeon",
  );
  expect(invalid(SHIP_TOML, "1.2")).toBe("version");
});

test("AC-3 check prints the version, its tag, the previous tag, the commits since it and the bump they warrant, changing nothing", () => {
  const { w, dir, origin } = releasedRepo();
  const before = snapshot(w, dir, origin);
  expect(result(checked(w, dir))).toEqual({
    app: null,
    version: "1.0.1",
    tag: "v1.0.1",
    previous: "v1.0.0",
    commits: 1,
    bump: { level: "patch", commits: [{ commit: short(w, dir), subject: "fix: handle empty input" }] },
    warnings: [],
  });
  expect(snapshot(w, dir, origin)).toBe(before);
});

test("AC-4 a changed or untracked file, another branch, and a commit origin lacks are refused, the first in order", () => {
  const { w, dir } = releasedRepo();
  write(dir, "package.json", packageJson("1.0.1", "changed"));
  expect(codeOf(checked(w, dir))).toBe("dirty_tree");
  git(w, dir, ["checkout", "--", "package.json"]);
  write(dir, "untracked.txt", "x\n");
  expect(codeOf(checked(w, dir))).toBe("dirty_tree");
  git(w, dir, ["switch", "-q", "-c", "other"]);
  expect(codeOf(checked(w, dir))).toBe("dirty_tree");
  git(w, dir, ["clean", "-fq"]);
  expect(codeOf(checked(w, dir))).toBe("not_on_release_branch");
  git(w, dir, ["switch", "-q", "main"]);
  commit(w, dir, "fix: more", { "a.ts": "a\n" });
  expect(codeOf(checked(w, dir))).toBe("unpushed_commits");
  git(w, dir, ["switch", "-q", "--detach", "HEAD"]);
  expect(refusal(checked(w, dir)).meta).toMatchObject({ current: null });
});

test("AC-4 an origin git cannot read is a fault naming git's message, not a commit origin lacks", () => {
  const { w, dir } = releasedRepo();
  git(w, dir, ["remote", "set-url", "origin", join(w.root, "gone.git")]);
  const error = failure(checked(w, dir), 3);
  expect(error.code).toBe("git_failed");
  expect(error.message).toContain("gone.git");
});

test("AC-5 commits origin lacks pass only while each changes nothing but the notes paths", () => {
  const { w, dir } = releasedRepo();
  commit(w, dir, "chore: notes", { "ship.toml": `notes = ["CHANGELOG.md", "notes/**"]\n${SHIP_TOML}` });
  push(w, dir);
  commit(w, dir, "docs: notes", { "CHANGELOG.md": "x\n", "notes/en/release.txt": "x\n" });
  expect(result(checked(w, dir)).version).toBe("1.0.1");
  commit(w, dir, "docs: more", { "notes.txt": "x\n" });
  expect(codeOf(checked(w, dir))).toBe("unpushed_commits");
  git(w, dir, ["reset", "-q", "--hard", "origin/main"]);
  commit(w, dir, "chore: notes", { "ship.toml": `notes = ["notes/*"]\n${SHIP_TOML}` });
  push(w, dir);
  commit(w, dir, "docs: notes", { "notes/en/release.txt": "y\n" });
  expect(codeOf(checked(w, dir))).toBe("unpushed_commits");
});

test("AC-6 an old version, a tag HEAD does not descend from, and HEAD at the latest tag are refused; no tag at all passes", () => {
  const old = releasedRepo();
  commit(old.w, old.dir, "fix: back", { "package.json": packageJson("0.9.0") });
  push(old.w, old.dir);
  const notNewer = refusal(checked(old.w, old.dir));
  expect(notNewer.code).toBe("version_not_newer");
  expect(notNewer.resolve).toContain("release");

  const away = releasedRepo();
  git(away.w, away.dir, ["switch", "-q", "-c", "side", "v1.0.0"]);
  commit(away.w, away.dir, "fix: side");
  git(away.w, away.dir, ["tag", "-a", "-m", "v1.0.1", "v1.0.1"]);
  git(away.w, away.dir, ["switch", "-q", "main"]);
  expect(codeOf(checked(away.w, away.dir))).toBe("tag_not_at_head");

  const again = releasedRepo();
  git(again.w, again.dir, ["tag", "-f", "-a", "-m", "v1.0.0", "v1.0.0"]);
  expect(codeOf(checked(again.w, again.dir))).toBe("no_commits_since_tag");

  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "chore: start", { "package.json": packageJson("0.1.0"), "ship.toml": SHIP_TOML });
  bareRemote(w, dir);
  expect(result(checked(w, dir))).toMatchObject({
    version: "0.1.0",
    tag: "v0.1.0",
    previous: null,
    commits: null,
    bump: { level: "none", commits: [] },
  });
});

test("AC-7 the version's tag at HEAD must be annotated, and signed where ship.toml says; behind HEAD it marks a release", () => {
  const light = releasedRepo();
  git(light.w, light.dir, ["tag", "v1.0.1"]);
  expect(codeOf(checked(light.w, light.dir))).toBe("tag_unsigned");

  const annotated = releasedRepo();
  git(annotated.w, annotated.dir, ["tag", "-a", "-m", "v1.0.1", "v1.0.1"]);
  expect(result(checked(annotated.w, annotated.dir))).toMatchObject({ tag: "v1.0.1", previous: "v1.0.0" });

  const signed = releasedRepo();
  commit(signed.w, signed.dir, "chore: sign", {
    "ship.toml": SHIP_TOML.replace("signed = false", "signed = true"),
  });
  push(signed.w, signed.dir);
  git(signed.w, signed.dir, ["tag", "-a", "-m", "v1.0.1", "v1.0.1"]);
  expect(codeOf(checked(signed.w, signed.dir))).toBe("tag_unsigned");

  const behind = releasedRepo();
  git(behind.w, behind.dir, ["tag", "v1.0.1"]);
  commit(behind.w, behind.dir, "fix: after");
  push(behind.w, behind.dir);
  expect(result(checked(behind.w, behind.dir))).toMatchObject({
    version: "1.0.1",
    tag: "v1.0.1",
    previous: "v1.0.1",
    commits: 1,
  });

  const mismatch = releasedRepo();
  git(mismatch.w, mismatch.dir, ["tag", "-a", "-m", "v0.5.0", "v0.5.0"]);
  const error = refusal(checked(mismatch.w, mismatch.dir));
  expect(error.code).toBe("tag_mismatch");
  expect(error.meta).toMatchObject({ tagVersion: "0.5.0", version: "1.0.1" });
});

test("AC-8 a credential is read from the environment, then .env, then the Actions secrets; a failing check is refused", () => {
  const { w, dir } = releasedRepo();
  const missing = refusal(run(w, dir, ["check"]));
  expect(missing.code).toBe("missing_credential");
  expect(missing.meta).toEqual({
    credential: "TAP_DISPATCH_TOKEN",
    channels: ["homebrew"],
    secretsUnread: null,
  });
  ghAnswers(w, { secretsFail: "gh: not logged in" });
  const unread = refusal(run(w, dir, ["check"]));
  expect(unread.code).toBe("missing_credential");
  expect(unread.meta).toMatchObject({ secretsUnread: "gh: not logged in" });
  expect(unread.resolve).toContain("gh auth login");
  ghAnswers(w, {});
  write(dir, ".env", "TAP_DISPATCH_TOKEN=test-tap-token\n");
  expect(result(run(w, dir, ["check"])).version).toBe("1.0.1");
  write(dir, ".env", "\n");
  ghAnswers(w, { secrets: ["TAP_DISPATCH_TOKEN"] });
  expect(result(run(w, dir, ["check"])).version).toBe("1.0.1");
  commit(w, dir, "chore: check", { "ship.toml": SHIP_TOML.replace('check = "exit 0"', 'check = "exit 3"') });
  push(w, dir);
  const failed = refusal(checked(w, dir));
  expect(failed.code).toBe("check_failed");
  expect(failed.meta).toEqual({ command: "exit 3", status: 3 });
});

test("AC-9 each TODO or FIXME line outside tests, Markdown and notes is a warning that refuses nothing", () => {
  const { w, dir } = releasedRepo();
  const todo = "TODO\n";
  commit(w, dir, "chore: files", {
    "ship.toml": `notes = ["CHANGELOG.md"]\n${SHIP_TOML}`,
    "src/a.ts": "const a = 1;\nconst b = 2;\n// TODO tidy\n",
    "src/b.ts": "const a = 1;\n// FIXME: x\nconst TODOS = 3;\n",
    "src/a.test.ts": todo,
    "src/a.spec.ts": todo,
    "test/c.ts": todo,
    "tests/c.ts": todo,
    "__tests__/c.ts": todo,
    "README.md": todo,
    "CHANGELOG.md": todo,
  });
  push(w, dir);
  const expected = [
    { file: "src/a.ts", line: 3 },
    { file: "src/b.ts", line: 2 },
  ];
  expect(result(checked(w, dir)).warnings).toEqual(expected);
  write(dir, ".gitignore", ".env\nsrc/d.ts\n");
  commit(w, dir, "chore: ignore");
  push(w, dir);
  write(dir, "src/d.ts", todo);
  expect(result(checked(w, dir)).warnings).toEqual(expected);
});

type Versions = { readonly tagged?: string; readonly version?: string };

function bumpAfter(message: string, options: Versions = {}) {
  const { w, dir } = releasedRepo(options);
  commit(w, dir, message);
  push(w, dir);
  const bump = shown(result(checked(w, dir)).bump);
  return { level: bump.level, subjects: shownList(bump.commits).map(({ subject }) => subject) };
}

function floored(floor: string, file: string, options: Versions = {}) {
  const { w, dir } = releasedRepo(options);
  commit(w, dir, "chore: floor", {
    "ship.toml": `${SHIP_TOML}\n[[floors]]\npaths = ["src/schema/**"]\nlevel = "${floor}"\n`,
  });
  push(w, dir);
  commit(w, dir, "fix: x", { [file]: "x\n" });
  push(w, dir);
  return run(w, dir, ["check"], TOKEN_ENV);
}

test("AC-10 the bump is the highest level a Conventional Commit since the previous tag warrants", () => {
  expect(bumpAfter("feat: add x")).toEqual({ level: "minor", subjects: ["feat: add x"] });
  expect(bumpAfter("feat(cli): add x").level).toBe("minor");
  expect(bumpAfter("FEAT: add x").level).toBe("minor");
  expect(bumpAfter("fix!: drop x")).toEqual({ level: "major", subjects: ["fix!: drop x"] });
  expect(bumpAfter("fix: drop x\n\nBREAKING CHANGE: x is gone").level).toBe("major");
  expect(bumpAfter("fix: drop x\n\nBREAKING-CHANGE: x is gone").level).toBe("major");
  expect(bumpAfter("docs: x")).toEqual({ level: "patch", subjects: ["fix: handle empty input", "docs: x"] });
  expect(bumpAfter("feat!: drop x", { tagged: "0.4.0", version: "0.4.1" })).toEqual({
    level: "minor",
    subjects: ["feat!: drop x"],
  });
});

test("AC-11 a floor raises the level of each commit changing a path it names", () => {
  expect(result(floored("minor", "src/schema/v2.ts")).bump).toMatchObject({
    level: "minor",
    commits: [{ subject: "fix: x" }],
  });
  expect(result(floored("minor", "src/other.ts")).bump).toMatchObject({ level: "patch" });
  expect(result(floored("major", "src/schema/v2.ts")).bump).toMatchObject({ level: "major" });
  expect(
    result(floored("major", "src/schema/v2.ts", { tagged: "0.4.0", version: "0.4.1" })).bump,
  ).toMatchObject({
    level: "minor",
  });
  for (const level of ["patch", "huge"]) {
    const error = refusal(floored(level, "src/schema/v2.ts"));
    expect(error.code).toBe("config_invalid");
    expect(error.meta).toMatchObject({ key: "floors[0].level" });
  }
});

test("AC-30 a credential named in a newly pushed ship.toml is read afresh and refused", () => {
  const { w, dir } = releasedRepo();
  expect(result(checked(w, dir)).version).toBe("1.0.1");
  commit(w, dir, "chore: npm", {
    "ship.toml": `${SHIP_TOML}\n[channels.npm]\npackages = ["app"]\nsmoke = "app --version"\ncredentials = ["NPM_SMOKE_TOKEN"]\n`,
  });
  push(w, dir);
  const error = refusal(checked(w, dir));
  expect(error.code).toBe("missing_credential");
  expect(error.meta).toEqual({ credential: "NPM_SMOKE_TOKEN", channels: ["npm"], secretsUnread: null });
});

test("AC-32 an app's paths decide which commits count toward its bump and its commits since the tag", () => {
  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "chore: start", {
    "ship.toml": APPS_TOML('paths = ["web/src/**"]\n', ""),
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
  expect(codeOf(checked(w, dir, ["check", "web"]))).toBe("no_commits_since_tag");
  expect(result(checked(w, dir, ["check", "cli"]))).toMatchObject({
    app: "cli",
    tag: "cli-v1.0.1",
    commits: 1,
  });
  commit(w, dir, "feat: add x", { "cli/a.ts": "x\n" });
  commit(w, dir, "fix: y", { "web/src/a.ts": "y\n" });
  push(w, dir);
  expect(result(checked(w, dir, ["check", "web"]))).toMatchObject({
    commits: 1,
    bump: { level: "patch", commits: [{ subject: "fix: y" }] },
  });
  expect(result(checked(w, dir, ["check", "cli"]))).toMatchObject({
    commits: 3,
    bump: { level: "minor", commits: [{ subject: "feat: add x" }] },
  });
  const single = releasedRepo({
    shipToml: SHIP_TOML.replace("[channels.homebrew]", 'paths = ["src/**"]\n\n[channels.homebrew]'),
  });
  const error = refusal(checked(single.w, single.dir));
  expect(error.code).toBe("config_invalid");
  expect(error.meta).toMatchObject({ key: "paths" });
});
