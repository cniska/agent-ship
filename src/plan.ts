import { basename } from "node:path";
import { unreachable } from "./assert";
import { registryOf, type Serving, serving } from "./channels";
import { refusals } from "./coded-error";
import { type App, appsIn, CHANNEL_KINDS, type Channel } from "./config";
import { neededCredentials } from "./credentials";
import type { ProcessEnv } from "./exec";
import { invalidInput, requiredInput } from "./inputs";
import { npmRelease } from "./npm";
import { appOfTag, type Checkout, type TagChoice } from "./project";
import { parsedJson } from "./table";
import { compareVersions, printVersion, tagOf, type Version } from "./version";

type Stage = "publish" | "served";

type Planned = { readonly stage: Stage; readonly credentials: readonly string[] };

type ChannelPlan =
  | (Planned & {
      readonly kind: "github-release";
      readonly build: string;
      readonly assemble: string | null;
      readonly files: readonly string[];
    })
  | (Planned & { readonly kind: "npm"; readonly build: string | null; readonly smoke: string })
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

export type PlanInputs = {
  readonly tag: string;
  readonly secrets: ReadonlySet<string>;
  readonly registry: string;
  readonly output: string;
};

const ABSENT = "absent";

const FORMULA_SUFFIX = ".rb";

const refuse = refusals<{
  readonly tag_mismatch: { readonly tag: string; readonly releaseTags: readonly string[] };
  readonly missing_credential: { readonly credential: string; readonly channels: readonly string[] };
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
});

function secretNamesOf(text: string): ReadonlySet<string> {
  const parsed = parsedJson(text);
  if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === "string"))
    throw invalidInput("SECRET_NAMES", "is not a JSON list of names");
  return new Set(parsed);
}

export function planInputs(env: ProcessEnv): PlanInputs {
  return {
    tag: requiredInput(env, "TAG"),
    secrets: secretNamesOf(requiredInput(env, "SECRET_NAMES")),
    registry: registryOf(env.npm_config_registry),
    output: requiredInput(env, "GITHUB_OUTPUT"),
  };
}

function refuseUnreleasable(checkout: Checkout, app: App, version: Version): void {
  for (const channel of app.channels)
    if (channel.kind === "npm" && channel.source.kind === "tracked")
      npmRelease(checkout, channel, printVersion(version));
}

function admit(checkout: Checkout, tag: string, secrets: ReadonlySet<string>): TagChoice {
  const { config } = checkout;
  const choice = appOfTag(config, tag);
  if (choice === null || compareVersions(choice.version, choice.app.version) !== 0)
    throw refuse("tag_mismatch", {
      tag,
      releaseTags: appsIn(config).map((app) => tagOf(app.tag, app.version)),
    });
  const missing = neededCredentials([choice.app]).find(({ name }) => !secrets.has(name));
  if (missing !== undefined)
    throw refuse("missing_credential", { credential: missing.name, channels: missing.channels });
  refuseUnreleasable(checkout, choice.app, choice.version);
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

export async function planRelease(checkout: Checkout, inputs: PlanInputs): Promise<Plan> {
  const { app, version } = admit(checkout, inputs.tag, inputs.secrets);
  const reach = {
    gh: { root: checkout.root, env: checkout.env },
    registry: inputs.registry,
    tag: inputs.tag,
    version,
  };
  const servings = await serving(reach, app.channels);
  return {
    tag: inputs.tag,
    version: printVersion(version),
    channels: app.channels.map((channel) => channelPlan(channel, stageOf(servings, channel.kind))),
  };
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
  return Object.assign(absent, { version: plan.version }, ...plan.channels.map(channelOutputs));
}

export function outputFile(outputs: Readonly<Record<string, string>>, delimiter: string): string {
  return Object.entries(outputs)
    .map(([key, value]) => `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
    .join("");
}
