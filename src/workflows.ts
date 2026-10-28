import { basename } from "node:path";
import { fileAt, filesUnder, type Git } from "./git";
import { isTable } from "./table";

const WORKFLOWS_DIR = ".github/workflows";

const WORKFLOW_FILE = /\.ya?ml$/;

const PUSH = "push";

const NEGATION = "!";

const SPECIAL = /[.^${}()|\\/]/g;

const ANY_SEGMENTS = "**";

const ANY_IN_SEGMENT = "*";

type Workflow = { readonly parsed: true; readonly value: unknown } | { readonly parsed: false };

function patternsOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function filterPattern(filter: string): RegExp {
  const body = filter
    .split(ANY_SEGMENTS)
    .map((part) =>
      part
        .split(ANY_IN_SEGMENT)
        .map((piece) => piece.replace(SPECIAL, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${body}$`);
}

function unnegated(filter: string): string {
  return filter.startsWith(NEGATION) ? filter.slice(NEGATION.length) : filter;
}

function matchesFilters(filters: readonly string[], tag: string): boolean {
  const last = filters.findLast((filter) => filterPattern(unnegated(filter)).test(tag));
  return last !== undefined && !last.startsWith(NEGATION);
}

function pushRunsOn(push: unknown, tag: string): boolean {
  if (!isTable(push)) return true;
  const tags = patternsOf(push.tags);
  if (tags !== null) return matchesFilters(tags, tag);
  const ignored = patternsOf(push["tags-ignore"]);
  if (ignored !== null) return !matchesFilters(ignored, tag);
  return push.branches === undefined && push["branches-ignore"] === undefined;
}

function runsOnTag(workflow: Workflow, tag: string): boolean {
  if (!workflow.parsed || !isTable(workflow.value)) return true;
  const on = workflow.value.on;
  if (on === PUSH) return true;
  if (Array.isArray(on)) return on.includes(PUSH);
  if (isTable(on) && PUSH in on) return pushRunsOn(on[PUSH], tag);
  return false;
}

function workflowOf(source: string): Workflow {
  try {
    return { parsed: true, value: Bun.YAML.parse(source) };
  } catch {
    return { parsed: false };
  }
}

export function workflowsOnTag(git: Git, commit: string, tag: string): readonly string[] {
  return filesUnder(git, commit, WORKFLOWS_DIR)
    .filter((path) => WORKFLOW_FILE.test(path))
    .filter((path) => runsOnTag(workflowOf(fileAt(git, commit, path)), tag))
    .map((path) => basename(path));
}
