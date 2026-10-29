import { basename } from "node:path";
import { publishedRelease, type Release, readReleases, releaseDeletion } from "./channels";
import { faults } from "./coded-error";
import type { ProcessEnv } from "./exec";
import { type Gh, ghText } from "./gh";
import { requiredInput } from "./inputs";

type GhCall = readonly string[];

type PublishInputs = { readonly tag: string; readonly files: readonly string[] };

const fault = faults<{
  readonly releases_unreadable: { readonly detail: string };
  readonly release_call_failed: { readonly call: string; readonly detail: string };
}>({
  releases_unreadable: {
    message: ({ detail }) => `the repository's releases could not be read: ${detail}`,
    resolve: () => "fix what gh reports, then rerun the workflow's failed jobs",
  },
  release_call_failed: {
    message: ({ call, detail }) => `${call} failed: ${detail}`,
    resolve: () => "fix what gh reports, then rerun the workflow's failed jobs",
  },
});

export function publishInputs(env: ProcessEnv): PublishInputs {
  return {
    tag: requiredInput(env, "TAG"),
    files: requiredInput(env, "FILES")
      .split("\n")
      .filter((file) => file !== ""),
  };
}

export function releaseCalls(
  releases: readonly Release[],
  tag: string,
  files: readonly string[],
): readonly GhCall[] {
  const published = publishedRelease(releases, tag);
  if (published !== null) {
    const absent = files.filter((file) => !published.assets.includes(basename(file)));
    return absent.length === 0 ? [] : [["release", "upload", tag, ...absent]];
  }
  return [
    ...releases.filter((release) => release.tag === tag).map(({ id }) => releaseDeletion(id)),
    ["release", "create", tag, "--draft", "--verify-tag", "--title", tag, "--generate-notes", ...files],
  ];
}

export function publishFiles(gh: Gh, { tag, files }: PublishInputs): readonly GhCall[] {
  const read = readReleases(gh);
  if (!read.ok) throw fault("releases_unreadable", { detail: read.detail });
  const calls = releaseCalls(read.releases, tag, files);
  for (const call of calls) {
    const ran = ghText(gh, call);
    if (!ran.ok) throw fault("release_call_failed", { call: `gh ${call.join(" ")}`, detail: ran.detail });
  }
  return calls;
}
