import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bump } from "./bump";
import { trackedFiles } from "./git";
import { pathMatcher } from "./glob";
import { gather, refuseFailedCheck, refuseMissingCredential, refuseUnready } from "./judge";
import type { Project } from "./project";
import { printVersion, tagOf } from "./version";

type Warning = { readonly file: string; readonly line: number };

export type Checked = {
  readonly app: string | null;
  readonly version: string;
  readonly tag: string;
  readonly previous: string | null;
  readonly commits: number | null;
  readonly bump: Bump;
  readonly warnings: readonly Warning[];
};

const MARKER = /(?:\/\/|\/\*|#|--|;|^\s*\*)\s*(?:TODO|FIXME)\b/;

const TEST_SEGMENTS = new Set(["test", "tests", "__tests__"]);

const TEST_NAME = /\.(?:test|spec|acceptance)\./;

const MARKDOWN = /\.md$/i;

const BINARY = "\u0000";

function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const name = segments.at(-1) ?? path;
  return segments.slice(0, -1).some((segment) => TEST_SEGMENTS.has(segment)) || TEST_NAME.test(name);
}

function warnings(project: Project): readonly Warning[] {
  const notes = pathMatcher(project.app.notes);
  return trackedFiles(project.git)
    .filter((file) => !isTestFile(file) && !MARKDOWN.test(file) && !notes(file))
    .flatMap((file) => {
      const path = join(project.root, file);
      if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return [];
      const text = readFileSync(path, "utf8");
      if (text.includes(BINARY)) return [];
      return text
        .split("\n")
        .flatMap((line, index) => (MARKER.test(line) ? [{ file, line: index + 1 }] : []));
    });
}

export function check(project: Project): Checked {
  const { app } = project;
  const facts = gather(project);
  refuseUnready(facts, project, { version: app.version, least: null });
  refuseMissingCredential(project);
  refuseFailedCheck(project);
  return {
    app: app.name,
    version: printVersion(app.version),
    tag: tagOf(app.tag, app.version),
    previous: facts.previous?.name ?? null,
    commits: facts.counted?.length ?? null,
    bump: facts.bump,
    warnings: warnings(project),
  };
}
