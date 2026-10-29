import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { unreachable } from "./assert";
import { refusals } from "./coded-error";
import type { NpmChannel } from "./config";
import type { ProcessEnv } from "./exec";
import { type Git, trackedFiles } from "./git";
import { invalidInput, requiredInput } from "./inputs";
import { appOfTag, type Checkout } from "./project";
import { isTable, parsedJson } from "./table";
import { printVersion } from "./version";

type NpmPackage = { readonly name: string; readonly dir: string };

export type NpmRelease = {
  readonly publish: readonly NpmPackage[];
  readonly install: readonly string[];
};

type Manifest = {
  readonly name: string;
  readonly version: string | null;
  readonly dependencies: readonly string[];
};

type Located = NpmPackage & { readonly manifest: Manifest };

type Where = { readonly root: string; readonly git: Git };

const MANIFEST = "package.json";

const NODE_MODULES = "node_modules";

const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies"];

const refuse = refusals<{
  readonly package_not_tracked: { readonly name: string };
  readonly package_not_built: { readonly name: string; readonly out: string };
  readonly package_version_mismatch: {
    readonly name: string;
    readonly dir: string;
    readonly version: string | null;
    readonly expected: string;
  };
  readonly package_order: { readonly name: string; readonly dependency: string };
}>({
  package_not_tracked: {
    message: ({ name }) => `no tracked ${MANIFEST} names the package ${name}`,
    resolve: () =>
      "name in the npm channel's packages only packages whose package.json the repository tracks, or give the channel a build and out",
  },
  package_not_built: {
    message: ({ name, out }) => `the npm channel's build wrote no ${MANIFEST} under ${out} naming ${name}`,
    resolve: () =>
      "make the npm channel's build write each package in its packages under out, then release a new version",
  },
  package_version_mismatch: {
    message: ({ name, dir, version, expected }) =>
      `${join(dir, MANIFEST)} gives ${name} the version ${version ?? "none"}, not the release's ${expected}`,
    resolve: () =>
      "give each package the version of the version source, through the build for a built one, then release again",
  },
  package_order: {
    message: ({ name, dependency }) =>
      `the npm channel lists ${name} before ${dependency}, which it depends on, so it would publish first`,
    resolve: ({ name, dependency }) =>
      `list ${dependency} before ${name} in the npm channel's packages, then release again`,
  },
});

function namesIn(value: unknown): readonly string[] {
  return isTable(value) ? Object.keys(value) : [];
}

function manifestAt(path: string): Manifest | null {
  const manifest = parsedJson(readFileSync(path, "utf8"));
  if (!isTable(manifest) || typeof manifest.name !== "string") return null;
  return {
    name: manifest.name,
    version: typeof manifest.version === "string" ? manifest.version : null,
    dependencies: DEPENDENCY_FIELDS.flatMap((field) => namesIn(manifest[field])),
  };
}

function trackedManifests({ git }: Where): readonly string[] {
  return trackedFiles(git).filter((file) => basename(file) === MANIFEST);
}

function builtManifests({ root }: Where, out: string): readonly string[] {
  if (!statSync(join(root, out), { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(join(root, out), { recursive: true, encoding: "utf8" })
    .filter((path) => basename(path) === MANIFEST && !path.split(sep).includes(NODE_MODULES))
    .map((path) => join(out, path));
}

function manifestsOf(where: Where, channel: NpmChannel): ReadonlyMap<string, Located> {
  const paths =
    channel.source.kind === "built" ? builtManifests(where, channel.source.out) : trackedManifests(where);
  const found = new Map<string, Located>();
  for (const path of paths) {
    const manifest = manifestAt(join(where.root, path));
    if (manifest !== null) found.set(manifest.name, { name: manifest.name, dir: dirname(path), manifest });
  }
  return found;
}

function missing(channel: NpmChannel, name: string) {
  switch (channel.source.kind) {
    case "tracked":
      return refuse("package_not_tracked", { name });
    case "built":
      return refuse("package_not_built", { name, out: channel.source.out });
    default:
      return unreachable(channel.source);
  }
}

function located(where: Where, channel: NpmChannel, version: string): readonly Located[] {
  const manifests = manifestsOf(where, channel);
  return channel.packages.map((name) => {
    const found = manifests.get(name);
    if (found === undefined) throw missing(channel, name);
    if (found.manifest.version !== version)
      throw refuse("package_version_mismatch", {
        name,
        dir: found.dir,
        version: found.manifest.version,
        expected: version,
      });
    return found;
  });
}

function refuseOutOfOrder(packages: readonly Located[]): void {
  packages.forEach(({ name, manifest }, at) => {
    const later = packages.slice(at + 1).find((other) => manifest.dependencies.includes(other.name));
    if (later !== undefined) throw refuse("package_order", { name, dependency: later.name });
  });
}

export function npmRelease(where: Where, channel: NpmChannel, version: string): NpmRelease {
  const packages = located(where, channel, version);
  refuseOutOfOrder(packages);
  const depended = new Set(packages.flatMap(({ manifest }) => manifest.dependencies));
  return {
    publish: packages.map(({ name, dir }) => ({ name, dir })),
    install: packages.map(({ name }) => name).filter((name) => !depended.has(name)),
  };
}

export type NpmInputs = { readonly tag: string; readonly output: string };

export function npmInputs(env: ProcessEnv): NpmInputs {
  return { tag: requiredInput(env, "TAG"), output: requiredInput(env, "GITHUB_OUTPUT") };
}

export function releasedPackages(checkout: Checkout, tag: string): NpmRelease {
  const choice = appOfTag(checkout.config, tag);
  if (choice === null) throw invalidInput("TAG", "is not a release tag of ship.toml");
  const channel = choice.app.channels.find((found) => found.kind === "npm");
  if (channel === undefined) throw invalidInput("TAG", "is the tag of an app with no npm channel");
  return npmRelease(checkout, channel, printVersion(choice.version));
}

export function npmOutputs(release: NpmRelease): Readonly<Record<string, string>> {
  return {
    publish: release.publish.map(({ name, dir }) => `${name} ${dir}`).join("\n"),
    install: release.install.join("\n"),
  };
}
