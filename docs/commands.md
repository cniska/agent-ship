# Commands

The `agent-ship` commands, their output and refusals, and the `ship.toml` they read. [`SPEC.md`](../SPEC.md) states what must hold; the CLI prints only its command listing until the commands are built.

Each command prints [TOON](https://toonformat.dev): a result on stdout, or an error on stderr naming the act that resolves it, each beside the command's name and `ok`.

| Command | Does |
| --- | --- |
| `agent-ship check [<app>]` | Judge whether HEAD can be released, refusing with the first failing condition in [Errors](#errors); print the app, the version, the tag, the previous tag and the number of commits since it; change nothing |
| `agent-ship cut <patch\|minor\|major\|<version>> [<app>]` | Write the new version, run `check` on it, commit it alone as `chore: release <tag>`, create the annotated tag, and print the command that pushes the branch and the tag; never push |
| `agent-ship status <tag>` | Report each channel of the tag's app as `served`, `missing`, or `unreadable` with the reason; exit 1 when one is not `served` |
| `agent-ship doctor` | Report git and `gh` on `PATH`, and each credential the channels name, with the channels that read it, whether it is present and its source; each check `ok`, `warn` or `fail` with its fix; exit 1 when one fails |
| `agent-ship`, `agent-ship --help` | List each command and flag with its usage and summary |
| `agent-ship --version` | Print the version alone on one line, not as TOON |

## Errors

An error carries `kind`, `code`, `message`, `meta` and `resolve`. The exit is 1 for a refusal, 2 for a usage error and 3 for a fault.

| Code | Refused when |
| --- | --- |
| `unknown_command` | The command is not one of the above; a usage error |
| `wrong_arity` | `--help` or `--version` is given an argument; a usage error |
| `bad_arguments` | An argument is missing, empty, extra or unknown, `cut` is given other than `patch`, `minor`, `major` or `x.y.z`, an app is missing, unknown or given where there are none, or a tag matches no tag pattern; a usage error |
| `not_a_checkout` | The command runs outside a git checkout |
| `config_missing` | The checkout has no `ship.toml` |
| `config_invalid` | `ship.toml` is not TOML, lacks a key, holds an unknown key or channel kind, or the version is not `x.y.z` |
| `secret_in_config` | A `ship.toml` value has the form of a GitHub token, an npm token or a private key |
| `dirty_tree` | A tracked file changed, or a file git does not ignore is untracked |
| `not_on_release_branch` | HEAD is not on the release branch |
| `unpushed_commits` | HEAD is not origin's commit of the release branch |
| `version_not_newer` | The version is not newer than the latest tag, the tag with the highest version matching the tag pattern, the version's own aside; `resolve` names `cut` |
| `no_commits_since_tag` | HEAD is the latest tag's commit |
| `tag_mismatch` | A release tag at HEAD is not the version's own tag |
| `tag_unsigned` | The version's tag is lightweight, or unsigned when `ship.toml` says tags are signed |
| `tag_not_at_head` | The version's tag points at another commit |
| `missing_credential` | A credential a channel names is not present |
| `check_failed` | The project's check command exits non-zero |
| `cut_failed` | `cut`'s commit or tag fails, naming the step and git's message |
| `tag_missing` | `status` names a tag the repository does not hold |

Where more than one error applies, a command reports only the first in the table's order, except that `bad_arguments` for an app or a tag, judged against `ship.toml`, comes after `secret_in_config`.

## ship.toml

`ship.toml` sits at the root of the checkout. It holds names and settings, never a secret, and an unknown key is refused.

```toml
version = "package.json"
tag = "v<version>"
branch = "main"
check = "bun run check"
signed = false

[channels.github-release]
build = "scripts/build.sh"
files = ["dist/app-darwin-arm64.tar.gz", "dist/app-linux-x64.tar.gz"]

[channels.npm]
packages = ["@scope/app"]
smoke = "app --version"

[channels.homebrew]
tap = "owner/homebrew-tap"
formula = "Formula/app.rb"
credentials = ["TAP_DISPATCH_TOKEN"]
```

| Key | Holds |
| --- | --- |
| `version` | The `package.json` whose `version` field is the version |
| `tag` | `v<version>`, or `<app>-v<version>` under `[apps]` |
| `branch` | The release branch |
| `check` | The project's check command, run by `check` and `cut` |
| `signed` | Whether release tags are signed |
| `channels.<kind>` | One table per channel: `github-release`, `npm` or `homebrew` |
| `channels.<kind>.credentials` | The names of the variables holding the credentials the channel reads |
| `channels.<kind>.file-credentials` | The names of variables whose values are paths to credential files |
| `channels.github-release.build`, `.files` | The command that builds the release files, and the files it attaches |
| `channels.npm.packages`, `.smoke` | The packages it publishes, and the command run against the installed version |
| `channels.homebrew.tap`, `.formula` | The tap repository dispatched to repin, and its formula |

A repository of several apps puts `version`, `tag`, `check` and `channels` under `[apps.<app>]`, and each command that takes `[<app>]` then needs the app's name.

## Credentials

A credential is present when the environment sets it, else when `.env` at the checkout's root sets it, else when origin on GitHub holds an Actions secret of that name, as `gh secret list` reports it. `doctor` names the source of each: `environment`, `.env`, `actions-secret`, or the path of a file credential. No command prints a credential's value.
