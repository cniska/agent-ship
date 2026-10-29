# Development

Setup, checks and rules, for working on this repo.

## Setup

agent-ship runs on [Bun](https://bun.sh), which [mise](https://mise.jdx.dev) installs for it, with Node, actionlint and shellcheck. With mise installed:

```bash
git clone https://github.com/cniska/agent-ship.git
cd agent-ship
mise trust && mise install
```

- `mise install` installs the tools and dependencies; its `bun install` runs `prepare`, which points `core.hooksPath` at `.githooks/`.
- In the clone only, never a worktree, it links `agent-ship` into `~/.bun/bin`, so removing a worktree never strands the command.
- Add `~/.bun/bin` to your `PATH` if it is not there.
- `.worktree-hooks/setup` sets up a task worktree the same way, without linking the CLI.
- `.githooks/` holds the commit-subject, format and no-comments gates, and runs `bun run check` before each commit.

## Checks

- `bun run check` runs lint and format (oxlint, oxfmt and actionlint), typecheck, knip and the tests.
- actionlint checks each workflow's `run` scripts with shellcheck when shellcheck is on `PATH`, as mise puts it.
- `.github/actionlint.yaml` ignores, in `release.yml` only, the `job.workflow_repository` and `job.workflow_sha` properties: GitHub documents them, and actionlint does not know them yet.
- `bun run format` formats the sources with oxfmt.
- `bun run acceptance` runs the acceptance suite. Each acceptance test gets 20 seconds rather than Bun's default 5, since one drives git and the CLI many times.
- `src/spec.test.ts`, in the check, ties [`SPEC.md`](../SPEC.md) to the acceptance suite: every requirement is cited by a criterion, and every criterion has a test whose name starts with its id, except those it lists as not built yet. A criterion's test lands in the same commit that drops it from that list.

## Rules

[`AGENTS.md`](../AGENTS.md) holds the rules every change follows, [`SPEC.md`](../SPEC.md) states what must hold, and [`src/README.md`](../src/README.md) maps the modules.
