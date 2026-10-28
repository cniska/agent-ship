import { type Serving, serving } from "./channels";
import { faults, refusals } from "./coded-error";
import { ghJson } from "./gh";
import { tagCommit } from "./git";
import type { Project } from "./project";
import { isTable } from "./table";
import { printVersion, type Version } from "./version";
import { workflowsOnTag } from "./workflows";

export type Clock = { readonly now: () => number; readonly sleep: (ms: number) => void };

type RunState =
  | { readonly workflow: string; readonly state: "passed" | "running" | "missing"; readonly conclusion: null }
  | { readonly workflow: string; readonly state: "failed"; readonly conclusion: string };

type Run = { readonly status: string; readonly conclusion: string };

type Report = {
  readonly app: string | null;
  readonly tag: string;
  readonly version: string;
  readonly runs: readonly RunState[];
  readonly channels: readonly Serving[];
};

export type Asked = {
  readonly tag: string;
  readonly version: Version;
  readonly registry: string;
  readonly clock: Clock;
};

const WAIT_MS = 60 * 60 * 1000;

const POLL_MS = 30 * 1000;

const COMPLETED = "completed";

const SUCCESS = "success";

const refuse = refusals<{
  readonly tag_missing: { readonly tag: string };
}>({
  tag_missing: {
    message: ({ tag }) => `the repository holds no tag ${tag}`,
    resolve: ({ tag }) =>
      `fetch the tags with git fetch --tags, or push ${tag} after agent-ship release made it`,
  },
});

const fault = faults<{
  readonly runs_unreadable: { readonly workflow: string; readonly detail: string };
}>({
  runs_unreadable: {
    message: ({ workflow, detail }) => `gh could not list the runs of ${workflow}: ${detail}`,
    resolve: () =>
      "make gh run list work in this checkout, with gh auth login, then run agent-ship status again",
  },
});

function isRun(value: unknown): value is Run {
  return isTable(value) && typeof value.status === "string" && typeof value.conclusion === "string";
}

function latestRun(project: Project, workflow: string, tag: string, commit: string): Run | null {
  const args = [
    "run",
    "list",
    "--workflow",
    workflow,
    "--branch",
    tag,
    "--commit",
    commit,
    "--event",
    "push",
  ];
  const answer = ghJson(project, [...args, "--limit", "1", "--json", "status,conclusion"]);
  if (!answer.ok) throw fault("runs_unreadable", { workflow, detail: answer.detail });
  if (!Array.isArray(answer.json)) throw fault("runs_unreadable", { workflow, detail: "gh printed no list" });
  const [run = null] = answer.json;
  if (run !== null && !isRun(run))
    throw fault("runs_unreadable", { workflow, detail: "gh printed a run with no state" });
  return run;
}

function stateOf(workflow: string, run: Run | null): RunState {
  if (run === null) return { workflow, state: "missing", conclusion: null };
  if (run.status !== COMPLETED) return { workflow, state: "running", conclusion: null };
  if (run.conclusion === SUCCESS) return { workflow, state: "passed", conclusion: null };
  return { workflow, state: "failed", conclusion: run.conclusion };
}

function finished({ state }: RunState): boolean {
  return state === "passed" || state === "failed";
}

function awaitRuns(project: Project, tag: string, commit: string, clock: Clock): readonly RunState[] {
  const workflows = workflowsOnTag(project.git, commit, tag);
  const poll = () =>
    workflows.map((workflow) => stateOf(workflow, latestRun(project, workflow, tag, commit)));
  const deadline = clock.now() + WAIT_MS;
  let runs = poll();
  while (!runs.every(finished) && clock.now() < deadline) {
    clock.sleep(POLL_MS);
    runs = poll();
  }
  return runs;
}

export async function status(project: Project, asked: Asked): Promise<Report> {
  const { tag, version, registry, clock } = asked;
  const commit = tagCommit(project.git, tag);
  if (commit === null) throw refuse("tag_missing", { tag });
  const runs = awaitRuns(project, tag, commit, clock);
  const channels = await serving({ gh: project, registry, tag, version }, project.app.channels);
  return { app: project.app.name, tag, version: printVersion(version), runs, channels };
}

export function failed(report: Report): boolean {
  return (
    report.runs.some(({ state }) => state !== "passed") ||
    report.channels.some(({ state }) => state !== "served")
  );
}
