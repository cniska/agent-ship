import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unreachable } from "./assert";
import { formulaTag } from "./channels";
import { faults, messageOf } from "./coded-error";
import { type ProcessEnv, spawnProgram } from "./exec";
import { isTable, parsedJson, type Table } from "./table";
import { compareVersions, parseVersion, printVersion, type Version } from "./version";

type Platform = "darwin-arm64" | "linux-x64";

export type NoticeSetting = {
  readonly home: string | null;
  readonly cacheDir: string | null;
  readonly platform: Platform | null;
  readonly githubApi: string;
  readonly limitMs: number;
};

type NoticeAsked = { readonly program: string; readonly repo: string };

export type NoticeReach = NoticeSetting & {
  readonly env: ProcessEnv;
  readonly registry: string;
  readonly now: () => number;
};

type InstallChannel =
  | { readonly kind: "homebrew"; readonly tap: string; readonly formula: string }
  | { readonly kind: "npm" | "bun"; readonly pkg: string }
  | { readonly kind: "github"; readonly dir: string; readonly platform: Platform };

const FIXED_FAILURES = ["timeout", "unreachable", "unparsable"] as const;

type FailureCode = (typeof FIXED_FAILURES)[number] | `http_${number}`;

type Found =
  | { readonly kind: "newest"; readonly version: Version }
  | { readonly kind: "failed"; readonly code: FailureCode; readonly detail: string };

type Lookup = { readonly checked: number; readonly source: string; readonly found: Found };

type Fetched = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly found: Found };

const DAY_MS = 24 * 60 * 60 * 1000;

const fault = faults<{
  readonly record_unwritable: { readonly path: string; readonly detail: string };
}>({
  record_unwritable: {
    message: ({ path, detail }) => `could not keep the notice record at ${path}: ${detail}`,
    resolve: ({ path }) =>
      `make ${dirname(path)} writable, or set XDG_CACHE_HOME to a writable directory, then run the command again`,
  },
});

const CELLAR = /^(.*\/Cellar\/([^/]+)\/[^/]+)\//;

const BUN_GLOBAL = /\/install\/global\/node_modules\/((?:@[^/]+\/)?[^/]+)\//;

const NPM_GLOBAL = /\/lib\/node_modules\/((?:@[^/]+\/)?[^/]+)\//;

const GITHUB_INSTALL_DIR = [".local", "bin"];

const RECEIPT = "INSTALL_RECEIPT.json";

const TAP = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

const RELEASE_TAG = /^v(.+)$/;

const VERSION_FLAG = "--version";

const RAW = "application/vnd.github.raw+json";

const GITHUB_JSON = "application/vnd.github+json";

const TIMEOUT_ERROR = "TimeoutError";

const RECORD_DIR = ["agent-ship", "notice"];

const SUMS = "SHA256SUMS.txt";

const EXECUTABLE = 0o111;

const HTTP_FAILURE = /^http_\d+$/;

export function isProgramName(text: string): boolean {
  return PROGRAM_NAME.test(text);
}

export function isRepoName(text: string): boolean {
  return REPO_NAME.test(text);
}

export function cacheDirOf(xdgCache: string | undefined, home: string | undefined): string | null {
  if (xdgCache) return xdgCache;
  return home ? join(home, ".cache") : null;
}

export function platformOf(os: string, arch: string): Platform | null {
  if (os === "darwin" && arch === "arm64") return "darwin-arm64";
  if (os === "linux" && arch === "x64") return "linux-x64";
  return null;
}

function channelOf(realPath: string, reach: NoticeReach): InstallChannel | null {
  const keg = CELLAR.exec(realPath);
  if (keg !== null) {
    const tap = tapOf(keg[1] ?? "");
    return tap === null || keg[2] === undefined ? null : { kind: "homebrew", tap, formula: keg[2] };
  }
  const bun = BUN_GLOBAL.exec(realPath)?.[1];
  if (bun !== undefined) return { kind: "bun", pkg: bun };
  const npm = NPM_GLOBAL.exec(realPath)?.[1];
  if (npm !== undefined) return { kind: "npm", pkg: npm };
  const dir = dirname(realPath);
  if (
    reach.home !== null &&
    reach.platform !== null &&
    dir === resolvedDir(join(reach.home, ...GITHUB_INSTALL_DIR))
  )
    return { kind: "github", dir, platform: reach.platform };
  return null;
}

function tapOf(keg: string): string | null {
  const receipt = parsedJson(readOrNull(join(keg, RECEIPT)) ?? "");
  if (!isTable(receipt) || !isTable(receipt.source)) return null;
  const { tap } = receipt.source;
  return typeof tap === "string" && TAP.test(tap) ? tap : null;
}

function resolvedDir(path: string): string {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true ? realpathSync(path) : path;
}

function readOrNull(path: string): string | null {
  if (statSync(path, { throwIfNoEntry: false })?.isFile() !== true) return null;
  return readFileSync(path, "utf8");
}

function isExecutableFile(path: string): boolean {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats?.isFile() === true && (stats.mode & EXECUTABLE) !== 0;
}

function installedPath(program: string, searched: string): string | null {
  const found = searched
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, program))
    .find(isExecutableFile);
  return found === undefined ? null : realpathSync(found);
}

function installedVersion(path: string, reach: NoticeReach): Version | null {
  const ran = spawnProgram(path, [VERSION_FLAG], { cwd: dirname(path), env: reach.env }, reach.limitMs);
  if (!ran.started || ran.status !== 0) return null;
  return parseVersion(ran.stdout.trim());
}

function failed(code: FailureCode, detail: string): Found {
  return { kind: "failed", code, detail };
}

async function fetchedWithin(url: string, accept: string | null, limitMs: number): Promise<Fetched> {
  try {
    const response = await fetch(url, {
      headers: accept === null ? {} : { accept },
      signal: AbortSignal.timeout(limitMs),
    });
    if (!response.ok)
      return { ok: false, found: failed(`http_${response.status}`, `${url} answered ${response.status}`) };
    return { ok: true, text: await response.text() };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === TIMEOUT_ERROR;
    return {
      ok: false,
      found: timedOut
        ? failed("timeout", `${url} did not answer within ${limitMs} ms`)
        : failed("unreachable", `${url} could not be read: ${messageOf(error)}`),
    };
  }
}

function releaseVersion(tag: unknown, url: string): Found {
  const version = typeof tag === "string" ? parseVersion(RELEASE_TAG.exec(tag)?.[1] ?? "") : null;
  return version === null
    ? failed("unparsable", `${url} names no release tag v<x.y.z>`)
    : { kind: "newest", version };
}

function tableOf(text: string): Table | null {
  const parsed = parsedJson(text);
  return isTable(parsed) ? parsed : null;
}

async function registryLatest(pkg: string, reach: NoticeReach): Promise<Found> {
  const url = `${reach.registry}/${pkg.replace("/", "%2f")}`;
  const fetched = await fetchedWithin(url, null, reach.limitMs);
  if (!fetched.ok) return fetched.found;
  const tags = tableOf(fetched.text)?.["dist-tags"];
  const latest = isTable(tags) && typeof tags.latest === "string" ? parseVersion(tags.latest) : null;
  return latest === null
    ? failed("unparsable", `${url} names no latest version x.y.z`)
    : { kind: "newest", version: latest };
}

async function tapLatest(tap: string, formula: string, reach: NoticeReach): Promise<Found> {
  const [, owner, name] = TAP.exec(tap) ?? [];
  const url = `${reach.githubApi}/repos/${owner}/homebrew-${name}/contents/Formula/${formula}.rb`;
  const fetched = await fetchedWithin(url, RAW, reach.limitMs);
  if (!fetched.ok) return fetched.found;
  return releaseVersion(formulaTag(fetched.text), url);
}

async function releaseLatest(repo: string, reach: NoticeReach): Promise<Found> {
  const url = `${reach.githubApi}/repos/${repo}/releases/latest`;
  const fetched = await fetchedWithin(url, GITHUB_JSON, reach.limitMs);
  if (!fetched.ok) return fetched.found;
  return releaseVersion(tableOf(fetched.text)?.tag_name, url);
}

function newestOf(channel: InstallChannel, asked: NoticeAsked, reach: NoticeReach) {
  switch (channel.kind) {
    case "homebrew":
      return tapLatest(channel.tap, channel.formula, reach);
    case "npm":
    case "bun":
      return registryLatest(channel.pkg, reach);
    case "github":
      return releaseLatest(asked.repo, reach);
    default:
      return unreachable(channel);
  }
}

function sourceOf(channel: InstallChannel, asked: NoticeAsked): string {
  switch (channel.kind) {
    case "homebrew":
      return `homebrew ${channel.tap}/${channel.formula}`;
    case "npm":
    case "bun":
      return `${channel.kind} ${channel.pkg}`;
    case "github":
      return `github ${asked.repo}`;
    default:
      return unreachable(channel);
  }
}

function recordPath(cacheDir: string, program: string): string {
  return join(cacheDir, ...RECORD_DIR, `${program}.json`);
}

function foundOf(value: unknown): Found | null {
  if (!isTable(value)) return null;
  if (value.kind === "newest") {
    const version = typeof value.version === "string" ? parseVersion(value.version) : null;
    return version === null ? null : { kind: "newest", version };
  }
  if (value.kind !== "failed" || !isFailureCode(value.code) || typeof value.detail !== "string") return null;
  return { kind: "failed", code: value.code, detail: value.detail };
}

function isFailureCode(code: unknown): code is FailureCode {
  if (typeof code !== "string") return false;
  return FIXED_FAILURES.some((fixed) => fixed === code) || HTTP_FAILURE.test(code);
}

function recordOf(text: string | null): Lookup | null {
  const record = tableOf(text ?? "");
  if (record === null || typeof record.checked !== "number" || typeof record.source !== "string") return null;
  const found = foundOf(record.found);
  return found === null ? null : { checked: record.checked, source: record.source, found };
}

function printedFound(found: Found): Table {
  return found.kind === "newest" ? { kind: "newest", version: printVersion(found.version) } : found;
}

function keep(path: string, lookup: Lookup): void {
  const staged = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(staged, `${JSON.stringify({ ...lookup, found: printedFound(lookup.found) })}\n`);
    renameSync(staged, path);
  } catch (error) {
    throw fault("record_unwritable", { path, detail: messageOf(error) });
  }
}

async function lookedUp(
  channel: InstallChannel,
  asked: NoticeAsked,
  reach: NoticeReach,
): Promise<Found | null> {
  if (reach.cacheDir === null) return null;
  const path = recordPath(reach.cacheDir, asked.program);
  const source = sourceOf(channel, asked);
  const kept = recordOf(readOrNull(path));
  const now = reach.now();
  if (kept !== null && kept.source === source && now - kept.checked < DAY_MS) return kept.found;
  const found = await newestOf(channel, asked, reach);
  keep(path, { checked: now, source, found });
  return found;
}

function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

function upgradeCommand(channel: InstallChannel, asked: NoticeAsked, newest: Version): string {
  switch (channel.kind) {
    case "homebrew":
      return `brew upgrade ${channel.tap}/${channel.formula}`;
    case "bun":
      return `bun add --global ${channel.pkg}@latest`;
    case "npm":
      return `npm install --global ${channel.pkg}@latest`;
    case "github": {
      const tarball = `${asked.program}-${channel.platform}.tar.gz`;
      const download = `https://github.com/${asked.repo}/releases/download/v${printVersion(newest)}`;
      return [
        `(d=$(mktemp -d) && cd "$d"`,
        `curl -fsSL -O ${download}/${tarball} -O ${download}/${SUMS}`,
        `shasum -a 256 --check --ignore-missing ${SUMS}`,
        `tar -xzf ${tarball}`,
        `mv ${asked.program} ${shellQuoted(join(channel.dir, asked.program))})`,
      ].join(" && ");
    }
    default:
      return unreachable(channel);
  }
}

function noteOf(asked: NoticeAsked, installed: Version, newest: Version, command: string): string {
  return [
    `${asked.program} ${printVersion(installed)} is installed, and ${printVersion(newest)} is out.`,
    `Upgrade it now, before other work, by running: \`${command}\``,
    "If the upgrade is refused as a third-party install, do not retry it: hand the owner that exact command to run.",
  ].join(" ");
}

export async function notice(asked: NoticeAsked, reach: NoticeReach): Promise<string | null> {
  const path = installedPath(asked.program, reach.env.PATH ?? "");
  if (path === null) return null;
  const channel = channelOf(path, reach);
  if (channel === null) return null;
  const installed = installedVersion(path, reach);
  if (installed === null) return null;
  const found = await lookedUp(channel, asked, reach);
  if (found === null || found.kind === "failed" || compareVersions(found.version, installed) <= 0)
    return null;
  return noteOf(asked, installed, found.version, upgradeCommand(channel, asked, found.version));
}
