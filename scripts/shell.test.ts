import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const SHEBANG = "#!";

const WHITESPACE = /\s+/;

const ENV = "env";

const SHELLS: ReadonlySet<string> = new Set(["sh", "bash"]);

const INTERPRETERS: ReadonlySet<string> = new Set([...SHELLS, "bun"]);

const FOREIGN_EXTENSIONS: ReadonlySet<string> = new Set([".py", ".pl", ".rb", ".php", ".lua"]);

const SHELL_EXTENSION = ".sh";

const LISTED = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];

const DELETED = ["ls-files", "-z", "--deleted"];

const RUNNER_FIXED = [".githooks/", ".worktree-hooks/"];

const MAX_SHELL_LINES = 100;

type Source = { readonly path: string; readonly text: string };

function gitPaths(args: readonly string[]): readonly string[] {
  const listed = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${listed.stderr}`);
  return listed.stdout.split("\0").filter((path) => path !== "");
}

function worktreeFiles(): readonly Source[] {
  const deleted = new Set(gitPaths(DELETED));
  return [...new Set(gitPaths(LISTED))]
    .filter((path) => !deleted.has(path))
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
}

function interpreterOf(text: string): string | null {
  if (!text.startsWith(SHEBANG)) return null;
  const words = (text.split("\n", 1)[0] ?? "").slice(SHEBANG.length).trim().split(WHITESPACE);
  const program = basename(words[0] ?? "");
  if (program !== ENV) return program;
  return words.slice(1).find((word) => !word.startsWith("-")) ?? ENV;
}

function lineCount(text: string): number {
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function languageProblems({ path, text }: Source): readonly string[] {
  if (isRunnerFixed(path)) return [];
  const interpreter = interpreterOf(text);
  const problems: string[] = [];
  if (interpreter !== null && !INTERPRETERS.has(interpreter))
    problems.push(`${path} runs on ${interpreter}, which is not among ${[...INTERPRETERS].join(", ")}`);
  if (FOREIGN_EXTENSIONS.has(extname(path)))
    problems.push(`${path} is in a language this repo does not write`);
  return problems;
}

function isShell({ path, text }: Source): boolean {
  const interpreter = interpreterOf(text);
  return extname(path) === SHELL_EXTENSION || (interpreter !== null && SHELLS.has(interpreter));
}

function isRunnerFixed(path: string): boolean {
  return RUNNER_FIXED.some((dir) => path.startsWith(dir));
}

function lengthProblems(file: Source): readonly string[] {
  if (!isShell(file) || isRunnerFixed(file.path)) return [];
  const lines = lineCount(file.text);
  return lines > MAX_SHELL_LINES
    ? [`${file.path} has ${lines} lines, over the ${MAX_SHELL_LINES} a shell file may have`]
    : [];
}

describe("the repo's own programs", () => {
  const files = worktreeFiles();

  test("run on sh, bash or bun only, outside the hooks", () => {
    expect(files.flatMap(languageProblems)).toEqual([]);
  });

  test("keep each shell file outside the hooks to 100 lines", () => {
    expect(files.flatMap(lengthProblems)).toEqual([]);
  });

  test("pass shellcheck at warning severity", () => {
    const shells = files.filter(isShell).map(({ path }) => path);
    expect(shells).toContain("scripts/release-secrets");
    expect(shells).toContain("bin/agent-ship");
    const checked = spawnSync("shellcheck", ["--severity=warning", ...shells], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(checked.error).toBeUndefined();
    expect(checked.stdout).toBe("");
    expect(checked.status).toBe(0);
  });

  test("read the interpreter from the shebang, through env and its flags", () => {
    expect(interpreterOf("#!/bin/sh\nset -eu\n")).toBe("sh");
    expect(interpreterOf("#!/usr/bin/env bash\n")).toBe("bash");
    expect(interpreterOf("#!/usr/bin/env -S perl -w\n")).toBe("perl");
    expect(interpreterOf("#! /usr/bin/ruby\n")).toBe("ruby");
    expect(interpreterOf("echo '#!/bin/sh'\n")).toBeNull();
  });

  test("refuse a foreign interpreter or extension, and a long shell file outside the hooks", () => {
    expect(languageProblems({ path: "scripts/x", text: "#!/usr/bin/env perl\n" })).toEqual([
      "scripts/x runs on perl, which is not among sh, bash, bun",
    ]);
    expect(languageProblems({ path: "scripts/x.lua", text: "print(1)\n" })).toEqual([
      "scripts/x.lua is in a language this repo does not write",
    ]);
    expect(languageProblems({ path: "scripts/x", text: "#!/usr/bin/env bun\n" })).toEqual([]);
    expect(languageProblems({ path: "scripts/x.py", text: "print(1)\n" })).toEqual([
      "scripts/x.py is in a language this repo does not write",
    ]);
    expect(languageProblems({ path: ".githooks/x", text: "#!/usr/bin/env node\n" })).toEqual([]);
    const long = `#!/bin/sh\n${"true\n".repeat(MAX_SHELL_LINES - 1)}`;
    const longer = `${long}true\n`;
    expect(lengthProblems({ path: "scripts/x", text: long })).toEqual([]);
    expect(lengthProblems({ path: "scripts/x", text: longer })).toEqual([
      "scripts/x has 101 lines, over the 100 a shell file may have",
    ]);
    expect(lengthProblems({ path: ".githooks/x", text: longer })).toEqual([]);
    expect(lengthProblems({ path: "scripts/lib.sh", text: "true\n".repeat(MAX_SHELL_LINES + 1) })).toEqual([
      "scripts/lib.sh has 101 lines, over the 100 a shell file may have",
    ]);
    expect(
      lengthProblems({ path: "scripts/x.ts", text: `#!/usr/bin/env bun\n${"1;\n".repeat(200)}` }),
    ).toEqual([]);
  });
});
