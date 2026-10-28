import type { Floor, FloorLevel } from "./config";
import { type CommitInfo, commitInfo, commitsBetween, type Git } from "./git";
import { pathMatcher } from "./glob";
import { isPreStable, type Level, levelRank, type Version } from "./version";

type Decider = { readonly commit: string; readonly subject: string };

export type Bump =
  | { readonly level: "none"; readonly commits: readonly [] }
  | { readonly level: Level; readonly commits: readonly Decider[] };

export type Counted = { readonly info: CommitInfo; readonly level: Level };

const HEADER = /^([A-Za-z]+)(?:\([^()]*\))?(!)?:/;

const FEATURE = "feat";

const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;

function breakingLevel(version: Version): Level {
  return isPreStable(version) ? "minor" : "major";
}

function floorLevel(level: FloorLevel, version: Version): Level {
  return level === "major" ? breakingLevel(version) : level;
}

function higher(a: Level, b: Level): Level {
  return levelRank(a) >= levelRank(b) ? a : b;
}

function commitLevel(subject: string, body: string, version: Version): Level {
  const header = HEADER.exec(subject);
  if (header?.[2] === "!" || BREAKING_FOOTER.test(body)) return breakingLevel(version);
  return header?.[1]?.toLowerCase() === FEATURE ? "minor" : "patch";
}

function bodyOf(info: CommitInfo): string {
  const newline = info.message.indexOf("\n");
  return newline === -1 ? "" : info.message.slice(newline + 1);
}

function leveled(info: CommitInfo, floors: readonly Floor[], version: Version): Level {
  const own = commitLevel(info.subject, bodyOf(info), version);
  return floors
    .filter((floor) => info.files.some(pathMatcher(floor.paths)))
    .reduce((level, floor) => higher(level, floorLevel(floor.level, version)), own);
}

export type Counting = { readonly paths: readonly string[] | null; readonly floors: readonly Floor[] };

export function countedCommits(
  git: Git,
  range: { readonly from: string; readonly to: string },
  counting: Counting,
  version: Version,
): readonly Counted[] {
  const inApp = counting.paths === null ? null : pathMatcher(counting.paths);
  return commitsBetween(git, range.from, range.to)
    .map((sha) => commitInfo(git, sha))
    .filter((info) => inApp === null || info.files.some(inApp))
    .map((info) => ({ info, level: leveled(info, counting.floors, version) }));
}

export function bumpOf(counted: readonly Counted[] | null): Bump {
  if (counted === null || counted.length === 0) return { level: "none", commits: [] };
  const level = counted.map((commit) => commit.level).reduce(higher);
  return {
    level,
    commits: counted
      .filter((commit) => commit.level === level)
      .map(({ info }) => ({ commit: info.short, subject: info.subject })),
  };
}
