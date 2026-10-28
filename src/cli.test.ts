import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { removeScratchDirs, scratchDir } from "./repo.test-support";

const CLI = resolve(import.meta.dir, "cli.ts");

const cwd = scratchDir();

afterAll(removeScratchDirs);

function cli(...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("the cli", () => {
  test("prints the command and flag listing as TOON naming the program, exit 0", () => {
    expect(cli()).toEqual({
      status: 0,
      stdout: [
        "command: agent-ship",
        "ok: true",
        "result:",
        "  commands[1]{name,usage,summary}:",
        '    check,"agent-ship check [<app>]","judge whether HEAD is ready to release, changing nothing"',
        "  flags[2]{name,usage,summary}:",
        '    "--help",agent-ship --help,list the commands and flags',
        '    "--version",agent-ship --version,print the version alone on one line',
        "",
      ].join("\n"),
      stderr: "",
    });
  });
});
