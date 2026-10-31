# agent-ship

A repository with a `ship.toml` releases through `agent-ship`. When the `ship` skill runs there, each step maps to one command:

| `ship` step | Command |
| --- | --- |
| 1. Preconditions: the branch, a clean tree, commits since the tag, the project's verification | `agent-ship check` |
| 2. `TODO` and `FIXME` | `agent-ship check`, as warnings |
| 3. The bump | `agent-ship check` reports it, and `agent-ship release` takes it, or the level given |
| 4. Report and confirm | `agent-ship release --dry-run` shows the version, the tag, the commit and the push command |
| 5. Version, commit and tag | `agent-ship release`, after any changelog is committed |
| 6. The push | `agent-ship release` prints it; the owner runs it |
| 7. Wait on the runs and the channels | `agent-ship status <tag>` |

The docs review and the check for secrets in step 1 stay with the skill. A refusal names the act that resolves it; do it rather than working around the tool. `agent-ship --help` gives every command and flag.
