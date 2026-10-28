import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  ghAnswers,
  refusal,
  releasedRepo,
  removeScratchDirs,
  result,
  run,
  SHIP_TOML,
  shownList,
  TOKEN_ENV,
  write,
} from "./harness";

afterEach(removeScratchDirs);

const TOKEN = "test-tap-token";

const NPM_CHANNEL = `
[channels.npm]
packages = ["app"]
smoke = "app --version"
file-credentials = ["NPM_SMOKE_KEY"]
`;

const DASHES = "-----";

function filler(length: number): string {
  return "0".repeat(length);
}

const SECRETS = [
  { key: "channels.homebrew.tap", value: `ghp_${filler(36)}` },
  { key: "channels.homebrew.formula", value: `npm_${filler(36)}` },
  { key: "channels.homebrew.tap", value: `${DASHES}BEGIN OPENSSH PRIVATE KEY${DASHES}` },
  { key: "version", value: `ghp_${filler(36)}/package.json` },
];

function withSecret(key: string, value: string): string {
  const field = key.split(".").at(-1) ?? key;
  return SHIP_TOML.replace(new RegExp(`^${field} = ".*"$`, "m"), `${field} = "${value}"`);
}

function credentialsOf(value: unknown) {
  return shownList(value).map(({ name, channels, state, source }) => ({ name, channels, state, source }));
}

test("AC-2 a secret in ship.toml is refused by check and doctor naming its key, never its value", () => {
  for (const { key, value } of SECRETS) {
    const { w, dir } = releasedRepo({ shipToml: withSecret(key, value) });
    for (const command of ["check", "doctor"]) {
      const ran = run(w, dir, [command], TOKEN_ENV);
      const error = refusal(ran);
      expect(error.code).toBe("secret_in_config");
      expect(error.meta).toMatchObject({ key });
      expect(`${ran.stdout}${ran.stderr}`).not.toContain(value);
    }
  }
});

test("AC-23 doctor reports each credential the channels name, its channels and source, and the fix for each one missing", () => {
  const { w, dir } = releasedRepo({ shipToml: `${SHIP_TOML}${NPM_CHANNEL}` });
  const key = join(w.root, "smoke.key");
  write(w.root, "smoke.key", "test-smoke-key\n");
  write(dir, ".env", `NPM_SMOKE_KEY=${key}\n`);
  const env = { ...TOKEN_ENV, UNNAMED_TOKEN: "test-unnamed" };
  const present = run(w, dir, ["doctor"], env);
  const report = result(present);
  expect(shownList(report.tools).map(({ name, state }) => ({ name, state }))).toEqual([
    { name: "git", state: "ok" },
    { name: "gh", state: "ok" },
  ]);
  expect(credentialsOf(report.credentials)).toEqual([
    { name: "TAP_DISPATCH_TOKEN", channels: ["homebrew"], state: "ok", source: "environment" },
    { name: "NPM_SMOKE_KEY", channels: ["npm"], state: "ok", source: key },
  ]);
  expect(present.stdout).not.toContain(TOKEN);
  expect(present.stdout).not.toContain("UNNAMED_TOKEN");

  ghAnswers(w, { secrets: ["TAP_DISPATCH_TOKEN"] });
  expect(credentialsOf(result(run(w, dir, ["doctor"])).credentials)[0]).toEqual({
    name: "TAP_DISPATCH_TOKEN",
    channels: ["homebrew"],
    state: "ok",
    source: "actions-secret",
  });

  ghAnswers(w, {});
  write(dir, ".env", `NPM_SMOKE_KEY=${join(w.root, "missing.key")}\n`);
  const missing = run(w, dir, ["doctor"]);
  const failing = shownList(result(missing, 1).credentials);
  expect(failing.map(({ name, state, source }) => ({ name, state, source }))).toEqual([
    { name: "TAP_DISPATCH_TOKEN", state: "fail", source: null },
    { name: "NPM_SMOKE_KEY", state: "fail", source: null },
  ]);
  expect(failing[0]?.fix).toContain("gh secret set TAP_DISPATCH_TOKEN");
  expect(failing[1]?.detail).toContain(join(w.root, "missing.key"));
  expect(failing[1]?.fix).not.toContain("gh secret set");
});

test("AC-23 doctor reports git missing from PATH as its fix, reading no credential", () => {
  const { w, dir } = releasedRepo();
  rmSync(join(w.bin, "git"));
  const ran = run(w, dir, ["doctor"], TOKEN_ENV);
  const report = result(ran, 1);
  expect(shownList(report.tools).map(({ name, state, fix }) => ({ name, state, fix }))).toEqual([
    { name: "git", state: "fail", fix: "install git and put it on PATH" },
    { name: "gh", state: "ok", fix: null },
  ]);
  expect(report.credentials).toBeNull();
});
