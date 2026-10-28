import { unreachable } from "./assert";
import { refusals } from "./coded-error";
import { writeVersion } from "./config";
import { commitFile, createTag, type GitStep, head, pushCommand, resetTo, restoreFile } from "./git";
import { type Facts, gather, refuseFailedCheck, refuseMissingCredential, refuseUnready } from "./judge";
import type { Project } from "./project";
import { bumpVersion, compareVersions, type Level, printVersion, tagOf, type Version } from "./version";

export type Target =
  | { readonly kind: "bump" }
  | { readonly kind: "level"; readonly level: Level }
  | { readonly kind: "version"; readonly version: Version };

type Released = {
  readonly app: string | null;
  readonly version: string;
  readonly tag: string;
  readonly commit: string;
  readonly push: string;
};

type Rehearsed = {
  readonly app: string | null;
  readonly version: string;
  readonly tag: string;
  readonly subject: string | null;
  readonly push: string;
};

type Plan = {
  readonly facts: Facts;
  readonly version: Version;
  readonly tag: string;
  readonly commits: boolean;
  readonly push: string;
};

type Step = "commit" | "tag";

const refuse = refusals<{
  readonly release_failed: { readonly step: Step; readonly detail: string };
}>({
  release_failed: {
    message: ({ step, detail }) => `git could not make the release ${step}: ${detail}`,
    resolve: ({ step }) => `fix what git reports for the ${step}, then run agent-ship release again`,
  },
});

function versionFor(current: Version, facts: Facts, target: Target): Version {
  switch (target.kind) {
    case "version":
      return target.version;
    case "level":
      return bumpVersion(current, target.level);
    case "bump":
      if (facts.previous === null) return current;
      return bumpVersion(current, facts.bump.level === "none" ? "patch" : facts.bump.level);
    default:
      return unreachable(target);
  }
}

function leastFor(current: Version, facts: Facts, target: Target): Version | null {
  if (target.kind === "bump" || facts.previous === null || facts.bump.level === "none") return null;
  return bumpVersion(current, facts.bump.level);
}

function planOf(project: Project, target: Target): Plan {
  const { app, config } = project;
  const facts = gather(project);
  const version = versionFor(app.version, facts, target);
  refuseUnready(facts, project, { version, least: leastFor(app.version, facts, target) });
  refuseMissingCredential(project);
  const tag = tagOf(app.tag, version);
  const commits = compareVersions(version, app.version) !== 0;
  return { facts, version, tag, commits, push: pushCommand(config.branch, tag) };
}

function subjectOf(tag: string): string {
  return `chore: release ${tag}`;
}

function madeOrFailed(step: Step, made: GitStep): void {
  if (!made.ok) throw refuse("release_failed", { step, detail: made.detail });
}

function commitVersion(project: Project, version: Version, tag: string): void {
  const { git, root, app } = project;
  writeVersion(root, app.versionSource, version);
  try {
    refuseFailedCheck(project);
    madeOrFailed("commit", commitFile(git, app.versionSource, subjectOf(tag)));
  } catch (error) {
    restoreFile(git, app.versionSource);
    throw error;
  }
}

export function rehearse(project: Project, target: Target): Rehearsed {
  const { version, tag, commits, push } = planOf(project, target);
  return {
    app: project.app.name,
    version: printVersion(version),
    tag,
    subject: commits ? subjectOf(tag) : null,
    push,
  };
}

export function release(project: Project, target: Target): Released {
  const { git, config, app } = project;
  const { facts, version, tag, commits, push } = planOf(project, target);
  if (commits) commitVersion(project, version, tag);
  else refuseFailedCheck(project);
  const made = createTag(git, tag, config.signed);
  if (!made.ok && commits) resetTo(git, facts.head);
  madeOrFailed("tag", made);
  return { app: app.name, version: printVersion(version), tag, commit: head(git), push };
}
