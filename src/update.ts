import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { unreachable } from "./assert";
import { formulaTag, GITHUB_RAW, packagePath } from "./channels";
import { isTable, parsedJson } from "./table";
import { compareVersions, parseVersion, printVersion, type Version } from "./version";

type Install = "homebrew" | "npm" | "bun";

export type UpdateReach = {
  readonly program: string;
  readonly pkg: string;
  readonly executable: string;
  readonly running: string;
  readonly stateHome: string | null;
  readonly off: boolean;
  readonly registry: string;
  readonly githubApi: string;
  readonly limitMs: number;
  readonly now: number;
};

type Checked = { readonly checked: number; readonly install: Install; readonly latest: Version | null };

const TAP_CONTENTS = "repos/cniska/homebrew-tap/contents/Formula";

const RELEASE_TAG = /^v(.+)$/;

const CELLAR = "Cellar";

const KEG_BIN = "bin";

const BUN_GLOBAL = "/install/global/node_modules/";

const NPM_GLOBAL = "/lib/node_modules/";

const STATE_FILE = "update-check.json";

const DAY_MS = 24 * 60 * 60 * 1000;

const INSTALLS: readonly Install[] = ["homebrew", "npm", "bun"];

export function stateHomeOf(xdgState: string | undefined, home: string | undefined): string | null {
  if (xdgState) return xdgState;
  return home ? join(home, ".local", "state") : null;
}

function isKeg(executable: string, program: string): boolean {
  const [cellar, formula, version, bin, file] = executable.split("/").slice(-5);
  return cellar === CELLAR && formula === program && version !== "" && bin === KEG_BIN && file === program;
}

function isPlatformBinary(executable: string, program: string, pkg: string): boolean {
  const platformPackage = dirname(executable);
  return (
    basename(executable) === program &&
    basename(dirname(platformPackage)) === dirname(pkg) &&
    basename(platformPackage).startsWith(`${basename(pkg)}-`)
  );
}

function installOf({ executable, program, pkg }: UpdateReach): Install | null {
  if (isKeg(executable, program)) return "homebrew";
  if (!isPlatformBinary(executable, program, pkg)) return null;
  if (executable.includes(BUN_GLOBAL)) return "bun";
  if (executable.includes(NPM_GLOBAL)) return "npm";
  return null;
}

function upgradeCommand(install: Install, reach: UpdateReach): string {
  switch (install) {
    case "homebrew":
      return `brew upgrade ${reach.program}`;
    case "npm":
      return `npm update -g ${reach.pkg}`;
    case "bun":
      return `bun update -g ${reach.pkg}`;
    default:
      return unreachable(install);
  }
}

async function fetchedText(url: string, accept: string | null, limitMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: accept === null ? {} : { accept },
      signal: AbortSignal.timeout(limitMs),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function registryLatest(reach: UpdateReach): Promise<Version | null> {
  const text = await fetchedText(`${reach.registry}/${packagePath(reach.pkg)}`, null, reach.limitMs);
  if (text === null) return null;
  const packument = parsedJson(text);
  const tags = isTable(packument) ? packument["dist-tags"] : null;
  return isTable(tags) && typeof tags.latest === "string" ? parseVersion(tags.latest) : null;
}

async function tapLatest(reach: UpdateReach): Promise<Version | null> {
  const text = await fetchedText(
    `${reach.githubApi}/${TAP_CONTENTS}/${reach.program}.rb`,
    GITHUB_RAW,
    reach.limitMs,
  );
  if (text === null) return null;
  const tag = formulaTag(text);
  const version = tag === null ? null : RELEASE_TAG.exec(tag)?.[1];
  return version === undefined || version === null ? null : parseVersion(version);
}

function latestOn(install: Install, reach: UpdateReach): Promise<Version | null> {
  switch (install) {
    case "homebrew":
      return tapLatest(reach);
    case "npm":
    case "bun":
      return registryLatest(reach);
    default:
      return unreachable(install);
  }
}

function checkedOf(text: string): Checked | null {
  const kept = parsedJson(text);
  if (!isTable(kept) || typeof kept.checked !== "number") return null;
  const install = INSTALLS.find((known) => known === kept.install);
  if (install === undefined) return null;
  if (kept.latest === null) return { checked: kept.checked, install, latest: null };
  const latest = typeof kept.latest === "string" ? parseVersion(kept.latest) : null;
  return latest === null ? null : { checked: kept.checked, install, latest };
}

function readChecked(path: string): Checked | null {
  try {
    return checkedOf(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function keptChecked(path: string, checked: Checked): boolean {
  const staged = `${path}.${process.pid}.tmp`;
  const latest = checked.latest === null ? null : printVersion(checked.latest);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(staged, `${JSON.stringify({ ...checked, latest })}\n`);
    renameSync(staged, path);
    return true;
  } catch {
    return false;
  }
}

function isFresh(checked: Checked, install: Install, now: number): boolean {
  const age = now - checked.checked;
  return checked.install === install && age >= 0 && age < DAY_MS;
}

async function latestKnown(install: Install, stateHome: string, reach: UpdateReach): Promise<Version | null> {
  const path = join(stateHome, reach.program, STATE_FILE);
  const kept = readChecked(path);
  if (kept !== null && isFresh(kept, install, reach.now)) return kept.latest;
  if (!keptChecked(path, { checked: reach.now, install, latest: null })) return null;
  const latest = await latestOn(install, reach);
  keptChecked(path, { checked: reach.now, install, latest });
  return latest;
}

export async function updateLine(reach: UpdateReach): Promise<string | null> {
  if (reach.off || reach.stateHome === null) return null;
  const install = installOf(reach);
  const running = parseVersion(reach.running);
  if (install === null || running === null) return null;
  const latest = await latestKnown(install, reach.stateHome, reach);
  if (latest === null || compareVersions(latest, running) <= 0) return null;
  return `${reach.program} ${printVersion(latest)} is out (running ${printVersion(running)}): run ${upgradeCommand(install, reach)}; if you cannot, tell the user.`;
}
