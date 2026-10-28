const SPECIAL = /[.+?^${}()|[\]\\]/g;

const ANY_SEGMENTS = "**";

const ANY_IN_SEGMENT = "*";

function segmentPattern(segment: string): string {
  return segment
    .split(ANY_IN_SEGMENT)
    .map((part) => part.replace(SPECIAL, "\\$&"))
    .join("[^/]*");
}

function globPattern(glob: string): RegExp {
  const segments = glob.split("/");
  const body = segments
    .map((segment, index) => {
      const last = index === segments.length - 1;
      if (segment === ANY_SEGMENTS) return last ? ".*" : "(?:[^/]+/)*";
      return last ? segmentPattern(segment) : `${segmentPattern(segment)}/`;
    })
    .join("");
  return new RegExp(`^${body}$`);
}

export type PathMatcher = (path: string) => boolean;

export function pathMatcher(globs: readonly string[]): PathMatcher {
  const patterns = globs.map(globPattern);
  return (path) => patterns.some((pattern) => pattern.test(path));
}
