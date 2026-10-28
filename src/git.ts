import { realpathSync } from "node:fs";
import { faults, refusals } from "./coded-error";
import { execute, type ProcessEnv, type Ran } from "./exec";

export type Git = { readonly root: string; readonly env: ProcessEnv };

export type Tag = { readonly name: string; readonly annotated: boolean; readonly commit: string };

export type CommitInfo = {
  readonly short: string;
  readonly subject: string;
  readonly message: string;
  readonly files: readonly string[];
};

const REMOTE = "origin";

const FIELD = "\u0000";

const refuse = refusals<{
  readonly not_a_checkout: { readonly path: string };
}>({
  not_a_checkout: {
    message: ({ path }) => `${path} is not inside a git checkout`,
    resolve: () => "run the command from inside the checkout of the project to release",
  },
});

const fault = faults<{
  readonly git_failed: { readonly args: readonly string[]; readonly status: number; readonly detail: string };
}>({
  git_failed: {
    message: ({ args, status, detail }) => `git ${args.join(" ")} exited ${status}: ${detail}`,
    resolve: () => "fix what git reports, then run the command again",
  },
});

function run(git: Git, args: readonly string[]): Ran {
  return execute("git", ["-C", git.root, ...args], { cwd: git.root, env: git.env });
}

function out(git: Git, args: readonly string[]): string {
  const ran = run(git, args);
  if (ran.status !== 0) throw fault("git_failed", { args, status: ran.status, detail: ran.stderr.trim() });
  return ran.stdout;
}

function lines(text: string): readonly string[] {
  return text.split("\n").filter((line) => line !== "");
}

function fields(text: string): readonly string[] {
  return text.split(FIELD);
}

export function checkoutRoot(cwd: string, env: ProcessEnv): string {
  const ran = execute("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { cwd, env });
  if (ran.status !== 0) throw refuse("not_a_checkout", { path: cwd });
  return realpathSync(ran.stdout.trim());
}

export function isDirty(git: Git): boolean {
  return out(git, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) !== "";
}

const DETACHED = 1;

export function currentBranch(git: Git): string | null {
  const args = ["symbolic-ref", "-q", "--short", "HEAD"];
  const ran = run(git, args);
  if (ran.status === DETACHED) return null;
  if (ran.status !== 0) throw fault("git_failed", { args, status: ran.status, detail: ran.stderr.trim() });
  return ran.stdout.trim();
}

export function head(git: Git): string {
  return out(git, ["rev-parse", "HEAD"]).trim();
}

export function remoteBranchCommit(git: Git, branch: string): string | null {
  return lines(out(git, ["ls-remote", REMOTE, `refs/heads/${branch}`]))[0]?.split("\t")[0] ?? null;
}

export function isAncestor(git: Git, ancestor: string, descendant: string): boolean {
  return run(git, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

export function tags(git: Git): readonly Tag[] {
  const format = ["%(refname:strip=2)", "%(objecttype)", "%(objectname)", "%(*objectname)"].join("%00");
  return lines(out(git, ["for-each-ref", `--format=${format}`, "refs/tags"])).flatMap((line) => {
    const [name, type, object, peeled] = fields(line);
    if (name === undefined || object === undefined) return [];
    const annotated = type === "tag";
    const commit = annotated ? peeled : object;
    return commit === undefined || commit === "" ? [] : [{ name, annotated, commit }];
  });
}

export function tagsReachedFrom(git: Git, commit: string): ReadonlySet<string> {
  return new Set(
    lines(out(git, ["for-each-ref", `--merged=${commit}`, "--format=%(refname:strip=2)", "refs/tags"])),
  );
}

export function verifiesTag(git: Git, tag: string): boolean {
  return run(git, ["verify-tag", tag]).status === 0;
}

export function commitsBetween(git: Git, from: string, to: string): readonly string[] {
  return lines(out(git, ["rev-list", "--reverse", `${from}..${to}`]));
}

export function commitInfo(git: Git, sha: string): CommitInfo {
  const [short = "", subject = "", message = ""] = fields(
    out(git, ["show", "-s", "--format=%h%x00%s%x00%B", sha]),
  );
  const files = out(git, ["diff-tree", "--root", "--no-commit-id", "-r", "-m", "--name-only", "-z", sha])
    .split(FIELD)
    .filter((file) => file !== "");
  return { short, subject, message: message.trimEnd(), files: [...new Set(files)] };
}

export function trackedFiles(git: Git): readonly string[] {
  return out(git, ["ls-files", "-z"])
    .split(FIELD)
    .filter((file) => file !== "");
}

export type GitStep = { readonly ok: true } | { readonly ok: false; readonly detail: string };

function step(git: Git, args: readonly string[]): GitStep {
  const ran = run(git, args);
  return ran.status === 0 ? { ok: true } : { ok: false, detail: (ran.stderr || ran.stdout).trim() };
}

export function commitFile(git: Git, file: string, subject: string): GitStep {
  const added = step(git, ["add", "--", file]);
  if (!added.ok) return added;
  return step(git, ["commit", "-q", "-m", subject, "--", file]);
}

export function createTag(git: Git, tag: string, signed: boolean): GitStep {
  return step(git, ["tag", signed ? "-s" : "-a", "-m", tag, tag]);
}

export function restoreFile(git: Git, file: string): void {
  out(git, ["restore", "--staged", "--worktree", "--", file]);
}

export function resetTo(git: Git, commit: string): void {
  out(git, ["reset", "-q", "--keep", commit]);
}

export function pushCommand(branch: string, tag: string): string {
  return `git push ${REMOTE} ${branch} && git push ${REMOTE} ${tag}`;
}
