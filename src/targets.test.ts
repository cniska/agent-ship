import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recordOf } from "./coded-error";
import { removeScratchDirs, scratchDir } from "./repo.test-support";
import { mergeTargets, targetInputs } from "./targets";

afterEach(removeScratchDirs);

const FILES = ["dist/app-darwin-arm64.tar.gz", "dist/app-linux-x64.tar.gz", "dist/install.sh"];

function made(targets: string, target: string, file: string, bytes: string): void {
  const path = join(targets, target, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function world() {
  return { root: scratchDir(), targets: scratchDir() };
}

function refusal(root: string, targets: string) {
  try {
    mergeTargets(root, { targets, files: FILES });
  } catch (error) {
    return recordOf(error);
  }
  throw new Error("the merge was not refused");
}

describe("mergeTargets", () => {
  test("puts each file a target made at its path in the checkout, and names the targets that made it", () => {
    const { root, targets } = world();
    made(targets, "darwin-arm64", "dist/app-darwin-arm64.tar.gz", "mac");
    made(targets, "linux-x64", "dist/app-linux-x64.tar.gz", "linux");
    made(targets, "darwin-arm64", "dist/install.sh", "same");
    made(targets, "linux-x64", "dist/install.sh", "same");

    const merged = mergeTargets(root, { targets, files: FILES });

    expect(merged).toEqual([
      { file: "dist/app-darwin-arm64.tar.gz", targets: ["darwin-arm64"] },
      { file: "dist/app-linux-x64.tar.gz", targets: ["linux-x64"] },
      { file: "dist/install.sh", targets: ["darwin-arm64", "linux-x64"] },
    ]);
    expect(readFileSync(join(root, "dist/app-darwin-arm64.tar.gz"), "utf8")).toBe("mac");
    expect(readFileSync(join(root, "dist/app-linux-x64.tar.gz"), "utf8")).toBe("linux");
    expect(readFileSync(join(root, "dist/install.sh"), "utf8")).toBe("same");
  });

  test("leaves a file no target made for the assemble step, and lists it with no target", () => {
    const { root, targets } = world();
    made(targets, "linux-x64", "dist/app-linux-x64.tar.gz", "linux");
    mkdirSync(join(targets, "darwin-arm64"));

    const merged = mergeTargets(root, { targets, files: FILES });

    expect(merged).toContainEqual({ file: "dist/install.sh", targets: [] });
    expect(existsSync(join(root, "dist/install.sh"))).toBe(false);
  });

  test("refuses target_files_conflict when two targets made one file with different bytes, and writes no file", () => {
    const { root, targets } = world();
    made(targets, "darwin-arm64", "dist/app-darwin-arm64.tar.gz", "mac");
    made(targets, "darwin-arm64", "dist/install.sh", "one");
    made(targets, "linux-x64", "dist/install.sh", "two");

    const refused = refusal(root, targets);

    expect(refused.code).toBe("target_files_conflict");
    expect(refused.meta).toEqual({ file: "dist/install.sh", targets: ["darwin-arm64", "linux-x64"] });
    expect(existsSync(join(root, "dist"))).toBe(false);
  });
});

describe("targetInputs", () => {
  test("reads the targets' directory and the channel's files, one per line", () => {
    expect(targetInputs({ TARGETS: "/t", FILES: "dist/a\ndist/b\n" })).toEqual({
      targets: "/t",
      files: ["dist/a", "dist/b"],
    });
  });

  test("faults workflow_input_invalid naming a variable that is not set", () => {
    try {
      targetInputs({ FILES: "dist/a" });
    } catch (error) {
      expect(recordOf(error)).toMatchObject({
        code: "workflow_input_invalid",
        meta: { variable: "TARGETS" },
      });
      return;
    }
    throw new Error("the inputs were read");
  });
});
