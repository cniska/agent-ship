import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unreachable } from "./assert";
import { refusals } from "./coded-error";
import { parseVersion, printVersion, type TagPattern, type Version } from "./version";

const CONFIG_FILE = "ship.toml";

type ChannelKind = "github-release" | "npm" | "homebrew";

const CHANNEL_KINDS: readonly ChannelKind[] = ["github-release", "npm", "homebrew"];

export type Credential = { readonly name: string; readonly file: boolean };

type ChannelBase = { readonly credentials: readonly Credential[] };

export type Channel =
  | (ChannelBase & {
      readonly kind: "github-release";
      readonly build: string;
      readonly files: readonly string[];
    })
  | (ChannelBase & { readonly kind: "npm"; readonly packages: readonly string[]; readonly smoke: string })
  | (ChannelBase & {
      readonly kind: "homebrew";
      readonly tap: string;
      readonly formula: string;
    });

export type FloorLevel = "minor" | "major";

export type Floor = { readonly paths: readonly string[]; readonly level: FloorLevel };

export type App = {
  readonly name: string | null;
  readonly versionSource: string;
  readonly version: Version;
  readonly tag: TagPattern;
  readonly check: string;
  readonly channels: readonly Channel[];
  readonly notes: readonly string[];
  readonly floors: readonly Floor[];
  readonly paths: readonly string[] | null;
};

type SingleApp = App & { readonly name: null; readonly paths: null };

export type NamedApp = App & { readonly name: string };

type Shared = { readonly branch: string; readonly signed: boolean };

export type Config =
  | (Shared & { readonly kind: "single"; readonly app: SingleApp })
  | (Shared & { readonly kind: "apps"; readonly apps: readonly [NamedApp, ...NamedApp[]] });

const refuse = refusals<{
  readonly config_missing: { readonly root: string };
  readonly config_invalid: { readonly key: string | null; readonly problem: string };
  readonly secret_in_config: { readonly key: string; readonly form: string };
}>({
  config_missing: {
    message: ({ root }) => `${root} has no ${CONFIG_FILE}`,
    resolve: () => `write ${CONFIG_FILE} at the checkout's root, as docs/commands.md shows`,
  },
  config_invalid: {
    message: ({ key, problem }) =>
      key === null ? `${CONFIG_FILE} ${problem}` : `${CONFIG_FILE}: ${key} ${problem}`,
    resolve: () => `fix ${CONFIG_FILE}, as docs/commands.md shows, then run the command again`,
  },
  secret_in_config: {
    message: ({ key, form }) => `${CONFIG_FILE}: ${key} holds a value in the form of ${form}`,
    resolve: ({ key }) =>
      `remove the secret from ${key}, name the variable that holds it in the channel's credentials instead, and rotate the secret`,
  },
});

type Table = Readonly<Record<string, unknown>>;

const SINGLE_KEYS = ["version", "tag", "branch", "check", "signed", "notes", "floors", "channels"];

const MANY_KEYS = ["branch", "signed", "apps"];

const APP_KEYS = ["version", "tag", "check", "notes", "floors", "channels", "paths"];

const FLOOR_KEYS = ["paths", "level"];

const CREDENTIALS = "credentials";

const FILE_CREDENTIALS = "file-credentials";

const CHANNEL_KEYS: Readonly<Record<ChannelKind, readonly string[]>> = {
  "github-release": ["build", "files", CREDENTIALS, FILE_CREDENTIALS],
  npm: ["packages", "smoke", CREDENTIALS, FILE_CREDENTIALS],
  homebrew: ["tap", "formula", CREDENTIALS],
};

const VERSION_SOURCE = "package.json";

const SINGLE_TAG = "v<version>";

const APP_TAG = "<app>-v<version>";

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const APP_NAME = /^[a-z0-9][a-z0-9-]*$/;

const SECRET_FORMS: readonly { readonly form: string; readonly pattern: RegExp }[] = [
  { form: "a GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { form: "an npm token", pattern: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  { form: "a private key", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
];

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function invalid(key: string | null, problem: string): never {
  throw refuse("config_invalid", { key, problem });
}

function keyOf(scope: string, key: string): string {
  return scope === "" ? key : `${scope}.${key}`;
}

function onlyKnown(raw: Table, known: readonly string[], scope: string): void {
  const unknown = Object.keys(raw).find((key) => !known.includes(key));
  if (unknown !== undefined) invalid(keyOf(scope, unknown), "is not a key agent-ship knows");
}

function required(raw: Table, key: string, scope: string): unknown {
  const value = raw[key];
  if (value === undefined) invalid(keyOf(scope, key), "is missing");
  return value;
}

function text(raw: Table, key: string, scope: string): string {
  const value = required(raw, key, scope);
  if (typeof value !== "string" || value.trim() === "")
    invalid(keyOf(scope, key), "must be a non-empty string");
  return value;
}

function texts(value: unknown, key: string, nonEmpty: boolean): readonly string[] {
  const valid =
    Array.isArray(value) &&
    (!nonEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.trim() !== "");
  if (!valid)
    invalid(
      key,
      nonEmpty ? "must be a non-empty list of non-empty strings" : "must be a list of non-empty strings",
    );
  return value.filter((item) => typeof item === "string");
}

function optionalTexts(raw: Table, key: string, scope: string): readonly string[] | null {
  const value = raw[key];
  return value === undefined ? null : texts(value, keyOf(scope, key), false);
}

function requiredTexts(raw: Table, key: string, scope: string): readonly string[] {
  return texts(required(raw, key, scope), keyOf(scope, key), true);
}

function flag(raw: Table, key: string, scope: string): boolean {
  const value = required(raw, key, scope);
  if (typeof value !== "boolean") invalid(keyOf(scope, key), "must be true or false");
  return value;
}

function tableAt(value: unknown, key: string): Table {
  if (!isTable(value)) invalid(key, "must be a table");
  return value;
}

function isFloorLevel(value: unknown): value is FloorLevel {
  return value === "minor" || value === "major";
}

function floorsOf(value: unknown, key: string): readonly Floor[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(key, "must be a list of tables, each [[floors]]");
  return value.map((item, index) => {
    const scope = `${key}[${index}]`;
    const floor = tableAt(item, scope);
    onlyKnown(floor, FLOOR_KEYS, scope);
    const paths = requiredTexts(floor, "paths", scope);
    const level = required(floor, "level", scope);
    if (!isFloorLevel(level)) invalid(keyOf(scope, "level"), "must be minor or major");
    return { paths, level };
  });
}

function credentialNames(value: unknown, key: string): readonly string[] {
  if (value === undefined) return [];
  const names = texts(value, key, false);
  const bad = names.find((name) => !VARIABLE_NAME.test(name));
  if (bad !== undefined) invalid(key, "must name variables, each of letters, digits and underscores");
  return names;
}

function isChannelKind(kind: string): kind is ChannelKind {
  return CHANNEL_KINDS.some((known) => known === kind);
}

function channelOf(kind: ChannelKind, raw: unknown, scope: string): Channel {
  const settings = tableAt(raw, scope);
  onlyKnown(settings, CHANNEL_KEYS[kind], scope);
  const named = credentialNames(settings[CREDENTIALS], keyOf(scope, CREDENTIALS));
  const files = credentialNames(settings[FILE_CREDENTIALS], keyOf(scope, FILE_CREDENTIALS));
  const credentials = [
    ...named.map((name) => ({ name, file: false })),
    ...files.map((name) => ({ name, file: true })),
  ];
  switch (kind) {
    case "github-release":
      return {
        kind,
        credentials,
        build: text(settings, "build", scope),
        files: requiredTexts(settings, "files", scope),
      };
    case "npm":
      return {
        kind,
        credentials,
        packages: requiredTexts(settings, "packages", scope),
        smoke: text(settings, "smoke", scope),
      };
    case "homebrew": {
      if (named.length !== 1)
        invalid(
          keyOf(scope, CREDENTIALS),
          "must name exactly one variable, the token that dispatches the tap",
        );
      return {
        kind,
        credentials,
        tap: text(settings, "tap", scope),
        formula: text(settings, "formula", scope),
      };
    }
    default:
      return unreachable(kind);
  }
}

function channelsOf(value: unknown, key: string): readonly Channel[] {
  return Object.entries(tableAt(value, key)).map(([kind, settings]) => {
    const scope = `${key}.${kind}`;
    if (!isChannelKind(kind)) invalid(scope, "is not a channel kind agent-ship knows");
    return channelOf(kind, settings, scope);
  });
}

function readVersion(root: string, source: string, key: string): Version {
  if (basename(source) !== VERSION_SOURCE) invalid(key, `must name a ${VERSION_SOURCE}`);
  const path = join(root, source);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile())
    invalid(key, `names ${source}, which is not a file`);
  const manifest = parsedJson(readFileSync(path, "utf8"));
  const recorded = isTable(manifest) ? manifest.version : undefined;
  const version = typeof recorded === "string" ? parseVersion(recorded) : null;
  if (version === null) invalid(key, `names ${source}, whose version is not in the form x.y.z`);
  return version;
}

const INDENT = /^\{\r?\n([ \t]*)/;

export function writeVersion(root: string, source: string, version: Version): void {
  const path = join(root, source);
  const recorded = readFileSync(path, "utf8");
  const manifest = parsedJson(recorded);
  if (!isTable(manifest)) invalid(null, `names ${source}, which is no longer a JSON object`);
  const written = JSON.stringify(
    { ...manifest, version: printVersion(version) },
    null,
    INDENT.exec(recorded)?.[1] ?? "",
  );
  writeFileSync(path, recorded.endsWith("\n") ? `${written}\n` : written);
}

function parsedJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function tagPatternOf(value: string, app: string | null, key: string): TagPattern {
  const expected = app === null ? SINGLE_TAG : APP_TAG;
  if (value !== expected) invalid(key, `must be ${expected}`);
  return { prefix: app === null ? "v" : `${app}-v` };
}

type Settings = Omit<App, "name" | "paths">;

function settingsOf(root: string, raw: Table, name: string | null, scope: string): Settings {
  const versionSource = text(raw, "version", scope);
  return {
    versionSource,
    version: readVersion(root, versionSource, keyOf(scope, "version")),
    tag: tagPatternOf(text(raw, "tag", scope), name, keyOf(scope, "tag")),
    check: text(raw, "check", scope),
    channels: channelsOf(required(raw, "channels", scope), keyOf(scope, "channels")),
    notes: optionalTexts(raw, "notes", scope) ?? [],
    floors: floorsOf(raw.floors, keyOf(scope, "floors")),
  };
}

function namedAppOf(root: string, name: string, raw: unknown): NamedApp {
  const scope = `apps.${name}`;
  if (!APP_NAME.test(name)) invalid(scope, "must be named in lowercase letters, digits and hyphens");
  const app = tableAt(raw, scope);
  onlyKnown(app, APP_KEYS, scope);
  return { name, paths: optionalTexts(app, "paths", scope), ...settingsOf(root, app, name, scope) };
}

function appsOf(root: string, raw: unknown): readonly [NamedApp, ...NamedApp[]] {
  const [first, ...rest] = Object.entries(tableAt(raw, "apps"));
  if (first === undefined) return invalid("apps", "must name at least one app");
  return [namedAppOf(root, ...first), ...rest.map((entry) => namedAppOf(root, ...entry))];
}

function* stringsIn(value: unknown, key: string): Iterable<{ readonly key: string; readonly value: string }> {
  if (typeof value === "string") yield { key, value };
  else if (Array.isArray(value))
    for (const [index, item] of value.entries()) yield* stringsIn(item, `${key}[${index}]`);
  else if (isTable(value))
    for (const [name, item] of Object.entries(value)) yield* stringsIn(item, keyOf(key, name));
}

function refuseSecrets(raw: Table): void {
  for (const { key, value } of stringsIn(raw, "")) {
    const secret = SECRET_FORMS.find(({ pattern }) => pattern.test(value));
    if (secret !== undefined) throw refuse("secret_in_config", { key, form: secret.form });
  }
}

function parsedToml(source: string): unknown {
  try {
    return Bun.TOML.parse(source);
  } catch {
    return invalid(null, "is not TOML");
  }
}

function configOf(root: string, raw: Table): Config {
  if (raw.apps === undefined) {
    onlyKnown(raw, SINGLE_KEYS, "");
    const shared = { branch: text(raw, "branch", ""), signed: flag(raw, "signed", "") };
    return {
      ...shared,
      kind: "single",
      app: { name: null, paths: null, ...settingsOf(root, raw, null, "") },
    };
  }
  onlyKnown(raw, MANY_KEYS, "");
  const shared = { branch: text(raw, "branch", ""), signed: flag(raw, "signed", "") };
  return { ...shared, kind: "apps", apps: appsOf(root, raw.apps) };
}

export function loadConfig(root: string): Config {
  const path = join(root, CONFIG_FILE);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw refuse("config_missing", { root });
  const raw = tableAt(parsedToml(readFileSync(path, "utf8")), CONFIG_FILE);
  refuseSecrets(raw);
  return configOf(root, raw);
}

export function appsIn(config: Config): readonly App[] {
  switch (config.kind) {
    case "single":
      return [config.app];
    case "apps":
      return config.apps;
    default:
      return unreachable(config);
  }
}
