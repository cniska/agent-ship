import { afterEach, expect, test } from "bun:test";
import { userInfo } from "node:os";
import {
  commit,
  ghAnswers,
  ghCalls,
  git,
  refusal,
  registryFails,
  registryRequests,
  registryServes,
  releasedRepo,
  removeScratchDirs,
  result,
  run,
  SHIP_TOML,
  shownList,
  tapHolds,
  usageCodeOf,
  type World,
} from "./harness";

afterEach(removeScratchDirs);

const CHANNELS = `
[channels.github-release]
build = "scripts/build.sh"
files = ["dist/app-darwin-arm64.tar.gz", "dist/app-linux-x64.tar.gz"]

[channels.npm]
packages = ["app", "@owner/app-core"]
smoke = "app --version"
`;

const RELEASE_YML = `name: release
on:
  push:
    tags: ["v*"]
jobs:
  release:
    uses: owner/agent-ship/.github/workflows/release.yml@v1
`;

const CHECK_YML = `name: check
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
`;

const NEGATED_YML = `name: negated
on:
  push:
    tags: ["v*", "!v1.0.*"]
jobs:
  negated:
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
`;

const ASSETS = ["app-darwin-arm64.tar.gz", "app-linux-x64.tar.gz"];

const PASSED = [{ status: "completed", conclusion: "success" }];

const RUNNING = [{ status: "in_progress", conclusion: "" }];

function formula(tag: string, version: string): string {
  const url = (file: string) => `https://github.com/owner/app/releases/download/${tag}/${file}`;
  return [
    "class App < Formula",
    `  version "${version}"`,
    "  on_macos do",
    `    url "${url(ASSETS[0] ?? "")}"`,
    "  end",
    "  on_linux do",
    `    url "${url(ASSETS[1] ?? "")}"`,
    "  end",
    "end",
    "",
  ].join("\n");
}

type Shipped = { readonly w: World; readonly dir: string };

function shippedRepo(
  workflows: Readonly<Record<string, string>> = { ".github/workflows/release.yml": RELEASE_YML },
) {
  const { w, dir } = releasedRepo({ shipToml: `${SHIP_TOML}${CHANNELS}` });
  commit(w, dir, "ci: release workflow", workflows);
  git(w, dir, ["tag", "-a", "-m", "v1.0.1", "v1.0.1"]);
  ghAnswers(w, {
    runs: { "release.yml": [PASSED] },
    releases: [{ tagName: "v1.0.1", isDraft: false, assets: ASSETS }],
  });
  registryServes(w, "app", ["1.0.0", "1.0.1"]);
  registryServes(w, "@owner/app-core", ["1.0.0", "1.0.1"]);
  tapHolds(w, "owner/homebrew-tap", "Formula/app.rb", formula("v1.0.1", "1.0.1"));
  return { w, dir };
}

function status({ w, dir }: Shipped, tag = "v1.0.1") {
  return run(w, dir, ["status", tag]);
}

function runsOf(value: unknown) {
  return shownList(value).map(({ workflow, state, conclusion }) => ({ workflow, state, conclusion }));
}

function statesOf(value: unknown) {
  return shownList(value).map(({ channel, state }) => ({ channel, state }));
}

function channelOf(value: unknown, kind: string) {
  const found = shownList(value).find(({ channel: named }) => named === kind);
  if (found === undefined) throw new Error(`status reported no channel ${kind}`);
  return found;
}

const ALL_SERVED = [
  { channel: "homebrew", state: "served" },
  { channel: "github-release", state: "served" },
  { channel: "npm", state: "served" },
];

test("AC-20 status reports the tag's release run passed and every channel served", () => {
  const shipped = shippedRepo();
  const report = result(status(shipped));
  expect(report.version).toBe("1.0.1");
  expect(runsOf(report.runs)).toEqual([{ workflow: "release.yml", state: "passed", conclusion: null }]);
  expect(statesOf(report.channels)).toEqual(ALL_SERVED);
});

test("AC-21 each channel not serving the version is missing or unreadable with the reason, exit 1", () => {
  const draft = shippedRepo();
  ghAnswers(draft.w, {
    runs: { "release.yml": [PASSED] },
    releases: [{ tagName: "v1.0.1", isDraft: true, assets: ASSETS }],
  });
  const drafted = channelOf(result(status(draft), 1).channels, "github-release");
  expect(drafted).toMatchObject({ state: "missing", detail: "v1.0.1's release is a draft" });

  const lacking = shippedRepo();
  ghAnswers(lacking.w, {
    runs: { "release.yml": [PASSED] },
    releases: [{ tagName: "v1.0.1", isDraft: false, assets: ASSETS.slice(0, 1) }],
  });
  const partial = channelOf(result(status(lacking), 1).channels, "github-release");
  expect(partial).toMatchObject({ state: "missing", detail: "v1.0.1's release lacks app-linux-x64.tar.gz" });

  const behind = shippedRepo();
  registryServes(behind.w, "@owner/app-core", ["1.0.0"]);
  const npm = channelOf(result(status(behind), 1).channels, "npm");
  expect(npm).toMatchObject({ state: "missing", detail: "@owner/app-core has no 1.0.1 on the registry" });

  const pinnedOld = shippedRepo();
  tapHolds(pinnedOld.w, "owner/homebrew-tap", "Formula/app.rb", formula("v1.0.0", "1.0.0"));
  const tap = channelOf(result(status(pinnedOld), 1).channels, "homebrew");
  expect(tap).toMatchObject({ state: "missing" });
  tapHolds(pinnedOld.w, "owner/homebrew-tap", "Formula/app.rb", formula("v1.0.1", "1.0.0"));
  const stated = channelOf(result(status(pinnedOld), 1).channels, "homebrew");
  expect(stated).toMatchObject({ state: "missing" });

  const down = shippedRepo();
  registryFails(down.w);
  const report = result(status(down), 1);
  expect(channelOf(report.channels, "npm")).toMatchObject({ state: "unreadable" });
  expect(String(channelOf(report.channels, "npm").detail)).toContain("503");
  expect(channelOf(report.channels, "github-release")).toMatchObject({ state: "served" });

  const shipped = shippedRepo();
  expect(refusal(status(shipped, "v9.9.9")).code).toBe("tag_missing");
  expect(usageCodeOf(status(shipped, "nope"))).toBe("bad_arguments");
});

test("AC-22 status waits on the runs the tag started, up to 60 minutes", () => {
  const both = {
    ".github/workflows/release.yml": RELEASE_YML,
    ".github/workflows/check.yml": CHECK_YML,
    ".github/workflows/negated.yml": NEGATED_YML,
  };

  const settled = shippedRepo(both);
  ghAnswers(settled.w, {
    runs: { "release.yml": [RUNNING, RUNNING, PASSED] },
    releases: [{ tagName: "v1.0.1", isDraft: false, assets: ASSETS }],
  });
  const passed = result(status(settled));
  expect(runsOf(passed.runs)).toEqual([{ workflow: "release.yml", state: "passed", conclusion: null }]);
  const listed = ghCalls(settled.w).filter(([group, verb]) => group === "run" && verb === "list");
  expect(listed).toHaveLength(3);
  expect(listed.every((call) => call.includes("release.yml"))).toBe(true);

  const broken = shippedRepo(both);
  ghAnswers(broken.w, {
    runs: { "release.yml": [RUNNING, [{ status: "completed", conclusion: "failure" }]] },
    releases: [{ tagName: "v1.0.1", isDraft: false, assets: ASSETS }],
  });
  expect(runsOf(result(status(broken), 1).runs)).toEqual([
    { workflow: "release.yml", state: "failed", conclusion: "failure" },
  ]);

  const stuck = shippedRepo(both);
  ghAnswers(stuck.w, {
    runs: { "release.yml": [RUNNING] },
    releases: [{ tagName: "v1.0.1", isDraft: false, assets: ASSETS }],
  });
  expect(runsOf(result(status(stuck), 1).runs)).toEqual([
    { workflow: "release.yml", state: "running", conclusion: null },
  ]);
  const polls = ghCalls(stuck.w).filter(([group, verb]) => group === "run" && verb === "list");
  expect(polls).toHaveLength(121);

  const absent = shippedRepo(both);
  ghAnswers(absent.w, { runs: {}, releases: [{ tagName: "v1.0.1", isDraft: false, assets: ASSETS }] });
  expect(runsOf(result(status(absent), 1).runs)).toEqual([
    { workflow: "release.yml", state: "missing", conclusion: null },
  ]);
});

test("AC-29 the suite's home is scratch, and every gh and registry call reaches a stand-in that records it", () => {
  const shipped = shippedRepo();
  result(status(shipped));
  expect(shipped.w.env.HOME).not.toBe(userInfo().homedir);
  for (const variable of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"])
    expect(String(shipped.w.env[variable])).toStartWith(shipped.w.root);
  expect(registryRequests(shipped.w)).toEqual(["GET /app", "GET /@owner%2fapp-core"]);
  const groups = ghCalls(shipped.w).map(([group, verb]) => `${group} ${verb}`);
  expect(groups.toSorted()).toEqual(["api --paginate", "api -H", "run list"]);
});
