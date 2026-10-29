import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordOf } from "./coded-error";
import { publishFiles, publishInputs, releaseCalls } from "./publish";
import { removeScratchDirs, scratchDir } from "./repo.test-support";

afterEach(removeScratchDirs);

const FILES = ["dist/app-linux.tar.gz", "dist/SHA256SUMS.txt"];

const CREATE = [
  "release",
  "create",
  "v1.0.1",
  "--draft",
  "--verify-tag",
  "--title",
  "v1.0.1",
  "--generate-notes",
  "dist/app-linux.tar.gz",
  "dist/SHA256SUMS.txt",
];

const GH_STAND_IN = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  "api --paginate") cat "$GH_RELEASES" ;;
  "api --method") if [ -n "$GH_FAIL_DELETE" ]; then echo "HTTP 500: Server Error" >&2; exit 1; fi ;;
esac
`;

const READ = "api --paginate --slurp repos/{owner}/{repo}/releases";

function standIn(failDelete: boolean) {
  const dir = scratchDir();
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "gh"), GH_STAND_IN);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  const page = [{ id: 7, tag_name: "v1.0.1", draft: true, assets: [] }];
  writeFileSync(join(dir, "releases.json"), JSON.stringify([page]));
  writeFileSync(join(dir, "log"), "");
  const env = {
    PATH: `${join(dir, "bin")}:/bin:/usr/bin`,
    GH_LOG: join(dir, "log"),
    GH_RELEASES: join(dir, "releases.json"),
    GH_FAIL_DELETE: failDelete ? "1" : "",
  };
  return {
    gh: { root: dir, env },
    calls: () => readFileSync(join(dir, "log"), "utf8").trimEnd().split("\n"),
  };
}

function errorOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return recordOf(error);
  }
  throw new Error("nothing was thrown");
}

function release(id: number, tag: string, draft: boolean, assets: readonly string[]) {
  return { id, tag, draft, assets };
}

describe("the release files", () => {
  test("creates the tag's release as a draft with every file when it has none", () => {
    expect(releaseCalls([release(7, "v1.0.0", false, [])], "v1.0.1", FILES)).toEqual([CREATE]);
  });

  test("deletes each draft an earlier run left for the tag before creating the draft again", () => {
    const releases = [
      release(7, "v1.0.1", true, ["app-linux.tar.gz"]),
      release(8, "v1.0.0", true, []),
      release(9, "v1.0.1", true, []),
    ];
    expect(releaseCalls(releases, "v1.0.1", FILES)).toEqual([
      ["api", "--method", "DELETE", "repos/{owner}/{repo}/releases/7"],
      ["api", "--method", "DELETE", "repos/{owner}/{repo}/releases/9"],
      CREATE,
    ]);
  });

  test("attaches to a published release only the files it lacks, replacing none and deleting no draft", () => {
    const releases = [release(7, "v1.0.1", true, []), release(9, "v1.0.1", false, ["app-linux.tar.gz"])];
    expect(releaseCalls(releases, "v1.0.1", FILES)).toEqual([
      ["release", "upload", "v1.0.1", "dist/SHA256SUMS.txt"],
    ]);
  });

  test("calls nothing when the published release holds every file", () => {
    const releases = [release(9, "v1.0.1", false, ["app-linux.tar.gz", "SHA256SUMS.txt"])];
    expect(releaseCalls(releases, "v1.0.1", FILES)).toEqual([]);
  });

  test("stops before any call when the releases cannot be read", () => {
    const failed = errorOf(() =>
      publishFiles({ root: scratchDir(), env: { PATH: "/nonexistent" } }, { tag: "v1.0.1", files: FILES }),
    );
    expect(failed.code).toBe("releases_unreadable");
    expect(failed.kind).toBe("fault");
  });

  test("runs each call it planned, in order, after reading the releases", () => {
    const { gh, calls } = standIn(false);
    const ran = publishFiles(gh, { tag: "v1.0.1", files: FILES });
    expect(ran).toEqual([["api", "--method", "DELETE", "repos/{owner}/{repo}/releases/7"], CREATE]);
    expect(calls()).toEqual([
      READ,
      "api --method DELETE repos/{owner}/{repo}/releases/7",
      "release create v1.0.1 --draft --verify-tag --title v1.0.1 --generate-notes dist/app-linux.tar.gz dist/SHA256SUMS.txt",
    ]);
  });

  test("stops at the first call that fails, creating nothing after it", () => {
    const { gh, calls } = standIn(true);
    const failed = errorOf(() => publishFiles(gh, { tag: "v1.0.1", files: FILES }));
    expect(failed.code).toBe("release_call_failed");
    expect(failed.meta).toEqual({
      call: "gh api --method DELETE repos/{owner}/{repo}/releases/7",
      detail: "HTTP 500: Server Error",
    });
    expect(calls()).toEqual([READ, "api --method DELETE repos/{owner}/{repo}/releases/7"]);
  });

  test("reads the tag and the files, one per line", () => {
    expect(publishInputs({ TAG: "v1.0.1", FILES: "dist/a.tar.gz\ndist/b c.txt\n" })).toEqual({
      tag: "v1.0.1",
      files: ["dist/a.tar.gz", "dist/b c.txt"],
    });
    for (const env of [{ TAG: "v1.0.1" }, { FILES: "dist/a.tar.gz" }])
      expect(errorOf(() => publishInputs(env)).code).toBe("workflow_input_invalid");
  });
});
