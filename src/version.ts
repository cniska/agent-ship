import { unreachable } from "./assert";

export type Version = { readonly major: number; readonly minor: number; readonly patch: number };

export type Level = "patch" | "minor" | "major";

const LEVELS: readonly Level[] = ["patch", "minor", "major"];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text);
  if (match === null) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major === undefined || minor === undefined || patch === undefined) return null;
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

export function printVersion({ major, minor, patch }: Version): string {
  return `${major}.${minor}.${patch}`;
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function bumpVersion(version: Version, level: Level): Version {
  switch (level) {
    case "patch":
      return { ...version, patch: version.patch + 1 };
    case "minor":
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case "major":
      return { major: version.major + 1, minor: 0, patch: 0 };
    default:
      return unreachable(level);
  }
}

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function isPreStable(version: Version): boolean {
  return version.major === 0;
}

export type TagPattern = { readonly prefix: string };

export function tagOf(pattern: TagPattern, version: Version): string {
  return `${pattern.prefix}${printVersion(version)}`;
}

export function versionOfTag(pattern: TagPattern, tag: string): Version | null {
  return tag.startsWith(pattern.prefix) ? parseVersion(tag.slice(pattern.prefix.length)) : null;
}
