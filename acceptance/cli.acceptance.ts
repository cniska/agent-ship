import { afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { decode } from "@toon-format/toon";
import { version } from "../package.json";
import {
  failure,
  releasedRepo,
  removeScratchDirs,
  result,
  run,
  shownList,
  TOKEN_ENV,
  write,
} from "./harness";

afterEach(removeScratchDirs);

test("AC-27 no command and --help list the commands and flags, --version prints the version, and either with an argument is wrong_arity", () => {
  const { w, dir } = releasedRepo();
  for (const args of [[], ["--help"]]) {
    const ran = run(w, dir, args);
    expect(ran.stdout.startsWith("command: agent-ship\n")).toBe(true);
    const listing = result(ran);
    const commands = shownList(listing.commands);
    expect(commands.map(({ name }) => name)).toEqual(["check", "release", "status", "doctor"]);
    expect(shownList(listing.flags).map(({ name }) => name)).toEqual(["--help", "--version"]);
    for (const entry of [...commands, ...shownList(listing.flags)]) {
      expect(String(entry.usage)).toStartWith("agent-ship ");
      expect(String(entry.summary)).not.toBe("");
    }
  }
  const printed = run(w, dir, ["--version"]);
  expect(printed).toEqual({ exitCode: 0, stdout: `${version}\n`, stderr: "" });
  for (const flag of ["--help", "--version"])
    expect(failure(run(w, dir, [flag, "now"]), 2).code).toBe("wrong_arity");
});

test("AC-28 a usage error, a refusal and a result each print TOON on their own stream with their own exit", () => {
  const { w, dir } = releasedRepo();
  const outside = join(w.root, "outside");
  mkdirSync(outside);
  const usages = [
    { args: ["frobnicate"], code: "unknown_command" },
    { args: ["status"], code: "bad_arguments" },
    { args: ["check", "a", "b"], code: "bad_arguments" },
  ];
  for (const { args, code } of usages)
    for (const cwd of [dir, outside]) {
      const error = failure(run(w, cwd, args), 2);
      expect(error.code).toBe(code);
      expect(error.kind).toBe("usage");
      expect(String(error.resolve)).toStartWith("agent-ship ");
    }

  write(dir, "untracked.txt", "x\n");
  const refused = run(w, dir, ["check"], TOKEN_ENV);
  expect(failure(refused, 1).code).toBe("dirty_tree");
  expect(decode(refused.stderr)).toMatchObject({ command: "check", ok: false });

  const clean = releasedRepo();
  const passed = run(clean.w, clean.dir, ["check"], TOKEN_ENV);
  expect(result(passed).version).toBe("1.0.1");
  expect(decode(passed.stdout)).toMatchObject({ command: "check", ok: true });
  expect(passed.stderr).toBe("");
});
