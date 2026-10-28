import { type Bump, bumpOf, type Counted, countedCommits } from "./bump";
import { refusals } from "./coded-error";
import type { App } from "./config";
import { neededCredentials, presences } from "./credentials";
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
  readonly tag_mismatch: { readonly tag: string; readonly tagVersion: string; readonly version: string };
  readonly tag_unsigned: { readonly tag: string; readonly lightweight: boolean };
  readonly tag_not_at_head: { readonly tag: string; readonly commit: string; readonly head: string };
  readonly missing_credential: {
    readonly credential: string;
    readonly channels: readonly string[];
    readonly secretsUnread: string | null;
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
    message: ({ credential, channels, secretsUnread }) =>
      secretsUnread === null
        ? `${credential}, which ${channels.join(", ")} reads, is not set`
        : `${credential}, which ${channels.join(", ")} reads, is not set in the environment or .env, and the Actions secrets could not be read: ${secretsUnread}`,
    resolve: ({ credential, secretsUnread }) =>
      secretsUnread === null
        ? `set ${credential} in the environment, in .env at the checkout's root, or as an Actions secret with gh secret set ${credential}; agent-ship doctor shows each credential`
        : `make gh secret list work in this checkout, with gh auth login, or set ${credential} in the environment or .env, then run again`,
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

export function refuseUnready(facts: Facts, { root, config, app }: Judged): void {
  if (facts.dirty) throw refuse("dirty_tree", { root });
  if (facts.branch !== config.branch)
    throw refuse("not_on_release_branch", { branch: config.branch, current: facts.branch });
  if (facts.origin !== facts.head && !facts.onlyNotesAhead)
    throw refuse("unpushed_commits", { branch: config.branch, head: facts.head, origin: facts.origin });
  const own = tagOf(app.tag, app.version);
  const latest = highest(facts.tags.filter((tag) => tag.name !== own));
  if (latest !== null && compareVersions(app.version, latest.version) <= 0)
    throw refuse("version_not_newer", { version: printVersion(app.version), latest: latest.name });
  if (latest !== null && latest.commit === facts.head)
    throw refuse("no_commits_since_tag", { tag: latest.name });
  if (facts.previous !== null && facts.counted?.length === 0)
    throw refuse("no_commits_since_tag", { tag: facts.previous.name });
  const mismatched = facts.tags.find((tag) => tag.commit === facts.head && tag.name !== own);
  if (mismatched !== undefined)
    throw refuse("tag_mismatch", {
      tag: mismatched.name,
      tagVersion: printVersion(mismatched.version),
      version: printVersion(app.version),
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
  const needed = neededCredentials(app.channels);
  for (const credential of needed) {
    const presence = present(credential);
    if (!presence.present)
      throw refuse("missing_credential", {
        credential: credential.name,
        channels: credential.channels,
        secretsUnread: presence.unread,
      });
  }
}

export function refuseFailedCheck(project: Project): void {
  const { root, env, app } = project;
  const ran = execute(SHELL, ["-c", app.check], { cwd: root, env });
  if (ran.status !== 0) throw refuse("check_failed", { command: app.check, status: ran.status });
}
