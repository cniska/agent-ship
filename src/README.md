# src/

Flat, so a module is found by name. A file's prefix is its module: `cli-output.ts` would belong to `cli`. A module that is one file carries its bare name. A test sits beside its module as `<module>.test.ts`; a file several tests share is `<name>.test-support.ts`, and `test-env.ts` is the environment `bunfig.toml` preloads for every test.

Another module reaches a module only through its bare-named file, so a module's parts are its own and no module imports the entry. Only the entry reads the environment; it passes what the rest needs. Only `exec` starts a process; among the tests, only `cli.test.ts`, which holds the one CLI runner, and the repo fixtures do. A module makes no error but a `CodedError`, and every `switch` ends in a `default` that calls `unreachable`. [`modules.test.ts`](modules.test.ts) holds each of these, and reads the table below for the modules.

## Modules

| Prefix        | Responsibility                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `cli`         | The `agent-ship` command line                                                                          |
| `coded-error` | The `CodedError` every module throws, and the exit status each kind maps to                            |
| `assert`      | `unreachable`, the end of every `switch`                                                               |
| `exec`        | Starting a program and collecting what it printed                                                      |
| `output`      | The TOON result or error an entry prints, and the exit it takes                                        |
| `version`     | Versions, levels, bumps and the tags that carry them                                                   |
| `table`       | The guard for a parsed value that is a table of keys                                                   |
| `glob`        | Matching a path against `*` and `**` globs                                                             |
| `config`      | Reading and validating `ship.toml`, and reading and writing the version file it names                  |
| `git`         | The git reads and writes the commands make                                                             |
| `gh`          | Calling `gh` and reading its JSON                                                                      |
| `credentials` | Which credentials the channels need and where each is found                                            |
| `bump`        | The level each commit since the previous tag warrants                                                  |
| `project`     | The checkout, its config and the app a command acts on                                                 |
| `judge`       | The facts about HEAD and the refusals that keep it from releasing                                      |
| `check`       | The `check` command's verdict                                                                          |
| `release`     | The `release` command: the new version, its commit and tag, or the dry run                             |
| `workflows`   | The workflows in `.github/workflows` that a push of a tag runs                                         |
| `channels`    | Whether each channel serves a version: the GitHub release, npm and the Homebrew tap                    |
| `inputs`      | The variables the release workflow passes its scripts, each required                                   |
| `plan`        | The release workflow's plan: the tag and credentials checked, and each channel to publish or skip      |
| `publish`     | The release workflow's GitHub release: a draft with every file, or the files a published release lacks |
| `status`      | The `status` command: the tag's workflow runs, waited on, and each channel's state                     |
| `doctor`      | The `doctor` command: git and `gh` on `PATH`, and each credential the channels name                    |

## Where to start

- `cli.ts` lists the commands.
- `test-env.ts` and `repo.test-support.ts` keep the tests off the real machine, as [`../AGENTS.md`](../AGENTS.md) says.
- `spec.test.ts` holds the check that ties a spec's criteria to an acceptance suite; `syntax.test-support.ts` walks a source file's syntax for it and for `modules.test.ts`.
