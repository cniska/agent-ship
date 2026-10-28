import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Run = { readonly status: string; readonly conclusion: string };

type Release = { readonly tagName: string; readonly isDraft: boolean; readonly assets: readonly string[] };

export type State = {
  readonly secrets?: readonly string[];
  readonly secretsFail?: string;
  readonly runs?: Readonly<Record<string, readonly (readonly Run[])[]>>;
  readonly releases?: readonly Release[];
};

const CONTENTS = /^repos\/([^/]+\/[^/]+)\/contents\/(.+)$/;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`the gh stand-in needs ${name}`);
  return value;
}

const statePath = required("GH_STAND_IN_STATE");

const args = process.argv.slice(2);

appendFileSync(required("GH_STAND_IN_LOG"), `${JSON.stringify(args)}\n`);

function isState(value: unknown): value is State {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function state(): State {
  const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
  if (!isState(parsed)) throw new Error(`${statePath} is not a gh stand-in state`);
  return parsed;
}

function flag(name: string): string | null {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
}

function answer(value: unknown): never {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  return process.exit(0);
}

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  return process.exit(1);
}

function nextCall(workflow: string): number {
  const counter = `${statePath}.${workflow}.calls`;
  const calls = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
  writeFileSync(counter, String(calls + 1));
  return calls;
}

function runs(): never {
  const workflow = flag("--workflow");
  if (workflow === null) return refuse("the gh stand-in answers run list only with --workflow");
  const answers = state().runs?.[workflow] ?? [];
  const call = nextCall(workflow);
  const runsNow = answers[Math.min(call, answers.length - 1)] ?? [];
  return answer(runsNow.map((run, index) => ({ databaseId: index + 1, ...run })));
}

const RELEASES = "repos/{owner}/{repo}/releases";

function releases(): never {
  const page = (state().releases ?? []).map(({ tagName, isDraft, assets }) => ({
    tag_name: tagName,
    draft: isDraft,
    assets: assets.map((name) => ({ name })),
  }));
  return answer([page]);
}

function contents(path: string | undefined): never {
  const match = CONTENTS.exec(path ?? "");
  if (match?.[1] === undefined || match[2] === undefined)
    return refuse(`the gh stand-in does not answer ${path}`);
  const file = join(required("GH_STAND_IN_TAP"), match[1], match[2]);
  if (!existsSync(file)) return refuse("gh: Not Found (HTTP 404)");
  process.stdout.write(readFileSync(file, "utf8"));
  return process.exit(0);
}

const [group, verb] = args;

function secrets(): never {
  const { secrets: names = [], secretsFail } = state();
  if (secretsFail !== undefined) return refuse(secretsFail);
  return answer(names.map((name) => ({ name })));
}

if (group === "--version") {
  process.stdout.write("gh version 0.0.0 (stand-in)\n");
  process.exit(0);
}
if (group === "secret" && verb === "list") secrets();
if (group === "run" && verb === "list") runs();
if (group === "api" && args.includes(RELEASES)) releases();
if (group === "api") contents(args.find((arg) => CONTENTS.test(arg)));

refuse(`the gh stand-in does not answer: gh ${args.join(" ")}`);
