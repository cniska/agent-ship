import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDirs: string[] = [];

export function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-ship-")));
  scratchDirs.push(dir);
  return dir;
}

export function removeScratchDirs(): void {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}
