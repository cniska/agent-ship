import { type ProcessEnv, spawnProgram } from "./exec";

export type GhAnswer =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly detail: string };

export type GhText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly detail: string };

export type Gh = { readonly root: string; readonly env: ProcessEnv };

const NO_DETAIL = "gh printed nothing";

function failure(stderr: string, stdout: string): string {
  return (stderr.trim() || stdout.trim()).split("\n")[0] || NO_DETAIL;
}

export function ghText(gh: Gh, args: readonly string[]): GhText {
  const ran = spawnProgram("gh", args, { cwd: gh.root, env: gh.env });
  if (!ran.started) return { ok: false, detail: `gh could not run: ${ran.detail}` };
  return ran.status === 0
    ? { ok: true, text: ran.stdout }
    : { ok: false, detail: failure(ran.stderr, ran.stdout) };
}

export function ghJson(gh: Gh, args: readonly string[]): GhAnswer {
  const answer = ghText(gh, args);
  if (!answer.ok) return answer;
  try {
    return { ok: true, json: JSON.parse(answer.text) };
  } catch {
    return { ok: false, detail: `gh ${args.join(" ")} printed what is not JSON` };
  }
}
