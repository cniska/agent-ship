import { basename } from "node:path";
import { unreachable } from "./assert";
import { messageOf } from "./coded-error";
import type { Channel } from "./config";
import { type Gh, ghJson, ghText } from "./gh";
import { isTable } from "./table";
import { printVersion, type Version } from "./version";

type Kind = Channel["kind"];

export type Serving =
  | { readonly channel: Kind; readonly state: "served"; readonly detail: null }
  | { readonly channel: Kind; readonly state: "missing" | "unreadable"; readonly detail: string };

type Found =
  | { readonly state: "served" }
  | { readonly state: "missing" | "unreadable"; readonly detail: string };

export type Release = {
  readonly id: number;
  readonly tag: string;
  readonly draft: boolean;
  readonly assets: readonly string[];
};

type Releases =
  | { readonly ok: true; readonly releases: readonly Release[] }
  | { readonly ok: false; readonly detail: string };

export type Reach = {
  readonly gh: Gh;
  readonly registry: string;
  readonly tag: string;
  readonly version: Version;
};

const NPM_REGISTRY = "https://registry.npmjs.org";

const TRAILING_SLASH = /\/+$/;

const SERVED: Found = { state: "served" };

const NOT_FOUND = 404;

const RELEASES_PATH = "repos/{owner}/{repo}/releases";

const RELEASES = ["api", "--paginate", "--slurp", RELEASES_PATH];

const RAW = ["-H", "Accept: application/vnd.github.raw+json"];

const FORMULA_URL = /^\s*url\s+"([^"]+)"/gm;

const FORMULA_VERSION = /^\s*version\s+"([^"]+)"/m;

export function registryOf(configured: string | undefined): string {
  return (configured || NPM_REGISTRY).replace(TRAILING_SLASH, "");
}

function releaseOf(value: unknown): Release | null {
  if (!isTable(value) || typeof value.id !== "number") return null;
  if (typeof value.tag_name !== "string" || typeof value.draft !== "boolean") return null;
  if (!Array.isArray(value.assets)) return null;
  const assets = value.assets.map((asset) => (isTable(asset) ? asset.name : null));
  if (!assets.every((name) => typeof name === "string")) return null;
  return { id: value.id, tag: value.tag_name, draft: value.draft, assets };
}

function releasesOf(pages: unknown): readonly Release[] | null {
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) return null;
  const releases = pages.flat().map(releaseOf);
  return releases.every((release) => release !== null) ? releases : null;
}

export function readReleases(gh: Gh): Releases {
  const answer = ghJson(gh, RELEASES);
  if (!answer.ok) return answer;
  const releases = releasesOf(answer.json);
  if (releases === null) return { ok: false, detail: `gh ${RELEASES.join(" ")} printed no list of releases` };
  return { ok: true, releases };
}

export function publishedRelease(releases: readonly Release[], tag: string): Release | null {
  return releases.find((release) => release.tag === tag && !release.draft) ?? null;
}

export function releaseDeletion(id: number): readonly string[] {
  return ["api", "--method", "DELETE", `${RELEASES_PATH}/${id}`];
}

function releaseServes(reach: Reach, files: readonly string[]): Found {
  const read = readReleases(reach.gh);
  if (!read.ok) return { state: "unreadable", detail: read.detail };
  const release = publishedRelease(read.releases, reach.tag);
  if (release === null) {
    const drafted = read.releases.some(({ tag }) => tag === reach.tag);
    return {
      state: "missing",
      detail: drafted ? `${reach.tag}'s release is a draft` : `${reach.tag} has no release`,
    };
  }
  const absent = files.map((file) => basename(file)).filter((name) => !release.assets.includes(name));
  if (absent.length > 0)
    return { state: "missing", detail: `${reach.tag}'s release lacks ${absent.join(", ")}` };
  return SERVED;
}

function packagePath(name: string): string {
  return name.replace("/", "%2f");
}

async function packageServes(registry: string, name: string, version: string): Promise<Found> {
  const url = `${registry}/${packagePath(name)}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    return { state: "unreadable", detail: `${url} could not be read: ${messageOf(error)}` };
  }
  if (response.status === NOT_FOUND)
    return { state: "missing", detail: `the registry has no package ${name}` };
  if (!response.ok) return { state: "unreadable", detail: `${url} answered ${response.status}` };
  const body: unknown = await response.json().catch(() => null);
  if (!isTable(body) || !isTable(body.versions))
    return { state: "unreadable", detail: `${url} answered with no versions` };
  return version in body.versions
    ? SERVED
    : { state: "missing", detail: `${name} has no ${version} on the registry` };
}

async function packagesServe(reach: Reach, packages: readonly string[]): Promise<Found> {
  const version = printVersion(reach.version);
  const found = await Promise.all(packages.map((name) => packageServes(reach.registry, name, version)));
  return (
    found.find(({ state }) => state === "missing") ??
    found.find(({ state }) => state === "unreadable") ??
    SERVED
  );
}

function pins(formula: string, tag: string, version: string): boolean {
  const urls = [...formula.matchAll(FORMULA_URL)].map((match) => match[1] ?? "");
  const stated = FORMULA_VERSION.exec(formula)?.[1] ?? null;
  if (stated !== null && stated !== version) return false;
  return urls.length > 0 && urls.every((url) => url.includes(`/releases/download/${tag}/`));
}

function formulaServes(reach: Reach, tap: string, formula: string): Found {
  const answer = ghText(reach.gh, ["api", ...RAW, `repos/${tap}/contents/${formula}`]);
  if (!answer.ok) return { state: "unreadable", detail: answer.detail };
  if (pins(answer.text, reach.tag, printVersion(reach.version))) return SERVED;
  return { state: "missing", detail: `${tap}'s ${formula} does not pin ${reach.tag}` };
}

function foundOn(reach: Reach, channel: Channel): Found | Promise<Found> {
  switch (channel.kind) {
    case "github-release":
      return releaseServes(reach, channel.files);
    case "npm":
      return packagesServe(reach, channel.packages);
    case "homebrew":
      return formulaServes(reach, channel.tap, channel.formula);
    default:
      return unreachable(channel);
  }
}

export async function serving(reach: Reach, channels: readonly Channel[]): Promise<readonly Serving[]> {
  return Promise.all(
    channels.map(async (channel): Promise<Serving> => {
      const found = await foundOn(reach, channel);
      return found.state === "served"
        ? { channel: channel.kind, state: "served", detail: null }
        : { channel: channel.kind, ...found };
    }),
  );
}
