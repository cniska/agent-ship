# agent-ship

Checks, cuts and ships a release to every channel a project ships to. [`src/README.md`](src/README.md) maps the modules and the boundaries between them.

## Rules

- `bun run check` is the check: lint and format (oxlint, oxfmt, actionlint), typecheck, knip (unused exports, files and dependencies) and tests. It passes before every commit.
- The tests call the domain in process against scratch directories and throwaway git repos, and assert on return values and refusal codes. Among them only `src/cli.test.ts` spawns the CLI, and it pins only the wiring: the listing, exit codes and the output format. Fixtures copy a format, never real data.
- Tests never touch the real machine: `src/test-env.ts`, which `bunfig.toml` preloads, clears inherited git state and moves `HOME` and the XDG directories to a scratch home. A test makes a scratch directory only through `scratchDir()` in `src/repo.test-support.ts`, or `world()` in `acceptance/harness.ts`; `scripts/scratch-dir.test.ts`, in the check, refuses any other `mkdtemp`.
- A refusal is a coded error that names what was refused, its cause and the act that resolves it, and a rerun after that act converges. State is read from the filesystem, git and the channels on every command, never remembered.
- No test waits real time: the clock is passed in from the entry, and a test of a child process's time limit passes in a limit of milliseconds.
- Fix the cause, never work around it, and add no debt. Debt you find is fixed where it is found.
- Code carries no comments, tool contracts aside. `.githooks/pre-commit.d/no-comments` refuses a comment a commit adds. A why goes into a name, a test, or the README or the doc under `docs/` that owns it.
- Work each task on a topic branch in its own worktree. Commit each slice there once `bun run check` passes and a fresh reviewer accepts it, and push the branch after each. `.githooks/commit-msg` judges the message: one Conventional Commit subject, ASCII, at most 50 characters, and no body.
- Land a task as a whole, with no pull request: once a fresh reviewer, given the branch's whole diff against `main`, accepts it (for a one-commit branch, that commit's accept), fast-forward `main` to the branch, push `main` and delete the branch on origin. That accept is the owner's standing sign-off, so no landing waits on them.
