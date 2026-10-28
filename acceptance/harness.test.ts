import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bareRemote,
  binWith,
  commit,
  deniedNetwork,
  emptyRepo,
  ghAnswers,
  ghCalls,
  git,
  removeScratchDirs,
  tapHolds,
  type World,
  world,
} from "./harness";

afterEach(removeScratchDirs);

function executable(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

function shimDir(root: string, tool: string): string {
  const launcher = executable(join(root, "launcher"), "mise");
  const shims = join(root, "shims");
  mkdirSync(shims);
  symlinkSync(launcher, join(shims, tool));
  return shims;
}

function gh(w: World, args: readonly string[]) {
  const ran = spawnSync(join(w.bin, "gh"), [...args], { encoding: "utf8", env: w.env });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function exitOf(command: readonly string[]): Promise<number> {
  return Bun.spawn([...command], { stdout: "ignore", stderr: "ignore" }).exited;
}

describe("binWith links each program past launcher shims", () => {
  test("links the first executable whose target is not a file named mise", () => {
    const w = world();
    const shims = shimDir(w.root, "jq");
    const real = executable(join(w.root, "real"), "jq");
    const bin = binWith(w.root, ["jq"], "other", `${shims}:${join(w.root, "real")}`);
    expect(readlinkSync(join(bin, "jq"))).toBe(real);
  });

  test("refuses a program whose only hit is a shim", () => {
    const w = world();
    const shims = shimDir(w.root, "jq");
    expect(() => binWith(w.root, ["jq"], "other", shims)).toThrow("jq is not on PATH");
  });
});

describe("each world is its own machine", () => {
  test("gives a world its own home and XDG directories under its root", () => {
    const w = world();
    for (const variable of ["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"])
      expect(w.env[variable]?.startsWith(`${w.root}/`)).toBe(true);
  });

  test("puts only the world's own bin on PATH, its gh the stand-in", () => {
    const w = world();
    expect(w.env.PATH).toBe(w.bin);
    expect(gh(w, ["secret", "list", "--json", "name"]).stdout).toBe("[]\n");
  });

  test("builds a repository whose origin is a bare repository in the world holding its main", () => {
    const w = world();
    const dir = emptyRepo(w);
    commit(w, dir, "chore: start", { "a.txt": "a\n" });
    const origin = bareRemote(w, dir);
    expect(origin.startsWith(`${w.root}/`)).toBe(true);
    expect(git(w, origin, ["rev-parse", "main"])).toBe(git(w, dir, ["rev-parse", "HEAD"]));
  });
});

describe("the gh stand-in answers and records", () => {
  test("records every call, answers from its state in turn, and refuses what it does not answer", () => {
    const w = world();
    ghAnswers(w, {
      secrets: ["A_TOKEN"],
      runs: {
        "release.yml": [
          [{ status: "in_progress", conclusion: "" }],
          [{ status: "completed", conclusion: "success" }],
        ],
      },
      releases: [{ tagName: "v1.0.0", isDraft: false, assets: ["app.tgz"] }],
    });
    tapHolds(w, "owner/tap", "Formula/app.rb", "formula\n");
    const runList = ["run", "list", "--workflow", "release.yml", "--json", "status"];
    const running = [{ databaseId: 1, status: "in_progress", conclusion: "" }];
    const passed = [{ databaseId: 1, status: "completed", conclusion: "success" }];
    expect(JSON.parse(gh(w, ["secret", "list", "--json", "name"]).stdout)).toEqual([{ name: "A_TOKEN" }]);
    expect(JSON.parse(gh(w, runList).stdout)).toEqual(running);
    expect(JSON.parse(gh(w, runList).stdout)).toEqual(passed);
    expect(JSON.parse(gh(w, runList).stdout)).toEqual(passed);
    expect(JSON.parse(gh(w, ["release", "view", "v1.0.0", "--json", "isDraft,assets"]).stdout)).toEqual({
      isDraft: false,
      assets: [{ name: "app.tgz" }],
    });
    expect(gh(w, ["release", "view", "v2.0.0"]).status).toBe(1);
    expect(gh(w, ["api", "repos/owner/tap/contents/Formula/app.rb"]).stdout).toBe("formula\n");
    expect(gh(w, ["api", "repos/owner/tap/contents/Formula/other.rb"]).status).toBe(1);
    expect(gh(w, ["auth", "status"]).status).toBe(1);
    expect(ghCalls(w)).toHaveLength(9);
    expect(ghCalls(w).at(-1)).toEqual(["auth", "status"]);
  });
});

describe("the CLI under test reaches no network", () => {
  test.if(process.platform === "linux")(
    "a program run as the CLI is run reaches no address outside it",
    async () => {
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reached") });
      const fetched = `await fetch("http://127.0.0.1:${server.port}/")`;
      try {
        expect(await exitOf([process.execPath, "-e", fetched])).toBe(0);
        expect(await exitOf(deniedNetwork([process.execPath, "-e", fetched]))).not.toBe(0);
        expect(await exitOf(deniedNetwork([process.execPath, "-e", "process.exit(0)"]))).toBe(0);
      } finally {
        await server.stop(true);
      }
    },
  );
});
