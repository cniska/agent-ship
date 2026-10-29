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

test("AC-24 the reusable workflow runs when called and on a pushed v* tag, one run per tag at a time, and the npm job may request an OIDC token", () => {
  const on = tableAt(workflow, "on");
  expect(Object.keys(on).toSorted()).toEqual(["push", "workflow_call"]);
  expect(on.push).toEqual({ tags: ["v*"] });
  expect(tableAt(workflow, "concurrency")).toEqual({
    group: "agent-ship-release-${{ github.repository }}-${{ github.ref }}",
    "cancel-in-progress": false,
  });
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
  for (const name of ["plan", "github-release-targets", ...PUBLISHING_JOBS, "npm-smoke"]) {
    const steps = stepsOf(name);
    const mask = index(steps, running(MASK), `masking in ${name}`);
    const readers = steps.flatMap((step, at) => (READS_SECRETS.test(JSON.stringify(step)) ? [at] : []));
    expect(readers).toEqual([mask]);
    expect(steps.slice(0, mask).every((step) => textAt(step, "uses").startsWith("actions/checkout@"))).toBe(
      true,
    );
  }
});

test("AC-26 each target builds on its own runner, the release is a draft after every file's attestation and published later, npm publishes with provenance and no token, then each target's runner installs it from the registry through npm and Bun into a prefix of its own and smokes it, the tap waits on the published release, and a served channel is skipped", () => {
  const targets = tableAt(jobs, "github-release-targets");
  expect(tableAt(tableAt(targets, "strategy"), "matrix").include).toEqual([
    { target: "darwin-arm64", runner: "macos-latest" },
    { target: "linux-x64", runner: "ubuntu-latest" },
  ]);
  expect(targets["runs-on"]).toBe("${{ matrix.runner }}");
  const built = stepsOf("github-release-targets");
  const build = index(built, running('"$BUILD"'), "building a target");
  expect(tableAt(built[build], "env").TARGET).toBe("${{ matrix.target }}");
  const kept = index(built, (step) => textAt(step, "uses").startsWith("actions/upload-artifact@"), "keeping");
  expect(build < kept).toBe(true);

  const release = stepsOf("github-release");
  expect(needsOf("github-release")).toContain("github-release-targets");
  const fetched = index(
    release,
    (step) => textAt(step, "uses").startsWith("actions/download-artifact@"),
    "fetching",
  );
  const merged = index(
    release,
    running("scripts/target-files.ts"),
    "putting each target's files at their paths",
  );
  const assembled = index(release, running('"$ASSEMBLE"'), "assembling");
  expect(textAt(release[assembled], "if")).toBe("needs.plan.outputs.github-release-assemble != ''");
  const checked = index(release, running('[ -f "$file" ]'), "checking every file is made");
  const attest = index(release, (step) => textAt(step, "uses").startsWith("actions/attest@"), "attesting");
  expect(tableAt(release[attest], "with")["subject-path"]).toBe("${{ steps.files.outputs.subjects }}");
  const draft = index(release, running("scripts/release-files.ts"), "drafting");
  const publish = index(release, running("--draft=false"), "publishing the release");
  const steps = [fetched, merged, assembled, checked, attest, draft, publish];
  expect(steps.toSorted((a, b) => a - b)).toEqual(steps);

  const npm = stepsOf("npm");
  const environments = [workflow, tableAt(jobs, "npm"), ...npm].map((holder) =>
    isTable(holder) && isTable(holder.env) ? holder.env : {},
  );
  expect(environments.flatMap(Object.keys).filter((name) => NPM_TOKEN.test(name))).toEqual([]);
  expect(npm.some((step) => isTable(step.with) && step.with["registry-url"] !== undefined)).toBe(false);
  expect(needsOf("npm")).toContain("github-release");
  const npmIf = textAt(tableAt(jobs, "npm"), "if");
  expect(npmIf).toContain("needs.plan.outputs.npm-build == ''");
  expect(npmIf).toContain("needs.github-release.result == 'success'");
  expect(npmIf).toContain("needs.plan.outputs.github-release != 'publish'");
  const downloaded = index(npm, running("gh release download"), "putting the release's files at their paths");
  expect(textAt(npm[downloaded], "if")).toContain("needs.plan.outputs.npm-build != ''");
  const holdsToken = environments.flatMap((env, at) => ("GH_TOKEN" in env ? [at] : []));
  expect(holdsToken).toEqual([environments.length - npm.length + downloaded]);
  const builtNpm = index(npm, running('"$BUILD"'), "building the npm packages");
  const found = index(npm, running("scripts/npm-packages.ts"), "finding each package's directory");
  const published = index(npm, running("npm publish"), "publishing to npm");
  expect(textAt(npm[published], "run")).toContain("--provenance");
  expect(textAt(npm[published], "run")).toContain('npm view "$name@$VERSION"');
  const order = [downloaded, builtNpm, found, published];
  expect(order.toSorted((a, b) => a - b)).toEqual(order);
  expect(npm.some(running('"$SMOKE"'))).toBe(false);
  expect(tableAt(tableAt(jobs, "npm"), "outputs").install).toBe("${{ steps.packages.outputs.install }}");

  const smokeJob = tableAt(jobs, "npm-smoke");
  expect(needsOf("npm-smoke")).toContain("npm");
  expect(textAt(smokeJob, "if")).toBe("needs.plan.outputs.npm == 'publish'");
  expect(smokeJob["runs-on"]).toBe("${{ matrix.runner }}");
  const strategy = tableAt(smokeJob, "strategy");
  expect(strategy["fail-fast"]).toBe(false);
  expect(tableAt(strategy, "matrix").include).toEqual([
    { target: "darwin-arm64", runner: "macos-latest", installer: "npm" },
    { target: "darwin-arm64", runner: "macos-latest", installer: "bun" },
    { target: "linux-x64", runner: "ubuntu-latest", installer: "npm" },
    { target: "linux-x64", runner: "ubuntu-latest", installer: "bun" },
  ]);
  expect(textAt(tableAt(tableAt(smokeJob, "defaults"), "run"), "working-directory")).toBe("project");
  const smokeSteps = stepsOf("npm-smoke");
  const installed = index(smokeSteps, running('"$name@$VERSION"'), "installing");
  const install = textAt(smokeSteps[installed], "run");
  expect(install).toContain('npm install --global --prefix "$RUNNER_TEMP/global"');
  expect(install).toContain('BUN_INSTALL_BIN="$RUNNER_TEMP/global/bin"');
  expect(tableAt(smokeSteps[installed], "env")).toEqual({
    INSTALL: "${{ needs.npm.outputs.install }}",
    INSTALLER: "${{ matrix.installer }}",
  });
  const smoked = index(smokeSteps, running("scripts/registry-smoke"), "smoking");
  expect(textAt(smokeSteps[smoked], "run")).toContain('BIN="$RUNNER_TEMP/global/bin"');
  expect(tableAt(smokeSteps[smoked], "env")).toEqual({
    SMOKE: "${{ needs.plan.outputs.npm-smoke }}",
    NODE_DIR: "${{ steps.node.outputs.dir }}",
  });
  expect(installed < smoked).toBe(true);
  expect(textAt(tableAt(smokeJob, "env"), "VERSION")).toBe("${{ needs.plan.outputs.version }}");
  const node = index(smokeSteps, (step) => step.id === "node", "finding Node's directory");
  expect(textAt(smokeSteps[node], "if")).toBe("needs.plan.outputs.npm-smoke-node == 'true'");
  expect(tableAt(tableAt(jobs, "plan"), "outputs")["npm-smoke-node"]).toBe(
    "${{ steps.plan.outputs.npm-smoke-node }}",
  );

  const homebrew = textAt(tableAt(jobs, "homebrew"), "if");
  expect(needsOf("homebrew")).toContain("github-release");
  expect(homebrew).toContain("needs.github-release.result == 'success'");
  expect(homebrew).toContain("needs.plan.outputs.github-release != 'publish'");
  expect(stepsOf("homebrew").some(running("/dispatches"))).toBe(true);
  const stages = tableAt(tableAt(jobs, "plan"), "outputs");
  for (const name of PUBLISHING_JOBS) expect(stages[name]).toBe(`\${{ steps.plan.outputs.${name} }}`);
});
