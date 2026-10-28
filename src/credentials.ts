import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { unreachable } from "./assert";
import type { App, Channel, Credential } from "./config";
import type { ProcessEnv } from "./exec";
import { type Gh, ghJson } from "./gh";
import { isTable } from "./table";

export type Absence =
  | { readonly reason: "unset" }
  | { readonly reason: "unset_file" }
  | { readonly reason: "unreadable_file"; readonly path: string }
  | { readonly reason: "secrets_unread"; readonly detail: string };

type Presence =
  | { readonly present: true; readonly source: string }
  | { readonly present: false; readonly absence: Absence };

type Explained = { readonly detail: string; readonly fix: string };

type Secrets = { readonly names: ReadonlySet<string>; readonly unread: string | null };

export type Needed = Credential & { readonly channels: readonly string[] };

const DOT_ENV = ".env";

const ENVIRONMENT = "environment";

const ACTIONS_SECRET = "actions-secret";

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

const QUOTED = /^(["'])(.*)\1$/;

function labelOf(app: App, channel: Channel): string {
  return app.name === null ? channel.kind : `${app.name}.${channel.kind}`;
}

export function neededCredentials(apps: readonly App[]): readonly Needed[] {
  const needed = new Map<string, Needed>();
  for (const app of apps)
    for (const channel of app.channels)
      for (const { name, file } of channel.credentials) {
        const known = needed.get(name) ?? { name, file: false, channels: [] };
        const channels = [...known.channels, labelOf(app, channel)];
        needed.set(name, { name, file: known.file || file, channels });
      }
  return [...needed.values()];
}

function dotEnv(root: string): ReadonlyMap<string, string> {
  const path = join(root, DOT_ENV);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return new Map();
  const values = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = ENV_LINE.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    values.set(match[1], QUOTED.exec(match[2])?.[2] ?? match[2]);
  }
  return values;
}

function isReadableFile(path: string): boolean {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return false;
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isNamed(value: unknown): value is { readonly name: string } {
  return isTable(value) && typeof value.name === "string";
}

function actionsSecrets(gh: Gh): Secrets {
  const answer = ghJson(gh, ["secret", "list", "--json", "name"]);
  if (!answer.ok) return { names: new Set(), unread: answer.detail };
  if (!Array.isArray(answer.json)) return { names: new Set(), unread: "gh secret list printed no list" };
  return { names: new Set(answer.json.filter(isNamed).map(({ name }) => name)), unread: null };
}

type Presences = (credential: Credential) => Presence;

type Setting = { readonly value: string; readonly source: string };

function settingOf(value: string | undefined, source: string): Setting | null {
  return value === undefined || value === "" ? null : { value, source };
}

function absent(absence: Absence): Presence {
  return { present: false, absence };
}

function fileFrom(root: string, setting: Setting | null): Presence {
  if (setting === null) return absent({ reason: "unset_file" });
  const path = isAbsolute(setting.value) ? setting.value : join(root, setting.value);
  return isReadableFile(path) ? { present: true, source: path } : absent({ reason: "unreadable_file", path });
}

export function presences(root: string, env: ProcessEnv): Presences {
  const fromFile = dotEnv(root);
  const gh = { root, env };
  let secrets: Secrets | null = null;
  return ({ name, file }) => {
    const setting = settingOf(env[name], ENVIRONMENT) ?? settingOf(fromFile.get(name), DOT_ENV);
    if (file) return fileFrom(root, setting);
    if (setting !== null) return { present: true, source: setting.source };
    secrets ??= actionsSecrets(gh);
    if (secrets.names.has(name)) return { present: true, source: ACTIONS_SECRET };
    return absent(
      secrets.unread === null ? { reason: "unset" } : { reason: "secrets_unread", detail: secrets.unread },
    );
  };
}

export function explainAbsence(name: string, absence: Absence): Explained {
  switch (absence.reason) {
    case "unset":
      return {
        detail: "not set in the environment, .env or the Actions secrets",
        fix: `set ${name} in the environment, in .env at the checkout's root, or as an Actions secret with gh secret set ${name}`,
      };
    case "unset_file":
      return {
        detail: "not set in the environment or .env",
        fix: `set ${name} to the path of a readable file, in the environment or in .env at the checkout's root`,
      };
    case "unreadable_file":
      return {
        detail: `set to ${absence.path}, which is not a readable file`,
        fix: `make ${absence.path} a readable file, or set ${name} to the path of one`,
      };
    case "secrets_unread":
      return {
        detail: `not set in the environment or .env, and the Actions secrets could not be read: ${absence.detail}`,
        fix: `make gh secret list work in this checkout, with gh auth login, or set ${name} in the environment or .env`,
      };
    default:
      return unreachable(absence);
  }
}
