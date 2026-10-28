import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Channel } from "./config";
import type { ProcessEnv } from "./exec";
import { type Gh, ghJson } from "./gh";

type Presence = { readonly present: true } | { readonly present: false; readonly unread: string | null };

type Secrets = { readonly names: ReadonlySet<string>; readonly unread: string | null };

export type Needed = {
  readonly name: string;
  readonly file: boolean;
  readonly channels: readonly string[];
};

const DOT_ENV = ".env";

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

const QUOTED = /^(["'])(.*)\1$/;

export function neededCredentials(channels: readonly Channel[]): readonly Needed[] {
  const needed = new Map<string, Needed>();
  for (const channel of channels)
    for (const { name, file } of channel.credentials) {
      const known = needed.get(name) ?? { name, file: false, channels: [] };
      needed.set(name, { name, file: known.file || file, channels: [...known.channels, channel.kind] });
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

function readableFile(root: string, value: string): string | null {
  const path = isAbsolute(value) ? value : join(root, value);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return null;
  try {
    accessSync(path, constants.R_OK);
    return path;
  } catch {
    return null;
  }
}

function isNamed(value: unknown): value is { readonly name: string } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}

function actionsSecrets(gh: Gh): Secrets {
  const answer = ghJson(gh, ["secret", "list", "--json", "name"]);
  if (!answer.ok) return { names: new Set(), unread: answer.detail };
  if (!Array.isArray(answer.json)) return { names: new Set(), unread: "gh secret list printed no list" };
  return { names: new Set(answer.json.filter(isNamed).map(({ name }) => name)), unread: null };
}

type Presences = (credential: { readonly name: string; readonly file: boolean }) => Presence;

function settingOf(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

export function presences(root: string, env: ProcessEnv): Presences {
  const fromFile = dotEnv(root);
  const gh = { root, env };
  let secrets: Secrets | null = null;
  return ({ name, file }) => {
    const setting = settingOf(env[name]) ?? settingOf(fromFile.get(name));
    if (file)
      return setting !== null && readableFile(root, setting) !== null
        ? { present: true }
        : { present: false, unread: null };
    if (setting !== null) return { present: true };
    secrets ??= actionsSecrets(gh);
    return secrets.names.has(name) ? { present: true } : { present: false, unread: secrets.unread };
  };
}
