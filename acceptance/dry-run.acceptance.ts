import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPS_TOML,
  commit,
  emptyRepo,
  ghCalls,
  packageJson,
  refusal,
  removeScratchDirs,
  result,
  runScript,
  shownList,
  world,
} from "./harness";

afterEach(removeScratchDirs);

function appsRepo() {
  const w = world();
  const dir = emptyRepo(w);
  commit(w, dir, "feat: apps", {
    "ship.toml": APPS_TOML("", ""),
    "web/package.json": packageJson("1.0.1", "web"),
    "cli/package.json": packageJson("2.0.0", "cli"),
  });
  return { w, dir };
}

function dryRun(app: string, secrets: readonly string[]) {
  const { w, dir } = appsRepo();
  const output = join(w.root, "github-output");
  const ran = runScript(w, dir, "release-plan.ts", {
    EVENT: "workflow_dispatch",
    TAG: "main",
    APP: app,
    SECRET_NAMES: JSON.stringify(secrets),
    GITHUB_OUTPUT: output,
  });
  return { w, ran, output };
}

test("AC-34 a dispatch is a dry run of the app it names at its recorded version, every channel dry-run with no channel read, and is refused dry_run_app_invalid with no app or an unknown one, and missing_credential as a release is", () => {
  const web = dryRun("web", ["TAP_DISPATCH_TOKEN"]);
  const plan = result(web.ran);
  expect([plan.tag, plan.version]).toEqual(["web-v1.0.1", "1.0.1"]);
  expect(shownList(plan.channels).map(({ kind, stage }) => ({ kind, stage }))).toEqual([
    { kind: "homebrew", stage: "dry-run" },
  ]);
  expect(readFileSync(web.output, "utf8")).toContain("\nweb-v1.0.1\n");
  expect(ghCalls(web.w)).toEqual([]);

  for (const app of ["", "api"]) {
    const refused = dryRun(app, ["TAP_DISPATCH_TOKEN"]);
    expect(refusal(refused.ran).code).toBe("dry_run_app_invalid");
    expect(existsSync(refused.output)).toBe(false);
  }

  const missing = dryRun("cli", []);
  expect(refusal(missing.ran).code).toBe("missing_credential");
  expect(existsSync(missing.output)).toBe(false);
});
