import { type Bump, bumpOf, type Counted, countedCommits } from "./bump";
import { refusals } from "./coded-error";
import type { App } from "./config";
import { type Absence, explainAbsence, neededCredentials, presences } from "./credentials";
import { execute } from "./exec";
import {
  commitInfo,
  commitsBetween,
  currentBranch,
  type Git,
  head,
  isAncestor,
  isDirty,
  remoteBranchCommit,
  type Tag,
  tags,
  tagsReachedFrom,
  verifiesTag,
} from "./git";
import { pathMatcher } from "./glob";
import type { Project } from "./project";
import { compareVersions, printVersion, tagOf, type Version, versionOfTag } from "./version";

type ReleaseTag = Tag & { readonly version: Version; readonly reached: boolean };

export type Facts = {
  readonly head: string;
  readonly tags: readonly ReleaseTag[];
  readonly previous: ReleaseTag | null;
  readonly counted: readonly Counted[] | null;
  readonly bump: Bump;
  readonly dirty: boolean;
  readonly branch: string | null;
  readonly origin: string | null;
  readonly onlyNotesAhead: boolean;
  readonly verified: ReadonlySet<string>;
};

type Judged = Pick<Project, "root" | "config" | "app">;

type Judging = { readonly version: Version; readonly least: Version | null };

const SHELL = "/bin/sh";

const refuse = refusals<{
  readonly dirty_tree: { readonly root: string };
  readonly not_on_release_branch: { readonly branch: string; readonly current: string | null };
  readonly unpushed_commits: {
    readonly branch: string;
    readonly head: string;
    readonly origin: string | null;
  };
  readonly version_not_newer: { readonly version: string; readonly latest: string };
  readonly no_commits_since_tag: { readonly tag: string };
  readonly bump_below_commits: {
    readonly version: string;
    readonly bump: Bump["level"];
    readonly commits: Bump["commits"];
  };
  readonly tag_mismatch: { readonly tag: string; readonly tagVersion: string; readonly version: string };
  readonly tag_unsigned: { readonly tag: string; readonly lightweight: boolean };
  readonly tag_not_at_head: { readonly tag: string; readonly commit: string; readonly head: string };
  readonly missing_credential: {
    readonly credential: string;
    readonly channels: readonly string[];
    readonly absence: Absence;
  };
  readonly check_failed: { readonly command: string; readonly status: number };
}>({
  dirty_tree: {
    message: ({ root }) => `${root} has changes or untracked files git does not ignore`,
    resolve: () => "commit or stash each change, and commit or ignore each untracked file, then run again",
  },
  not_on_release_branch: {
    message: ({ branch, current }) =>
      current === null
        ? `HEAD is detached, not on the release branch ${branch}`
        : `HEAD is on ${current}, not on the release branch ${branch}`,
    resolve: ({ branch }) => `git switch ${branch}, then run again`,
  },
  unpushed_commits: {
    message: ({ branch, head: at, origin }) =>
      origin === null
        ? `origin has no ${branch} to release from`
        : `HEAD ${at} is not origin's ${branch} ${origin}`,
    resolve: ({ branch }) =>
      `push ${branch} to origin, or pull what origin has, so HEAD is origin's ${branch}, then run again`,
  },
  version_not_newer: {
    message: ({ version, latest }) => `version ${version} is not newer than the latest tag ${latest}`,
    resolve: () => "run agent-ship release, which raises the version above the latest tag",
  },
  no_commits_since_tag: {
    message: ({ tag }) => `no commit to release follows the tag ${tag}`,
    resolve: () => "commit the change to release, push it, then run again",
  },
  bump_below_commits: {
    message: ({ version, bump, commits }) =>
      `${version} is below the ${bump} bump that ${commits.map(({ commit }) => commit).join(", ")} warrant`,
    resolve: ({ bump }) =>
      `run agent-ship release ${bump}, or agent-ship release with no level to take the bump`,
  },
  tag_mismatch: {
    message: ({ tag, tagVersion, version }) =>
      `HEAD carries the tag ${tag} of version ${tagVersion}, not of the version ${version}`,
    resolve: ({ tag }) =>
      `delete the tag ${tag} with git tag -d ${tag} if it was made in error, then run again`,
  },
  tag_unsigned: {
    message: ({ tag, lightweight }) =>
      lightweight
        ? `the tag ${tag} at HEAD is lightweight`
        : `the tag ${tag} at HEAD carries no signature that verifies`,
    resolve: ({ tag }) =>
      `delete the tag with git tag -d ${tag}, then run agent-ship release, which makes it annotated and signed as ship.toml says`,
  },
  tag_not_at_head: {
    message: ({ tag, commit }) => `the tag ${tag} points at ${commit}, which HEAD does not descend from`,
    resolve: ({ tag }) => `release from the branch that holds ${tag}, or raise the version above it`,
  },
  missing_credential: {
    message: ({ credential, channels, absence }) =>
      `${credential}, which ${channels.join(", ")} reads, is missing: ${explainAbsence(credential, absence).detail}`,
    resolve: ({ credential, absence }) =>
      `${explainAbsence(credential, absence).fix}, then run again; agent-ship doctor shows each credential`,
  },
  check_failed: {
    message: ({ command, status }) => `the project's check ${command} exited ${status}`,
    resolve: ({ command }) => `run ${command}, fix what it reports, commit and push, then run again`,
  },
});

function releaseTags(git: Git, app: App, at: string): readonly ReleaseTag[] {
  const reached = tagsReachedFrom(git, at);
  return tags(git).flatMap((tag) => {
    const version = versionOfTag(app.tag, tag.name);
    return version === null ? [] : [{ ...tag, version, reached: reached.has(tag.name) }];
  });
}

function highest(candidates: readonly ReleaseTag[]): ReleaseTag | null {
  return candidates.reduce<ReleaseTag | null>(
    (best, tag) => (best === null || compareVersions(tag.version, best.version) > 0 ? tag : best),
    null,
  );
}

function onlyNotesBetween(project: Project, origin: string | null, at: string): boolean {
  const { git, app } = project;
  if (origin === null || origin === at || !isAncestor(git, origin, at)) return false;
  const notes = pathMatcher(app.notes);
  return commitsBetween(git, origin, at).every((sha) => commitInfo(git, sha).files.every(notes));
}

function verifiedAt(project: Project, all: readonly ReleaseTag[], at: string): ReadonlySet<string> {
  if (!project.config.signed) return new Set();
  const atHead = all.filter((tag) => tag.commit === at && tag.annotated);
  return new Set(atHead.filter((tag) => verifiesTag(project.git, tag.name)).map(({ name }) => name));
}

export function gather(project: Project): Facts {
  const { git, app, config } = project;
  const at = head(git);
  const all = releaseTags(git, app, at);
  const previous = highest(all.filter((tag) => tag.commit !== at));
  const counted =
    previous === null ? null : countedCommits(git, { from: previous.commit, to: at }, app, app.version);
  const origin = remoteBranchCommit(git, config.branch);
  return {
    head: at,
    tags: all,
    previous,
    counted,
    bump: bumpOf(counted),
    dirty: isDirty(git),
    branch: currentBranch(git),
    origin,
    onlyNotesAhead: onlyNotesBetween(project, origin, at),
    verified: verifiedAt(project, all, at),
  };
}

export function refuseUnready(
  facts: Facts,
  { root, config, app }: Judged,
  { version, least }: Judging,
): void {
  if (facts.dirty) throw refuse("dirty_tree", { root });
  if (facts.branch !== config.branch)
    throw refuse("not_on_release_branch", { branch: config.branch, current: facts.branch });
  if (facts.origin !== facts.head && !facts.onlyNotesAhead)
    throw refuse("unpushed_commits", { branch: config.branch, head: facts.head, origin: facts.origin });
  const own = tagOf(app.tag, version);
  const latest = highest(facts.tags.filter((tag) => tag.name !== own));
  if (latest !== null && compareVersions(version, latest.version) <= 0)
    throw refuse("version_not_newer", { version: printVersion(version), latest: latest.name });
  if (latest !== null && latest.commit === facts.head)
    throw refuse("no_commits_since_tag", { tag: latest.name });
  if (facts.previous !== null && facts.counted?.length === 0)
    throw refuse("no_commits_since_tag", { tag: facts.previous.name });
  if (least !== null && compareVersions(version, least) < 0)
    throw refuse("bump_below_commits", {
      version: printVersion(version),
      bump: facts.bump.level,
      commits: facts.bump.commits,
    });
  const mismatched = facts.tags.find((tag) => tag.commit === facts.head && tag.name !== own);
  if (mismatched !== undefined)
    throw refuse("tag_mismatch", {
      tag: mismatched.name,
      tagVersion: printVersion(mismatched.version),
      version: printVersion(version),
    });
  const ownTag = facts.tags.find((tag) => tag.name === own) ?? null;
  if (ownTag === null) return;
  if (ownTag.commit === facts.head && !ownTag.annotated)
    throw refuse("tag_unsigned", { tag: own, lightweight: true });
  if (ownTag.commit === facts.head && config.signed && !facts.verified.has(own))
    throw refuse("tag_unsigned", { tag: own, lightweight: false });
  if (!ownTag.reached) throw refuse("tag_not_at_head", { tag: own, commit: ownTag.commit, head: facts.head });
}

export function refuseMissingCredential({ root, env, app }: Project): void {
  const present = presences(root, env);
  const needed = neededCredentials([app]);
  for (const credential of needed) {
    const presence = present(credential);
    if (!presence.present)
      throw refuse("missing_credential", {
        credential: credential.name,
        channels: credential.channels,
        absence: presence.absence,
      });
  }
}

export function refuseFailedCheck(project: Project): void {
  const { root, env, app } = project;
  const ran = execute(SHELL, ["-c", app.check], { cwd: root, env });
  if (ran.status !== 0) throw refuse("check_failed", { command: app.check, status: ran.status });
}
