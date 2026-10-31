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
        "  commands[5]{name,usage,summary}:",
        '    check,"agent-ship check [<app>]","judge whether HEAD is ready to release, changing nothing"',
        '    release,"agent-ship release [<patch|minor|major|<version>>] [<app>] [--dry-run]","bump the version, commit and tag the release, and print the push command"',
        '    status,agent-ship status <tag>,"wait on the runs the tag started, then say whether each channel serves its version"',
        '    doctor,agent-ship doctor,"check git, gh and each credential the channels need, with the fix for each that fails"',
        '    notice,agent-ship notice <program> <owner>/<repo>,"print a note when a newer release of the program on PATH is out, and nothing otherwise"',
        "  flags[2]{name,usage,summary}:",
        '    "--help",agent-ship --help,list the commands and flags',
        '    "--version",agent-ship --version,print the version alone on one line',
        "",
      ].join("\n"),
      stderr: "",
    });
  });
});
