import { appsIn } from "./config";
import { explainAbsence, neededCredentials, presences } from "./credentials";
import { type ProcessEnv, spawnProgram } from "./exec";
import { type Checkout, openCheckout } from "./project";

type ToolCheck =
  | { readonly name: string; readonly state: "ok"; readonly detail: string; readonly fix: null }
  | { readonly name: string; readonly state: "fail"; readonly detail: string; readonly fix: string };

type Found = { readonly state: "ok"; readonly source: string; readonly fix: null };

type Missing = { readonly state: "fail"; readonly source: null; readonly fix: string };

type CredentialCheck = (Found | Missing) & {
  readonly name: string;
  readonly channels: readonly string[];
  readonly detail: string;
};

type Report = {
  readonly tools: readonly ToolCheck[];
  readonly credentials: readonly CredentialCheck[] | null;
};

const VERSION_FLAG = "--version";

function toolCheck(name: string, cwd: string, env: ProcessEnv): ToolCheck {
  const ran = spawnProgram(name, [VERSION_FLAG], { cwd, env });
  if (!ran.started)
    return {
      name,
      state: "fail",
      detail: `${name} is not on PATH: ${ran.detail}`,
      fix: `install ${name} and put it on PATH`,
    };
  if (ran.status !== 0)
    return {
      name,
      state: "fail",
      detail: `${name} ${VERSION_FLAG} exited ${ran.status}`,
      fix: `reinstall ${name}`,
    };
  return { name, state: "ok", detail: (ran.stdout.split("\n")[0] ?? "").trim(), fix: null };
}

function credentialChecks(checkout: Checkout): readonly CredentialCheck[] {
  const present = presences(checkout.root, checkout.env);
  return neededCredentials(appsIn(checkout.config)).map((needed) => {
    const presence = present(needed);
    const { name, channels } = needed;
    if (presence.present)
      return {
        name,
        channels,
        state: "ok",
        source: presence.source,
        detail: `present from ${presence.source}`,
        fix: null,
      };
    const { detail, fix } = explainAbsence(name, presence.absence);
    return { name, channels, state: "fail", source: null, detail, fix };
  });
}

export function doctor(cwd: string, env: ProcessEnv): Report {
  const git = toolCheck("git", cwd, env);
  const tools = [git, toolCheck("gh", cwd, env)];
  return { tools, credentials: git.state === "ok" ? credentialChecks(openCheckout(cwd, env)) : null };
}

export function failed(report: Report): boolean {
  return [...report.tools, ...(report.credentials ?? [])].some(({ state }) => state === "fail");
}
