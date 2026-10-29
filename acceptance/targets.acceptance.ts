import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { refusal, removeScratchDirs, result, runScript, shownList, world, write } from "./harness";

afterEach(removeScratchDirs);

const FILES = "dist/app-darwin-arm64.tar.gz\ndist/app-linux-x64.tar.gz\ndist/install.sh\n";

function targetsWith(installs: { readonly darwin: string; readonly linux: string }) {
  const w = world();
  const checkout = join(w.root, "checkout");
  const targets = join(w.root, "targets");
  mkdirSync(checkout);
  write(join(targets, "darwin-arm64"), "dist/app-darwin-arm64.tar.gz", "mac");
  write(join(targets, "darwin-arm64"), "dist/install.sh", installs.darwin);
  write(join(targets, "linux-x64"), "dist/app-linux-x64.tar.gz", "linux");
  write(join(targets, "linux-x64"), "dist/install.sh", installs.linux);
  return { w, checkout, env: { TARGETS: targets, FILES } };
}

test("AC-33 target-files puts each target's files at their paths, and refuses target_files_conflict, writing nothing, when two targets made one file with different bytes", () => {
  const same = targetsWith({ darwin: "same", linux: "same" });
  const merged = shownList(result(runScript(same.w, same.checkout, "target-files.ts", same.env)).files);
  expect(merged.map(({ file, targets }) => ({ file, targets }))).toEqual([
    { file: "dist/app-darwin-arm64.tar.gz", targets: ["darwin-arm64"] },
    { file: "dist/app-linux-x64.tar.gz", targets: ["linux-x64"] },
    { file: "dist/install.sh", targets: ["darwin-arm64", "linux-x64"] },
  ]);
  expect(readFileSync(join(same.checkout, "dist/app-darwin-arm64.tar.gz"), "utf8")).toBe("mac");
  expect(readFileSync(join(same.checkout, "dist/app-linux-x64.tar.gz"), "utf8")).toBe("linux");
  expect(readFileSync(join(same.checkout, "dist/install.sh"), "utf8")).toBe("same");

  const differ = targetsWith({ darwin: "one", linux: "two" });
  const refused = refusal(runScript(differ.w, differ.checkout, "target-files.ts", differ.env));
  expect(refused.code).toBe("target_files_conflict");
  expect(refused.meta).toEqual({ file: "dist/install.sh", targets: ["darwin-arm64", "linux-x64"] });
  expect(existsSync(join(differ.checkout, "dist"))).toBe(false);
});
