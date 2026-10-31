# Commands

The `agent-ship` commands, their output and refusals, and the `ship.toml` they read. [`SPEC.md`](../SPEC.md) states what must hold.

Each command prints [TOON](https://toonformat.dev): a result on stdout, or an error on stderr naming the act that resolves it, each beside the command's name and `ok`. `notice` prints its note as plain text instead, and its usage errors as TOON.

| Command | Does |
| --- | --- |
| `agent-ship check [<app>]` | Judge whether HEAD can be released, refusing with the first failing condition in [Errors](#errors); print the app, the version, the tag, the previous tag, the number of commits since it, the [bump](#the-bump) with the commits that decide it, and a [warning](#warnings) for each `TODO` or `FIXME` comment; change nothing |
| `agent-ship release [<patch\|minor\|major\|<version>>] [<app>] [--dry-run]` | Write the new version, by the bump when no level or version is given, run `check` on it, commit it alone as `chore: release <tag>`, create the annotated tag, and print the command that pushes the branch and the tag; never push |
| `agent-ship release --dry-run` | Refuse as `release` would, without running the project's check command, or print the version, the tag, the commit's subject and the push command; change nothing |
| `agent-ship status <tag>` | Wait up to 60 minutes for a finished run of each workflow the tag's push triggers, and report each run `passed`, `failed`, `running` or `missing`; report each channel of the tag's app as `served`, `missing`, or `unreadable` with the reason; exit 1 when a run is not `passed` or a channel is not `served` |
| `agent-ship doctor` | Report git and `gh` on `PATH`, and each credential the channels name, with the channels that read it, whether it is present and its source; each check `ok`, `warn` or `fail` with its fix; exit 1 when one fails |
| `agent-ship notice <program> <owner>/<repo>` | Print a [note](#notice) when a newer release of the copy of `<program>` on `PATH` is out, naming the upgrade for the channel it came from, and nothing otherwise; always exit 0 but on a usage error or a fault |
| `agent-ship`, `agent-ship --help` | List each command and flag with its usage and summary |
| `agent-ship --version` | Print the version alone on one line, not as TOON |

## The bump

The bump comes from the commits since the previous tag, read as [Conventional Commits](https://www.conventionalcommits.org), and is the highest level any of them warrants. The previous tag is the tag with the highest version matching the tag pattern, other than one at HEAD.

An app that names `paths` counts only the commits that change a file they match: only those decide its bump, make up its commits since the previous tag, and keep it from `no_commits_since_tag`. An app without `paths` counts every commit.

| Commit | Warrants |
| --- | --- |
| `!` before the subject's colon, or a `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer | `major`, or `minor` below `1.0.0` |
| Type `feat`, in any case, with or without a scope | `minor` |
| Any other | `patch` |
| Changing a file a floor's `paths` match | At least the floor's `level`, a `major` floor giving `minor` below `1.0.0` |

The commits that decide the bump are those whose level is the bump's. With no previous tag the bump is `none`: `release` with no level tags the recorded version with no version commit, and a level or version given is not bounded.

Once a release is made and more commits land, the version's tag is behind HEAD. `check` then passes: it prints the version and its tag, takes that tag as the previous tag, and reports the bump the next `release` takes.

## Warnings

`check` warns on each line of a tracked file where `TODO` or `FIXME`, as a whole word, is the first word after a comment opener: `//`, `/*`, `#`, `--`, `;`, or a `*` that is the line's first non-blank character. Test files, Markdown files and the `notes` paths give no warning. A test file has a path segment `test`, `tests` or `__tests__`, or a name holding `.test.`, `.spec.` or `.acceptance.`. A warning refuses nothing.

## Status

`status <tag>` reads the workflows in `.github/workflows` at the tag's commit and waits on each one whose push trigger runs on the tag.

A push trigger runs on the tag when:

- It names no `tags`, `tags-ignore`, `branches` or `branches-ignore` filter.
- It names `tags`, and the tag matches them.
- It names `tags-ignore` and no `tags`, and the tag does not match them.

In a pattern, `*` matches within one segment and `**` across segments, and a later `!` pattern negates an earlier match. A `.yml` or `.yaml` file that does not parse as a workflow counts as running on the tag.

For each such workflow, `status` reads the latest run that the tag's push started, every 30 seconds, until each has finished or 60 minutes have passed.

Then it reads each channel of the tag's app:

| Channel | Served when |
| --- | --- |
| `github-release` | The tag has a published release, not a draft, holding a file of each name in `files` |
| `npm` | The registry lists the version for every package in `packages`; the registry is `npm_config_registry` when set, else `https://registry.npmjs.org` |
| `homebrew` | The tap's `formula` file has at least one `url`, each `url` holds `/releases/download/<tag>/`, and a `version` line, if it has one, is the version |

A channel is `unreadable` when `gh` or the registry gives no answer agent-ship can read, and `missing` otherwise.

## Notice

`notice <program> <owner>/<repo>` is for a plugin's session-start hook, as [Releasing](releasing.md#the-update-notice) shows. It reads the channel from the real path of the copy of `<program>` first on `PATH`, links followed:

| The copy is in | Channel | Newest version | Upgrade |
| --- | --- | --- | --- |
| `…/Cellar/<formula>/<version>/`, whose `INSTALL_RECEIPT.json` names its tap | Homebrew | The tag every `url` of the tap's `Formula/<formula>.rb` downloads from | `brew upgrade <tap>/<formula>` |
| `…/install/global/node_modules/<package>/` | bun | The registry's `latest` dist-tag | `bun add --global <package>@latest` |
| `…/lib/node_modules/<package>/` | npm | The registry's `latest` dist-tag | `npm install --global <package>@latest` |
| `$HOME/.local/bin`, on `darwin-arm64` or `linux-x64` | GitHub release | The tag of `<owner>/<repo>`'s latest release | Download `<program>-<platform>.tar.gz` and `SHA256SUMS.txt` with curl, check the sums, unpack and move `<program>` over the copy |

Homebrew's and the GitHub release's newest versions come from GitHub's API, at `GITHUB_API_URL` when it is set, without `gh`; the registry is `npm_config_registry` when set.

When the newest version is above the one the copy prints for `--version`, `notice` prints one paragraph: the program, both versions, the upgrade command, and the instruction to run it now, or, when the upgrade is refused as a third-party install, to hand the owner that exact command rather than retry it.

`notice` prints nothing, and exits 0, when:

- the program is not on `PATH`, or its copy is anywhere else, a checkout among them; the program is then not run
- `--version` prints no `x.y.z`, or takes more than 2 seconds
- the lookup fails: unreachable, over 2 seconds, answered with a status other than success, such as a rate limit, or answered with what it cannot read
- the copy is current

It asks the network at most once a day per program. Each lookup's time and result go to `agent-ship/notice/<program>.json` under `$XDG_CACHE_HOME`, else `~/.cache`, and `notice` answers from that record for 24 hours while it names the same channel. A failed lookup is kept with its cause, `timeout`, `unreachable`, `http_<status>` or `unparsable`, so it is not retried within the day.

## Errors

An error carries `kind`, `code`, `message`, `meta` and `resolve`. The exit is 1 for a refusal, 2 for a usage error and 3 for a fault.

| Code | Refused when |
| --- | --- |
| `no_build_for_platform` | The npm launcher runs on a platform with no platform package |
| `platform_package_missing` | The npm launcher finds no platform package installed beside it |
| `binary_failed` | The npm launcher finds a platform package whose binary is not executable |
| `unknown_command` | The command is not `check`, `release`, `status`, `doctor` or `notice`; a usage error |
| `wrong_arity` | `--help` or `--version` is given an argument; a usage error |
| `bad_arguments` | An argument is missing, empty, extra or unknown; an app is missing, unknown or given where there are none (a first argument to `release` that is neither a level nor `x.y.z` is an app); or a tag matches no tag pattern; a usage error |
| `not_a_checkout` | The command runs outside a git checkout |
| `config_missing` | The checkout has no `ship.toml` |
| `secret_in_config` | A `ship.toml` value has the form of a GitHub token, an npm token or a private key |
| `config_invalid` | `ship.toml` is not TOML, lacks a key, holds an unknown key or channel kind, a floor's level is not `minor` or `major`, the npm channel's `out` is outside the checkout, or the version is not `x.y.z` |
| `dirty_tree` | A tracked file changed, or a file git does not ignore is untracked |
| `not_on_release_branch` | HEAD is not on the release branch |
| `unpushed_commits` | HEAD is not origin's commit of the release branch, unless the commits on top of it change only files the `notes` paths match |
| `version_not_newer` | The version is not newer than the latest tag, the tag with the highest version matching the tag pattern, the version's own aside; `resolve` names `release` |
| `no_commits_since_tag` | HEAD is the latest tag's commit, or no commit the app counts follows the previous tag |
| `bump_below_commits` | `release` is given a level below the bump, or a version below the one the bump makes, naming the bump and the commits that decide it |
| `tag_mismatch` | A release tag at HEAD is not the version's own tag |
| `tag_unsigned` | The version's tag at HEAD is lightweight, or unsigned when `ship.toml` says tags are signed |
| `tag_not_at_head` | The version's tag points at a commit that is not HEAD and that HEAD does not descend from |
| `missing_credential` | A credential a channel names is not present |
| `check_failed` | The project's check command exits non-zero |
| `release_failed` | `release`'s commit or tag fails, naming the step and git's message |
| `tag_missing` | `status` names a tag the repository does not hold |

Where more than one error applies, a command reports only the first in the table's order, except that `config_invalid` for a `ship.toml` that is not TOML comes before `secret_in_config`, and `bad_arguments` for an app or a tag, judged against `ship.toml`, comes after `config_invalid`.

## ship.toml

`ship.toml` sits at the root of the checkout. It holds names and settings, never a secret, and an unknown key is refused.

```toml
version = "package.json"
tag = "v<version>"
branch = "main"
check = "bun run check"
signed = false
notes = ["CHANGELOG.md"]

[[floors]]
paths = ["src/schema/**"]
level = "minor"

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
| `check` | The project's check command, run by `check` and `release` |
| `signed` | Whether release tags are signed |
| `notes` | The changelog and store release notes, optional |
| `floors` | Bump floors, optional, each with `paths` and a `level` of `minor` or `major` |
| `paths` | Under `[apps.<app>]` only, the files whose commits count toward the app's bump, optional |
| `channels.<kind>` | One table per channel: `github-release`, `npm` or `homebrew` |
| `channels.<kind>.credentials` | The names of the variables holding the credentials the channel reads |
| `channels.<kind>.file-credentials` | The names of variables whose values are paths to credential files |
| `channels.github-release.build` | The command that builds one target's release files and smoke-tests them, run once per target with `TARGET` set, as [Targets](releasing.md#targets) says |
| `channels.github-release.files` | The files the release attaches |
| `channels.github-release.assemble` | Optional: the command run once after every target's build, making the files that span targets |
| `channels.npm.packages` | The packages it publishes, in that order |
| `channels.npm.smoke` | The command run in the checkout against each installed version, with `VERSION` set, as [What a channel needs](releasing.md#what-a-channel-needs) says |
| `channels.npm.smoke-node` | Optional, `false` by default: whether Node is on the smoke's `PATH` |
| `channels.npm.build`, `.out` | Optional, given together: the command that builds the packages, and the directory, inside the checkout, it writes them under; without them, each package is a tracked `package.json` |
| `channels.homebrew.tap`, `.formula` | The tap repository dispatched to repin, and its formula |

Each path in `notes`, `floors` and an app's `paths` is a file or a glob relative to the checkout's root, where `*` matches within one path segment and `**` across segments.

A repository of several apps puts `version`, `tag`, `check`, `channels`, `notes`, `floors` and an optional `paths` under `[apps.<app>]`, and each command that takes `[<app>]` then needs the app's name.

## Credentials

A credential is present when the environment sets it, else when `.env` at the checkout's root sets it, else when origin on GitHub holds an Actions secret of that name, as `gh secret list` reports it. `doctor` names the source of each: `environment`, `.env`, `actions-secret`, or the path of a file credential. No command prints a credential's value.
