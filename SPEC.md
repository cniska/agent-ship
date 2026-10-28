# agent-ship Specification

> Checks, cuts and ships a release to every channel a project ships to, from one config file per repository, for the agents and people who release it.

This document states what must hold, not how. [`README.md`](README.md) has the install and a summary of every command, [`docs/commands.md`](docs/commands.md) every command, its output and `ship.toml`, [`docs/releasing.md`](docs/releasing.md) the reusable release workflow, and [`src/README.md`](src/README.md) maps the modules that meet these requirements.

## 1. Purpose & context

A project that ships to a GitHub release, npm and a Homebrew tap repeats the same release flow in scripts of its own: gate the tree, bump the version, commit, tag, then build, attest, publish and repin in CI. agent-ship holds that flow once. `check` judges whether HEAD is ready to release, reports the bump its Conventional Commits warrant, and changes nothing; `release` bumps the version, commits and tags it, and prints the push; the owner pushes the tag; the tag runs the project's `release.yml`, which calls agent-ship's reusable workflow to publish to each channel; `status` waits on the runs the tag started and says whether each channel serves the version; and `doctor` reports each credential the channels need. Each repository keeps only its `ship.toml` and a `release.yml` that calls the reusable workflow.

**Primary user:** whoever releases a project, an agent or a person, from a checkout of it, and the CI run its tag starts. agent-ship releases itself the same way.

## 2. Functional requirements

### 2.1 ship.toml

- **FR-1** — agent-ship reads its configuration from `ship.toml` at the root of the checkout it runs in. A command that needs it is refused `not_a_checkout` outside a git checkout, and `config_missing` in a checkout without one.
- **FR-2** — `ship.toml` names the version source, the tag pattern, the release branch, the project's check command, whether tags are signed, and the channels with each one's settings, and may name notes paths and bump floors. A file that is not TOML, lacks a key it needs, holds a key agent-ship does not know, or names a channel kind it does not know, is refused `config_invalid`, naming the key and what is wrong with it.
- **FR-3** — The version source is `package.json`, and the version is its `version` field in the form `x.y.z`. A version in another form is refused `config_invalid`.
- **FR-4** — The tag pattern is `v<version>`, or `<app>-v<version>` in a repository of several apps; a release's tag is the pattern filled with its app and version.
- **FR-5** — A `ship.toml` with apps gives each app its own version source, tag pattern, check command, channels, notes paths and bump floors. A command that takes `[<app>]` acts on the app it names; with apps, a missing or unknown app is `bad_arguments`, and without apps, an app given is `bad_arguments`.
- **FR-6** — `ship.toml` holds names and settings, never a secret. A value that has the form of a GitHub token, an npm token or a private key is refused `secret_in_config`, naming its key and never the value.
- **FR-7** — The notes paths name the project's changelog and store release notes, and each bump floor names paths and a level, `minor` or `major`; a floor with another level is refused `config_invalid`. Each path is a file path or a glob relative to the checkout's root, where `*` matches within one path segment and `**` across segments.

### 2.2 Credentials

- **FR-8** — Each channel in `ship.toml` names the credentials it reads, each by the name of the variable that holds it. agent-ship reads no credential a channel does not name.
- **FR-9** — A credential is present when the environment sets it, else when the `.env` file at the checkout's root sets it, else when the origin repository on GitHub holds an Actions secret of that name. A credential the channel marks as a file is present only where its value is the path of a readable file.
- **FR-10** — `doctor` checks exactly the credentials the configured channels name, each once, and reports for each its name, the channels that read it, whether it is present, and its source: `environment`, `.env`, `actions-secret`, or the path of its file. It never prints a credential's value.
- **FR-11** — The reusable workflow masks each credential value it reads in the run's log before any step that could print it.

### 2.3 The bump

- **FR-12** — The previous tag is the tag with the highest version among those matching the tag pattern, other than a tag at HEAD. The bump is judged from the commits HEAD reaches that the previous tag does not, read as [Conventional Commits](https://www.conventionalcommits.org): a commit with `!` before its subject's colon, or with a `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer, warrants `major`, or `minor` while the version is below `1.0.0`; a commit whose type is `feat`, in any case and with or without a scope, warrants `minor`; any other commit warrants `patch`. The bump is the highest level a commit warrants.
- **FR-13** — A bump floor applies to a commit FR-12 reads that changes a file the floor's paths match, and raises that commit's level to at least the floor's, a `major` floor giving `minor` while the version is below `1.0.0`.
- **FR-14** — The commits that decide the bump are those whose level, under FR-12 and FR-13, is the bump's, each named by its short commit and its subject.
- **FR-15** — With no previous tag, no bump is computed: the bump is `none`, and no commit decides it.

### 2.4 check

- **FR-16** — `check [<app>]` judges whether HEAD can be released and changes nothing in the checkout, its refs or any channel. When none of FR-17 to FR-23 refuses it, it prints the app, the version, the tag, the previous tag (FR-12), the number of commits since it, the bump with the commits that decide it, and the warnings of FR-24.
- **FR-17** — A change to a tracked file, or an untracked file git does not ignore, is refused `dirty_tree`. HEAD not on the release branch is refused `not_on_release_branch`. HEAD other than the release branch's commit on origin, as origin reports it, is refused `unpushed_commits`, except as FR-18 says.
- **FR-18** — HEAD that descends from origin's commit of the release branch is not refused `unpushed_commits` when every commit between them changes only files the notes paths match.
- **FR-19** — The latest tag is the tag with the highest version among those matching the tag pattern, the version's own tag aside. A version not newer than the latest tag's is refused `version_not_newer`, whose `resolve` names `release`. HEAD that is the latest tag's commit is refused `no_commits_since_tag`. A repository with no such tag meets neither.
- **FR-20** — A tag at HEAD that matches the tag pattern and is not the version's own tag is refused `tag_mismatch`, naming both versions. The version's tag, where it exists, is refused `tag_unsigned` when it is lightweight, or when `ship.toml` says tags are signed and it carries no signature that verifies.
- **FR-21** — The version's tag, where it exists, pointing at a commit other than HEAD is refused `tag_not_at_head`.
- **FR-22** — A credential the configured channels name that is not present (FR-9) is refused `missing_credential`, naming the credential and the channels that read it.
- **FR-23** — The project's check command, run in the checkout, exiting other than 0 is refused `check_failed`, naming the command and its exit status.
- **FR-24** — Each line of a tracked file that holds `TODO` or `FIXME` as a whole word is a warning naming the file and the line number, and refuses nothing. Test files, Markdown files and files the notes paths match give no warning. A test file has a path segment `test`, `tests` or `__tests__`, or a name holding `.test.` or `.spec.`.

### 2.5 release

- **FR-25** — `release [<patch|minor|major|<version>>] [<app>] [--dry-run]` makes the release: it writes the new version to the version source, runs `check`'s conditions on it with that change exempt from `dirty_tree`, commits it alone as `chore: release <tag>`, creates the annotated tag, signed when `ship.toml` says so, and prints the version, the tag, the commit and the command that pushes the branch and the tag.
- **FR-26** — `patch`, `minor` and `major` raise that part of the current version and zero the parts after it. An explicit version is in the form `x.y.z`. A first argument that is neither a level nor a version in that form is the app (FR-5). A new version not newer than the latest tag's (FR-19) is refused `version_not_newer`.
- **FR-27** — With no level or version given, `release` raises the version by the bump (FR-12, FR-13).
- **FR-28** — A level below the bump, or a version below the one the bump makes, is refused `bump_below_commits`, naming the bump and the commits that decide it.
- **FR-29** — With no previous tag (FR-15), `release` with no level or version tags the recorded version at HEAD, makes no version commit, and prints HEAD as the commit; a level or version given is applied as FR-26 says, and FR-28 does not bound it.
- **FR-30** — `release` never pushes and never contacts a channel to publish: origin's refs are the same after `release` as before it.
- **FR-31** — A `release` whose commit or tag fails is refused `release_failed`, exit 1, naming the step that failed and git's message. A `release` that is refused leaves the version source, the branch and the tags as they were, so a rerun after the resolving act converges.
- **FR-32** — `release --dry-run` is refused as `release` would be, except that it does not run the project's check command; otherwise it prints the version, the tag, the commit's subject, `null` where FR-29 makes no commit, and the push command it would use. It changes nothing in the checkout, its refs, origin or any channel.

### 2.6 status

- **FR-33** — `status <tag>` reports the tag's workflow runs (FR-34), then, for each channel of the tag's app, whether it serves the tag's version: `served`, `missing`, or `unreadable` with the reason. A tag that matches no tag pattern of `ship.toml` is refused `bad_arguments`, and a tag the repository does not hold, `tag_missing`. It exits 1 when a run is not `passed` or a channel is not `served`, and 0 otherwise.
- **FR-34** — The tag's workflow runs are those of each workflow in `.github/workflows` at the tag's commit whose push trigger runs on the tag. `status` waits until each of those workflows has a finished run, for at most 60 minutes, and reports each workflow with its run's state: `passed`, `failed` with GitHub's conclusion, `running` when its run had not finished by then, or `missing` when it had no run by then.
- **FR-35** — The `github-release` channel is served when the tag has a published release, not a draft, with every file the channel names attached.
- **FR-36** — The `npm` channel is served when the registry serves each package the channel names at the version.
- **FR-37** — The `homebrew` channel is served when the tap's formula the channel names pins the version.

### 2.7 doctor

- **FR-38** — `doctor` reports its checks, each with a name, a state of `ok`, `warn` or `fail`, a detail and a fix (`null` when it passes), and exits 1 when a check fails and 0 otherwise. It reads `ship.toml` as every command does, refused as FR-1, FR-2 and FR-6 say, and checks git and `gh` on `PATH`, and each credential (FR-10); a missing credential fails, with a fix naming where to set it. It changes nothing.

### 2.8 The reusable workflow

- **FR-39** — agent-ship's `.github/workflows/release.yml` runs when another workflow calls it, and when a `v*` tag is pushed to agent-ship itself, so agent-ship releases through it. A caller passes its secrets and grants the job that publishes to npm the permission to request an OIDC token, which [`docs/releasing.md`](docs/releasing.md) shows.
- **FR-40** — On a tag that is not the release tag of the version source, the workflow refuses `tag_mismatch` and publishes nothing; with a credential a configured channel names missing, it refuses `missing_credential` and publishes nothing.
- **FR-41** — The `github-release` channel builds the files the channel names, attests the build provenance of each, creates the tag's release as a draft with every file attached, and publishes it only once every file is attached.
- **FR-42** — The `npm` channel publishes each package the channel names with provenance, through npm's trusted publishing and with no npm token, then installs the published version from the registry and runs the channel's smoke command against it.
- **FR-43** — The `homebrew` channel, once the tag's release is published, dispatches the tap named in the channel to repin its formula to the version.
- **FR-44** — A channel that already serves the version (FR-35 to FR-37) is skipped, so a rerun of the workflow on the same tag publishes nothing twice and reaches each channel still missing.

### 2.9 Output and the version

- **FR-45** — No command, and `--help`, print the result whose `command` is `agent-ship` and whose `result` holds `commands` and `flags`, each entry with its name, usage and summary, and exit 0. `--version` prints the version alone on one line and exits 0. `--help` or `--version` with an argument is `wrong_arity`.
- **FR-46** — A result is [TOON](https://toonformat.dev) on stdout, the object of `command`, the command's name, `ok`, true, and `result`, its value, with exit 0, except that `status` and `doctor` exit 1 as FR-33 and FR-38 say. An error is TOON on stderr, the object of `command`, `ok`, false, and `error`, with its `kind`, `code`, `message`, `meta` and `resolve`, where `resolve` names the act that resolves it; the exit is 1 for a refusal, 2 for a usage error and 3 for a fault.
- **FR-47** — An unknown command is the usage error `unknown_command`; a command given a missing, empty, extra or unknown argument is `bad_arguments`.
- **FR-48** — Where more than one error applies, a command reports only the first in this order: the usage errors judged from the arguments alone, `unknown_command`, `wrong_arity` and `bad_arguments`; then `not_a_checkout`, `config_missing`, `config_invalid` and `secret_in_config`; then `bad_arguments` judged against `ship.toml`, for an app (FR-5) or a tag (FR-33); then `dirty_tree`, `not_on_release_branch`, `unpushed_commits`, `version_not_newer`, `no_commits_since_tag`, `bump_below_commits`, `tag_mismatch`, `tag_unsigned`, `tag_not_at_head`, `missing_credential` and `check_failed`; then the command's own, `release_failed` and `tag_missing`.

## 3. Non-functional requirements

- **NF-1** — The tests never read or write the real home or touch the network: `HOME` and the XDG directories point at scratch directories, origin is a bare repository on disk, and `gh` and the registries are stand-ins that record each call.
- **NF-2** — Every command reads `ship.toml`, git and the channels afresh; nothing is remembered between commands.
- **NF-3** — No command prints a credential's value, in a result, an error or a refusal's `meta`.

## 4. Out of scope

- The `publish <tag> [--channel <kind>]... [--dry-run]` command, dispatching CI on a tag and refusing unless it passes (`ci_failed`, `ci_not_dispatchable`), and `unknown_channel`: later build steps, with the channels they run.
- The `testflight`, `play` and `developer-id` channels, their build numbers, release notes and rollouts (`build_number_spent`, `notes_missing`, `production_refused`): later build steps.
- Version sources other than `package.json`, such as a pubspec or an Xcode scheme: they come with the channels that need them.
- Fetching a credential from a secret store: a credential comes from the environment, `.env` or the repository's Actions secrets alone.
- Writing the changelog or store release notes: the project commits them before `release`, and they go out with the tag's push (FR-18).
- Pushing: the owner pushes the branch and the tag `release` prints.
- A project's web deploy, and moving any other repository onto agent-ship.

## 5. Acceptance criteria

- **AC-1** — In a scratch repository with no `ship.toml`: `check` is `config_missing`; outside git: `not_a_checkout`; with a `ship.toml` that is not TOML, one missing the version source, one with an unknown key, one with an unknown channel kind, and one whose `package.json` version is `1.2`: `config_invalid` naming each key. (FR-1, FR-2, FR-3)
- **AC-2** — A `ship.toml` whose `homebrew` channel sets a value shaped as a GitHub token, one shaped as an npm token, and one holding a private key: `check` and `doctor` each refuse `secret_in_config` naming the key, and neither output holds the value. (FR-6, NF-3)
- **AC-3** — A clean repository on `main` matching origin, with the annotated tag `v1.0.0`, one commit `fix: handle empty input` since and version `1.0.1`, a `.gitignore` ignoring `.env`, and a `ship.toml` whose `homebrew` channel names `TAP_DISPATCH_TOKEN` and whose check command is `exit 0`, all committed and pushed, with `TAP_DISPATCH_TOKEN` set in the environment: `check` prints the version `1.0.1`, the tag `v1.0.1`, the previous tag `v1.0.0`, one commit, the bump `patch` decided by that commit, and no warning, and the checkout's status, refs and origin are as before. (FR-4, FR-14, FR-16)
- **AC-4** — From AC-3's repository: with a modified tracked file, then an untracked file, then on another branch, then with a commit origin lacks: `dirty_tree`, `dirty_tree`, `not_on_release_branch`, `unpushed_commits`; with both an untracked file and another branch: `dirty_tree`, the first in order. (FR-16, FR-17, FR-48)
- **AC-5** — From AC-3's repository with notes paths `CHANGELOG.md` and `notes/**` committed and pushed: a commit origin lacks that changes `CHANGELOG.md` and `notes/en/release.txt`: `check` passes; one more that changes `notes.txt`: `unpushed_commits`; with notes paths `notes/*` instead, committed and pushed, and one commit origin lacks that changes `notes/en/release.txt`: `unpushed_commits`. (FR-7, FR-17, FR-18)
- **AC-6** — From AC-3's repository: with version `0.9.0` committed and pushed: `version_not_newer` naming `release`; with version `1.0.0` committed and pushed: `tag_not_at_head`; with `v1.0.0` made again at HEAD, so no commit follows it: `no_commits_since_tag`, the first in order, though `tag_mismatch` applies too; in a repository with no tag: `check` passes with no previous tag and the bump `none` decided by no commit. (FR-15, FR-19, FR-20, FR-21, FR-48)
- **AC-7** — From AC-3's repository with the tag `v1.0.1` made: lightweight at HEAD: `tag_unsigned`; annotated at HEAD: `check` passes against `v1.0.0`; with signed tags in a committed and pushed `ship.toml` and the unsigned annotated tag made again at that HEAD: `tag_unsigned`; annotated with one more commit made and pushed after it: `tag_not_at_head`; with no `v1.0.1` and an annotated `v0.5.0` at HEAD: `tag_mismatch` naming `0.5.0` and `1.0.1`. (FR-20, FR-21)
- **AC-8** — From AC-3's repository with `TAP_DISPATCH_TOKEN` unset: `check` is `missing_credential` naming it and `homebrew`; set instead in `.env`, which the repository ignores: passes; unset in both and held as an Actions secret, as the `gh` stand-in lists it: passes; with `ship.toml`'s check command `exit 3` committed and pushed: `check_failed` naming it and 3. (FR-9, FR-22, FR-23)
- **AC-9** — From AC-3's repository with notes path `CHANGELOG.md` and these files committed and pushed: `src/a.ts` holding `// TODO tidy` on its third line, `src/b.ts` holding `FIXME: x` on one line and `TODOS` on another, and `src/a.test.ts`, `src/a.spec.ts`, `test/c.ts`, `tests/c.ts`, `__tests__/c.ts`, `README.md` and `CHANGELOG.md` each holding `TODO`: `check` passes with two warnings, `src/a.ts` line 3 and the `FIXME` line of `src/b.ts`; with an ignored file `src/d.ts` holding `TODO` added, it gives the same two. (FR-16, FR-24)
- **AC-10** — From AC-3's repository with one more commit pushed, each in a fresh copy of it, `check` reports the bump: `feat: add x`: `minor`, decided by it alone; `feat(cli): add x`: `minor`; `FEAT: add x`: `minor`; `fix!: drop x`: `major`, decided by it alone; `fix: drop x` with a `BREAKING CHANGE: x is gone` footer: `major`; `fix: drop x` with a `BREAKING-CHANGE: x is gone` footer: `major`; `docs: x`: `patch`, decided by both commits; with version `0.4.1` and tag `v0.4.0` in place of AC-3's, and `feat!: drop x`: `minor`, decided by it alone. (FR-12, FR-14, FR-16)
- **AC-11** — From AC-3's repository with a floor `minor` on `src/schema/**` committed and pushed: one more commit `fix: x` that changes `src/schema/v2.ts`: `check` reports `minor`, decided by it; one that changes `src/other.ts` instead: `patch`; with the floor `major` and the commit changing `src/schema/v2.ts`: `major`, and with version `0.4.1` and tag `v0.4.0` in place of AC-3's: `minor`; a floor `patch`, and a floor `huge`: `config_invalid` naming the floor's level. (FR-7, FR-13, FR-14)
- **AC-12** — From AC-3's repository: `release patch` prints `1.0.2`, tag `v1.0.2`, the commit and the push command; `package.json` holds `1.0.2`, the commit's subject is `chore: release v1.0.2` and it changes only `package.json`, the tag is annotated at that commit, and origin's refs are as before. (FR-25, FR-30)
- **AC-13** — From AC-3's repository with version `1.4.2` committed and pushed, each `release` in a fresh copy of it: `release minor` makes `1.5.0`, `release major` makes `2.0.0` and `release 3.0.0` makes `3.0.0`; with `v3.0.0` and one more commit pushed, `release 2.9.9`: `version_not_newer`; `release next` and `release 3.1`: `bad_arguments`, and `release 3.1` with an untracked file: `bad_arguments`; with signed tags in a committed and pushed `ship.toml` and a signing key in the scratch home, the tag `release` makes verifies. (FR-20, FR-26, FR-48)
- **AC-14** — From AC-3's repository, each in a fresh copy: `release` makes `1.0.2`; with one more commit `feat: add x` pushed, `release` makes `1.1.0`; with `fix!: drop x` instead, `release` makes `2.0.0`. A clean pushed repository with version `1.0.0` and its only tag `v1.0.0` one commit behind HEAD, each in a fresh copy: with that commit `fix: x`, `release` makes `1.0.1`; with it `feat: add x`, `release` makes `1.1.0` and `release patch` is `bump_below_commits`. (FR-12, FR-25, FR-27, FR-28)
- **AC-15** — From AC-3's repository with one more commit `feat: add x` pushed: `release patch` and `release 1.0.9` are each `bump_below_commits` naming `minor` and that commit, and leave `package.json`, the branch and the tags as before; `release minor`, `release major`, `release 1.1.0` and `release 1.2.3` each succeed in a fresh copy; `release 0.9.0` is `version_not_newer`, and `release patch` with an untracked file is `dirty_tree`, each the first in order. (FR-28, FR-31, FR-48)
- **AC-16** — A clean pushed repository with no tag, version `0.1.0` and a commit `feat!: drop x`: `release` creates the annotated tag `v0.1.0` at HEAD, prints HEAD as the commit, makes no commit and leaves `package.json` at `0.1.0`; in a fresh copy, `release patch` makes `0.1.1` with no `bump_below_commits`. (FR-15, FR-26, FR-29)
- **AC-17** — From AC-3's repository with an untracked file, then with `ship.toml`'s check command `exit 1` committed and pushed, then with a commit hook that refuses the commit: `release patch` is `dirty_tree`, then `check_failed`, then `release_failed` naming the commit, each exit 1; after each, `package.json`, the branch and the tags are as before; then, with the cause removed, `release patch` makes `1.0.2`. (FR-31)
- **AC-18** — From AC-3's repository: `release --dry-run` prints `1.0.2`, `v1.0.2`, `chore: release v1.0.2` and the push command, and the checkout's status, refs and origin are as before; with `ship.toml`'s check command `exit 1` committed and pushed, it prints the same; with one more commit `feat: add x` pushed, `release patch --dry-run` is `bump_below_commits`; in AC-16's repository, `release --dry-run` prints `0.1.0`, `v0.1.0` and the commit subject `null`. (FR-32)
- **AC-19** — A repository with apps `web` and `cli`, each with its own version, channels and notes paths, and a floor `minor` under `web` on `web/**`: `check cli` passes for the tag `cli-v<version>`; `check` and `check api`: `bad_arguments`; in a repository without apps, `check cli`: `bad_arguments`; with one more commit `fix: x` changing `web/a.ts` and `cli/a.ts` pushed, `check cli` reports `patch` and `check web` `minor`; then a commit origin lacks changing only `web`'s notes paths: `check web` passes and `check cli` is `unpushed_commits`; with that commit pushed, `release patch cli` bumps only `cli`'s version and tags `cli-v<version>`, and in a fresh copy `release cli` does the same. (FR-4, FR-5, FR-26, FR-27)
- **AC-20** — A tag `v1.0.1` whose commit holds a workflow `release.yml` pushed on `v*` tags, whose run the `gh` stand-in reports succeeded, whose GitHub release is published with every file, whose npm packages the registry stand-in serves and whose formula the tap stand-in pins at `1.0.1`: `status v1.0.1` reports `release.yml` `passed` and `github-release`, `npm` and `homebrew` `served`, exit 0. (FR-33, FR-34, FR-35, FR-36, FR-37)
- **AC-21** — From AC-20: with the release a draft, then a file missing from it; with one npm package not at the version; with the formula at `1.0.0`; with the registry stand-in failing: `status v1.0.1` reports each channel `missing`, or `unreadable` with the reason, exit 1; `status v9.9.9`: `tag_missing`; `status nope`: `bad_arguments`. (FR-33, FR-35, FR-36, FR-37, FR-48)
- **AC-22** — From AC-20 with a workflow `check.yml` pushed on branches only beside `release.yml`, on a clock passed in: `status v1.0.1` reports `release.yml` and not `check.yml`; with `release.yml`'s run running, then succeeded before 60 minutes pass: `passed`, exit 0; with it failed: `failed` with the conclusion `failure`, exit 1; still running at 60 minutes: `running`, exit 1; with no run at 60 minutes: `missing`, exit 1. (FR-33, FR-34)
- **AC-23** — Channels naming `TAP_DISPATCH_TOKEN` for `homebrew` and `NPM_SMOKE_KEY` as a file for `npm`: `doctor` with the token in the environment and the file's path in `.env` reports both present with sources `environment` and the file's path, git and `gh` `ok`, exit 0; with the token only as an Actions secret: its source is `actions-secret`; with neither set and the path naming no file: both fail with a fix naming where to set each, exit 1; no output holds the token's value; `doctor` checks no credential no channel names. (FR-8, FR-9, FR-10, FR-38, NF-3)
- **AC-24** — The reusable workflow, read as YAML: its triggers are `workflow_call` and a pushed `v*` tag, and the job that publishes to npm holds `id-token: write`. (FR-39)
- **AC-25** — The reusable workflow, read as YAML: the step that checks the tag and the credentials precedes every build and publish step, and every job that reads a credential masks it before any other step that reads it. (FR-11, FR-40)
- **AC-26** — The reusable workflow, read as YAML: the release is created as a draft after the attestation of every file and published in a later step; the npm job publishes with provenance and no npm token in its environment, then installs the version from the registry and runs the smoke command; the tap dispatch waits on the published release; and each publish, the release, npm and the tap, is skipped when its channel already serves the version. (FR-41, FR-42, FR-43, FR-44)
- **AC-27** — No command, and `--help`, print `command: agent-ship` with `check`, `release`, `status` and `doctor` and the `--help` and `--version` flags, each with its usage and summary, exit 0; `--version` prints the version alone, exit 0; `--help now` and `--version now`: `wrong_arity`, exit 2. (FR-45)
- **AC-28** — `frobnicate`, `status` with no tag and `check a b`, each also outside a git checkout: exit 2, nothing on stdout, `unknown_command` and `bad_arguments` on stderr as TOON with the usage as `resolve`; a refusal from AC-4: exit 1 with the error as TOON on stderr; a result from AC-3: TOON on stdout, exit 0. (FR-46, FR-47, FR-48)
- **AC-29** — The test environment's `HOME` and XDG directories are scratch directories, not the account's; every `gh` and registry call in the suite reaches a stand-in that recorded it. (NF-1)
- **AC-30** — `check` passes in AC-3's repository; commit and push a `ship.toml` naming another credential that is unset, and `check` is `missing_credential` with no other change. (NF-2, FR-22)

## 6. Deliverables

- **D-1** — The `agent-ship` CLI, run by Bun from a checkout through `bin/agent-ship` and linked onto `PATH` by `mise install` in the primary checkout.
- **D-2** — The reusable workflow `.github/workflows/release.yml`, and agent-ship's first release, published by its own tag through that workflow from agent-ship's source to its GitHub release, npm and the Homebrew tap, with `status` reporting each channel `served`.
- **D-3** — `README.md`, `AGENTS.md`, `src/README.md`, `docs/commands.md`, `docs/development.md`, `docs/releasing.md`, `CONTRIBUTING.md` and this spec.
- **D-4** — The test suite, run by `bun run check`, and the acceptance suite, run by `bun run acceptance`, whose test names cite the criteria in §5.

## 7. Constraints (fixed)

- **C-1** — TypeScript on Bun, which mise installs, with TOON through `@toon-format/toon`.
- **C-2** — `release` never pushes; the owner pushes the tag, and the tag starts the release.
- **C-3** — npm publishes only from CI through trusted publishing, so every publish runs in the reusable workflow, never on the machine that runs `release`.
- **C-4** — git and `gh` are the programs the CLI runs; it reads the npm registry and the tap over HTTPS.
