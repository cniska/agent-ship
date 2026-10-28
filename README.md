# agent-ship

> Release tooling for coding agents: check, cut and ship a release to every channel a project ships to, from one config file per repository

[![CI](https://img.shields.io/github/actions/workflow/status/cniska/agent-ship/check.yml?branch=main&style=flat&label=ci)](https://github.com/cniska/agent-ship/actions/workflows/check.yml) [![License](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)

agent-ship releases a project to its GitHub release, npm and a Homebrew tap from the project's `ship.toml`.

- `agent-ship check` judges whether HEAD is ready to release and changes nothing.
- `agent-ship release` bumps the version by what the Conventional Commits since the previous tag warrant, commits and tags it, and prints the command that pushes it; the owner pushes.
- The pushed tag runs the project's `release.yml`, which calls agent-ship's reusable workflow to publish to each channel.
- `agent-ship status <tag>` says whether each channel serves the version, and `agent-ship doctor` reports each credential the channels need and where it comes from.

The commands and the workflow are specified in [`SPEC.md`](SPEC.md) and being built; the CLI prints only its command listing so far.

## Install

agent-ship has no release yet. Run it from a checkout, with [mise](https://mise.jdx.dev) installed:

```bash
git clone https://github.com/cniska/agent-ship.git
cd agent-ship
mise trust && mise install
```

`mise install` puts `agent-ship` in `~/.bun/bin`, as [Development](docs/development.md) says.

## Why

A project that ships to a GitHub release, npm and a Homebrew tap repeats the same release flow in scripts of its own: gate the tree, bump the version, commit, tag, then build, attest, publish and repin in CI. Each copy drifts from the others. agent-ship holds the flow once, so each repository keeps only its `ship.toml` and a `release.yml` that calls the reusable workflow.

A release needs credentials on the machine and in CI. `ship.toml` names each one a channel reads and holds no secret, `doctor` reports where each one comes from without printing it, and the workflow masks each value it reads.

## Commands

| Command | Does |
| --- | --- |
| `agent-ship check [<app>]` | Judge whether HEAD is ready to release and report the bump its commits warrant, changing nothing |
| `agent-ship release [<patch\|minor\|major\|<version>>] [<app>] [--dry-run]` | Bump the version, commit and tag the release, and print the push command, or with `--dry-run` print what it would do |
| `agent-ship status <tag>` | Wait on the runs the tag started and say whether each channel serves the tag's version |
| `agent-ship doctor` | Name each credential the channels need, whether it is set, and the fix for each one missing |
| `agent-ship`, `agent-ship --help` | List the commands and flags |
| `agent-ship --version` | Print the version |

[Commands](docs/commands.md) lists every command, its output, its refusals and `ship.toml`.

## Docs

- [Commands](docs/commands.md): every command, its output and refusals, and `ship.toml`.
- [Releasing](docs/releasing.md): the reusable release workflow, how a project calls it, and the owner's setup.
- [Development](docs/development.md): setup, checks and rules, for working on this repo.
- [Contributing](CONTRIBUTING.md): how outside contributors propose a change.

## Related

agent-ship works on its own in any agent workflow, and is one of the optional add-ons to [agent-skills](https://github.com/cniska/agent-skills), engineering skills for coding agents. The other add-ons:

- [agent-task](https://github.com/cniska/agent-task): task tracking for coding agents, the tasks running, in review and waiting to run
- [agent-record](https://github.com/cniska/agent-record): a session record for coding agents, every past session queryable and joined to its commits
- [agent-gates](https://github.com/cniska/agent-gates): commit gates for coding agents, git hooks and CI checks that refuse a bad commit
- [agent-worktree](https://github.com/cniska/agent-worktree): task worktrees for coding agents, one checkout per task, set up and torn down by the project's own commands
