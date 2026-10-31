import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS } from "../src/cli-commands";
import { removeScratchDirs, scratchDir } from "../src/repo.test-support";

const PLUGIN = join(import.meta.dir, "..", "plugin");

const HOOK = join(PLUGIN, "hooks", "session-start.sh");

const NOTE = readFileSync(join(PLUGIN, "hooks", "note.md"), "utf8");

const SYSTEM_PATH = "/usr/bin:/bin";

const NAMED_COMMAND = /`agent-ship ([^`]+)`/g;

afterEach(removeScratchDirs);

function stubAgentShip(noticeBody: string): string {
  const bin = join(scratchDir(), "bin");
  mkdirSync(bin);
  const program = join(bin, "agent-ship");
  writeFileSync(
    program,
    [
      "#!/bin/sh",
      'case "$1" in',
      "  --version) echo 1.0.0 ;;",
      `  notice) ${noticeBody} ;;`,
      "  *) exit 2 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(program, 0o755);
  return bin;
}

function hook(path: string) {
  const ran = spawnSync(HOOK, [], { encoding: "utf8", env: { PATH: path }, input: "{}" });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

describe("the cniska-ship plugin", () => {
  test("registers its session-start hook for every session start", () => {
    expect(JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8"))).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume|clear|compact",
            hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/hooks/session-start.sh' }],
          },
        ],
      },
    });
    expect(JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"))).toMatchObject({
      name: "cniska-ship",
    });
  });

  test("maps the ship steps only to check, release, release --dry-run and status <tag>", () => {
    const named = new Set([...NOTE.matchAll(NAMED_COMMAND)].map(([, command = ""]) => command));
    expect([...named].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "--help",
      "check",
      "release",
      "release --dry-run",
      "status <tag>",
    ]);
    const listed = new Set(COMMANDS.map(({ name }) => name));
    for (const command of named)
      if (command !== "--help") expect(listed.has(command.split(" ")[0] ?? "")).toBe(true);
    for (const word of ["publish", "testflight", "play", "developer-id"]) expect(NOTE).not.toContain(word);
  });

  test("prints the note and agent-ship's own update notice", () => {
    const bin = stubAgentShip('echo "upgrade $2 from $3"');
    expect(hook(`${bin}:${SYSTEM_PATH}`)).toEqual({
      status: 0,
      stdout: `${NOTE}\nupgrade agent-ship from cniska/agent-ship\n`,
      stderr: "",
    });
  });

  test("prints only the note when no newer agent-ship is out, or when agent-ship has no notice", () => {
    for (const body of ["exit 0", "echo bad_arguments >&2; exit 2"])
      expect(hook(`${stubAgentShip(body)}:${SYSTEM_PATH}`)).toEqual({ status: 0, stdout: NOTE, stderr: "" });
  });

  test("prints nothing without agent-ship on PATH", () => {
    expect(hook(SYSTEM_PATH)).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});
