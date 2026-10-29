import { basename } from "node:path";
import { unreachable } from "./assert";
import { registryOf, type Serving, serving } from "./channels";
import { refusals } from "./coded-error";
import { type App, appsIn, CHANNEL_KINDS, type Channel } from "./config";
import { neededCredentials } from "./credentials";
import type { ProcessEnv } from "./exec";
import { invalidInput, requiredInput } from "./inputs";
import { npmRelease } from "./npm";
import { appOfTag, type Checkout, chooseApp, type TagChoice } from "./project";
import { parsedJson } from "./table";
import { compareVersions, printVersion, tagOf } from "./version";

type Stage = "publish" | "served" | "dry-run";

type Planned = { readonly stage: Stage; readonly credentials: readonly string[] };

type ChannelPlan =
  | (Planned & {
      readonly kind: "github-release";
      readonly build: string;
      readonly assemble: string | null;
      readonly files: readonly string[];
    })
  | (Planned & {
      readonly kind: "npm";
      readonly build: string | null;
      readonly smoke: string;
      readonly smokeNode: boolean;
    })
  | (Planned & {
      readonly kind: "homebrew";
      readonly tap: string;
      readonly formula: string;
      readonly formulaName: string;
      readonly token: string;
    });

export type Plan = {
  readonly tag: string;
  readonly version: string;
  readonly channels: readonly ChannelPlan[];
};

type Mode =
  | { readonly kind: "release"; readonly tag: string }
  | { readonly kind: "dry-run"; readonly app: string | null };

export type PlanInputs = {
  readonly mode: Mode;
  readonly secrets: ReadonlySet<string>;
  readonly registry: string;
  readonly output: string;
};

const ABSENT = "absent";

const FORMULA_SUFFIX = ".rb";

const DRY_RUN_EVENT = "workflow_dispatch";

const refuse = refusals<{
  readonly tag_mismatch: { readonly tag: string; readonly releaseTags: readonly string[] };
  readonly missing_credential: { readonly credential: string; readonly channels: readonly string[] };
  readonly dry_run_app_invalid: { readonly app: string | null; readonly problem: string };
}>({
  tag_mismatch: {
    message: ({ tag, releaseTags }) =>
      `${tag} is not the release tag of the version source, which is ${releaseTags.join(" or ")}`,
    resolve: () => "push the tag agent-ship release made, at the commit that holds its version",
  },
  missing_credential: {
    message: ({ credential, channels }) =>
      `${credential}, which ${channels.join(", ")} reads, is not among the secrets the workflow was given`,
    resolve: ({ credential }) =>
      `add ${credential} with gh secret set ${credential}, pass the caller's secrets with secrets: inherit, then rerun the workflow`,
  },
  dry_run_app_invalid: {
    message: ({ problem }) => `the app input does not fit ship.toml: ${problem}`,
    resolve: () =>
      "dispatch the workflow again with the app input naming one of ship.toml's apps, or empty when it names none",
  },
});

function secretNamesOf(text: string): ReadonlySet<string> {
  const parsed = parsedJson(text);
  if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === "string"))
    throw invalidInput("SECRET_NAMES", "is not a JSON list of names");
  return new Set(parsed);
}

function modeOf(env: ProcessEnv): Mode {
  if (requiredInput(env, "EVENT") !== DRY_RUN_EVENT)
    return { kind: "release", tag: requiredInput(env, "TAG") };
  const app = env.APP;
  return { kind: "dry-run", app: app === undefined || app === "" ? null : app };
}

export function planInputs(env: ProcessEnv): PlanInputs {
  return {
    mode: modeOf(env),
    secrets: secretNamesOf(requiredInput(env, "SECRET_NAMES")),
    registry: registryOf(env.npm_config_registry),
    output: requiredInput(env, "GITHUB_OUTPUT"),
  };
}

function refuseUnreleasable(checkout: Checkout, app: App): void {
  for (const channel of app.channels)
    if (channel.kind === "npm" && channel.source.kind === "tracked")
      npmRelease(checkout, channel, printVersion(app.version));
}

function admitApp(checkout: Checkout, app: App, secrets: ReadonlySet<string>): void {
  const missing = neededCredentials([app]).find(({ name }) => !secrets.has(name));
  if (missing !== undefined)
    throw refuse("missing_credential", { credential: missing.name, channels: missing.channels });
  refuseUnreleasable(checkout, app);
}

function admitTag(checkout: Checkout, tag: string, secrets: ReadonlySet<string>): TagChoice {
  const { config } = checkout;
  const choice = appOfTag(config, tag);
  if (choice === null || compareVersions(choice.version, choice.app.version) !== 0)
    throw refuse("tag_mismatch", {
      tag,
      releaseTags: appsIn(config).map((app) => tagOf(app.tag, app.version)),
    });
  admitApp(checkout, choice.app, secrets);
  return choice;
}

function stageOf(servings: readonly Serving[], kind: Channel["kind"]): Stage {
  return servings.find((found) => found.channel === kind)?.state === "served" ? "served" : "publish";
}

function channelPlan(channel: Channel, stage: Stage): ChannelPlan {
  const credentials = channel.credentials.map(({ name }) => name);
  switch (channel.kind) {
    case "github-release":
      return {
        kind: channel.kind,
        stage,
        credentials,
        build: channel.build,
        assemble: channel.assemble,
        files: channel.files,
      };
    case "npm":
      return {
        kind: channel.kind,
        stage,
        credentials,
        build: channel.source.kind === "built" ? channel.source.build : null,
        smoke: channel.smoke,
        smokeNode: channel.smokeNode,
      };
    case "homebrew":
      return {
        kind: channel.kind,
        stage,
        credentials,
        tap: channel.tap,
        formula: channel.formula,
        formulaName: basename(channel.formula, FORMULA_SUFFIX),
        token: channel.token,
      };
    default:
      return unreachable(channel);
  }
}

async function planTag(checkout: Checkout, inputs: PlanInputs, tag: string): Promise<Plan> {
  const { app, version } = admitTag(checkout, tag, inputs.secrets);
  const reach = {
    gh: { root: checkout.root, env: checkout.env },
    registry: inputs.registry,
    tag,
    version,
  };
  const servings = await serving(reach, app.channels);
  return {
    tag,
    version: printVersion(version),
    channels: app.channels.map((channel) => channelPlan(channel, stageOf(servings, channel.kind))),
  };
}

function planDryRun(checkout: Checkout, inputs: PlanInputs, name: string | null): Plan {
  const choice = chooseApp(checkout.config, name);
  if (!choice.found) throw refuse("dry_run_app_invalid", { app: name, problem: choice.problem });
  const { app } = choice;
  admitApp(checkout, app, inputs.secrets);
  return {
    tag: tagOf(app.tag, app.version),
    version: printVersion(app.version),
    channels: app.channels.map((channel) => channelPlan(channel, "dry-run")),
  };
}

export async function planRelease(checkout: Checkout, inputs: PlanInputs): Promise<Plan> {
  switch (inputs.mode.kind) {
    case "release":
      return planTag(checkout, inputs, inputs.mode.tag);
    case "dry-run":
      return planDryRun(checkout, inputs, inputs.mode.app);
    default:
      return unreachable(inputs.mode);
  }
}

function channelOutputs(plan: ChannelPlan): Readonly<Record<string, string>> {
  const key = plan.kind;
  const shared = { [key]: plan.stage, [`${key}-credentials`]: JSON.stringify(plan.credentials) };
  switch (plan.kind) {
    case "github-release":
      return {
        ...shared,
        [`${key}-build`]: plan.build,
        [`${key}-assemble`]: plan.assemble ?? "",
        [`${key}-files`]: plan.files.join("\n"),
      };
    case "npm":
      return {
        ...shared,
        [`${key}-build`]: plan.build ?? "",
        [`${key}-smoke`]: plan.smoke,
        [`${key}-smoke-node`]: String(plan.smokeNode),
      };
    case "homebrew":
      return {
        ...shared,
        [`${key}-tap`]: plan.tap,
        [`${key}-formula-name`]: plan.formulaName,
        [`${key}-token`]: plan.token,
      };
    default:
      return unreachable(plan);
  }
}

export function outputsOf(plan: Plan): Readonly<Record<string, string>> {
  const absent = Object.fromEntries(CHANNEL_KINDS.map((kind) => [kind, ABSENT]));
  return Object.assign(
    absent,
    { tag: plan.tag, version: plan.version },
    ...plan.channels.map(channelOutputs),
  );
}

export function outputFile(outputs: Readonly<Record<string, string>>, delimiter: string): string {
  return Object.entries(outputs)
    .map(([key, value]) => `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
    .join("");
}
