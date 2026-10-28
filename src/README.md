# src/

Flat, so a module is found by name. A file's prefix is its module: `cli-output.ts` would belong to `cli`. A module that is one file carries its bare name. A test sits beside its module as `<module>.test.ts`; a file several tests share is `<name>.test-support.ts`, and `test-env.ts` is the environment `bunfig.toml` preloads for every test.

Another module reaches a module only through its bare-named file, so a module's parts are its own and no module imports the entry. Only the entry reads the environment; it passes what the rest needs. No module starts a process; among the tests, only `cli.test.ts`, which holds the one CLI runner, and the repo fixtures do. A module makes no error but a `CodedError`, and every `switch` ends in a `default` that calls `unreachable`. [`modules.test.ts`](modules.test.ts) holds each of these, and reads the table below for the modules.

## Modules

| Prefix | Responsibility                |
| ------ | ----------------------------- |
| `cli`  | The `agent-ship` command line |

## Where to start

- `cli.ts` lists the commands.
- `test-env.ts` and `repo.test-support.ts` keep the tests off the real machine, as [`../AGENTS.md`](../AGENTS.md) says.
- `spec.test.ts` holds the check that ties a spec's criteria to an acceptance suite; `syntax.test-support.ts` walks a source file's syntax for it and for `modules.test.ts`.
