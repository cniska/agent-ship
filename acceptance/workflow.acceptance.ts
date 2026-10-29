import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = join(import.meta.dir, "..", ".github", "workflows", "release.yml");

type Table = Readonly<Record<string, unknown>>;

const PUBLISHING_JOBS = ["github-release", "npm", "homebrew"];

const MASK = "release-secrets";

const READS_SECRETS = /\bsecrets\b/;

const NPM_TOKEN = /NODE_AUTH_TOKEN|NPM_TOKEN/;

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tableAt(value: unknown, key: string): Table {
  const found = isTable(value) ? value[key] : undefined;
  if (!isTable(found)) throw new Error(`release.yml has no table ${key}`);
  return found;
}

function textAt(value: unknown, key: string): string {
  const found = isTable(value) ? value[key] : undefined;
  return typeof found === "string" ? found : "";
}

const workflow: unknown = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8"));

const jobs = tableAt(workflow, "jobs");

function stepsOf(name: string): readonly Table[] {
  const steps = tableAt(jobs, name).steps;
  if (!Array.isArray(steps) || !steps.every(isTable)) throw new Error(`job ${name} has no list of steps`);
  return steps;
}

function needsOf(name: string): readonly unknown[] {
  const needs = tableAt(jobs, name).needs;
  return Array.isArray(needs) ? needs : [needs];
}

function index(steps: readonly Table[], matches: (step: Table) => boolean, what: string): number {
  const at = steps.findIndex(matches);
  if (at === -1) throw new Error(`no step ${what}`);
  return at;
}

const running = (fragment: string) => (step: Table) => textAt(step, "run").includes(fragment);

test("AC-24 the reusable workflow runs when called and on a pushed v* tag, and the npm job may request an OIDC token", () => {
  const on = tableAt(workflow, "on");
  expect(Object.keys(on).toSorted()).toEqual(["push", "workflow_call"]);
  expect(on.push).toEqual({ tags: ["v*"] });
  expect(tableAt(tableAt(jobs, "npm"), "permissions")["id-token"]).toBe("write");
});

test("AC-25 the tag and credential check precedes every build and publish, and each job masks the credentials before any step reads them", () => {
  const plan = stepsOf("plan");
  const check = index(plan, (step) => step.name === "Check the tag and the credentials", "checking the tag");
  expect(textAt(plan[check], "run")).toContain("release-plan.ts");
  expect(plan.some((step) => /npm publish|gh release|dispatches|attest/.test(JSON.stringify(step)))).toBe(
    false,
  );
  for (const name of PUBLISHING_JOBS) {
    expect(needsOf(name)).toContain("plan");
    expect(textAt(tableAt(jobs, name), "if")).toContain(`needs.plan.outputs.${name} == 'publish'`);
  }
  for (const name of ["plan", ...PUBLISHING_JOBS]) {
    const steps = stepsOf(name);
    const mask = index(steps, running(MASK), `masking in ${name}`);
    const readers = steps.flatMap((step, at) => (READS_SECRETS.test(JSON.stringify(step)) ? [at] : []));
    expect(readers).toEqual([mask]);
    expect(steps.slice(0, mask).every((step) => textAt(step, "uses").startsWith("actions/checkout@"))).toBe(
      true,
    );
  }
});

test("AC-26 the release is a draft after every file's attestation and published later, npm publishes with provenance and no token then installs and smokes, the tap waits on the published release, and a served channel is skipped", () => {
  const release = stepsOf("github-release");
  const build = index(release, running('"$BUILD"'), "building");
  expect(textAt(release[build], "run")).toContain('[ -f "$file" ]');
  const attest = index(release, (step) => textAt(step, "uses").startsWith("actions/attest@"), "attesting");
  expect(tableAt(release[attest], "with")["subject-path"]).toBe("${{ steps.build.outputs.subjects }}");
  const draft = index(release, running("scripts/release-files.ts"), "drafting");
  const publish = index(release, running("--draft=false"), "publishing the release");
  expect(build < attest && attest < draft && draft < publish).toBe(true);

  const npm = stepsOf("npm");
  const environments = [workflow, tableAt(jobs, "npm"), ...npm].map((holder) =>
    isTable(holder) && isTable(holder.env) ? holder.env : {},
  );
  expect(environments.flatMap(Object.keys).filter((name) => NPM_TOKEN.test(name))).toEqual([]);
  expect(npm.some((step) => isTable(step.with) && step.with["registry-url"] !== undefined)).toBe(false);
  const published = index(npm, running("npm publish"), "publishing to npm");
  expect(textAt(npm[published], "run")).toContain("--provenance");
  expect(textAt(npm[published], "run")).toContain('npm view "$name@$VERSION"');
  const installed = index(npm, running("npm install --global"), "installing");
  expect(textAt(npm[installed], "run")).toContain('"$name@$VERSION"');
  const smoked = index(npm, running('"$SMOKE"'), "smoking");
  expect(published < installed && installed < smoked).toBe(true);

  const homebrew = textAt(tableAt(jobs, "homebrew"), "if");
  expect(needsOf("homebrew")).toContain("github-release");
  expect(homebrew).toContain("needs.github-release.result == 'success'");
  expect(homebrew).toContain("needs.plan.outputs.github-release != 'publish'");
  expect(stepsOf("homebrew").some(running("/dispatches"))).toBe(true);
  const stages = tableAt(tableAt(jobs, "plan"), "outputs");
  for (const name of PUBLISHING_JOBS) expect(stages[name]).toBe(`\${{ steps.plan.outputs.${name} }}`);
});
