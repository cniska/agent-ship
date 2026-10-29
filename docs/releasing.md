# Releasing

How a project releases through agent-ship's reusable workflow, and how agent-ship releases itself. [`SPEC.md`](../SPEC.md) states what must hold.

## The reusable workflow

`.github/workflows/release.yml` runs when another workflow calls it, and when a `v*` tag is pushed to agent-ship itself. It checks out the caller's repository at the ref it runs on, and agent-ship at the commit of the workflow it runs. A dispatched run is a [dry run](#dry-run).

| Job | Does |
| --- | --- |
| Plan | Refuses `tag_mismatch`, or `dry_run_app_invalid` in a dry run, then `missing_credential`, and, for an npm channel with no `build`, `package_not_tracked`, `package_version_mismatch` or `package_order`, before anything is built or published; decides each channel's stage |
| GitHub release build | Runs the channel's `build` once per target, each on that target's own runner, and keeps the files each one made |
| GitHub release | Puts each target's files at their paths, runs `assemble` when the channel names one, attests the build provenance of each file, creates the tag's release as a draft with every file, then publishes it in a later step |
| npm | Builds the packages when the channel has a `build`, publishes each in the listed order with provenance through npm's trusted publishing and no npm token, and waits until the registry serves each |
| npm smoke | On each target's runner, through npm and through Bun, installs the version from the registry and runs `smoke` |
| Homebrew | Once the release is published, or when no release needs publishing, dispatches the tap to repin the formula |

Every job masks every secret value first; a channel's job sees only the credentials that channel names.

### Stages

The plan gives each channel kind one stage:

- **`publish`** when the channel does not serve the version, as [Status](commands.md#status) defines served, or when the plan cannot read it.
- **`served`** when it does; its job is skipped.
- **`absent`** when `ship.toml` names no such channel.
- **`dry-run`** for every channel `ship.toml` names, in a dry run.

### Reruns and concurrent runs

A rerun on the same tag publishes nothing twice. Each job replaces the files an earlier attempt of the run kept. The release job attaches to an already published release only the files it lacks, and deletes a draft an earlier run left. The npm job skips each package the registry already serves.

Two runs of one tag never publish at once. The workflow holds the concurrency group `agent-ship-release-<repository>-<ref>` and never cancels a run in progress. A called workflow sees the caller's `github` context, so a caller group of the same name would make the called workflow wait on its own caller. The caller in [Calling it](#calling-it) names its group `release-<ref>`.

### Targets

Every release builds two targets, each on a runner of its own platform:

| Target | Runner |
| --- | --- |
| `darwin-arm64` | `macos-latest` |
| `linux-x64` | `ubuntu-latest` |

The `github-release` channel's `build` runs once per target, with `TARGET` set to it. It builds that target's files and smoke-tests them there, so a build that runs only on its own platform is proven before release. Each run keeps the files in `files` that it made, and fails when it made none.

The release job then puts each target's files at their paths. Two targets may make the same file only with the same bytes; otherwise the job refuses `target_files_conflict`. `assemble`, when the channel names it, then runs once on Linux and makes the files that span targets, such as checksums. Every file in `files` must exist after it.

### Dry run

A run whose event is `workflow_dispatch` is a dry run, whatever ref it runs on, a tag included. When called, that is the caller's event. Every other run releases the tag it runs on.

A dry run takes the app the `app` input names, or the only app when `ship.toml` has none. It refuses `dry_run_app_invalid` when a repository with apps gets no app or an unknown one, or a repository without apps gets one. It plans the app's recorded version and that version's tag, checks the credentials and tracked packages as a release does, and reads no channel.

Then it runs each target's build and `assemble`, and checks every file. With an npm `build`, the npm job builds the packages from those files and runs `npm pack --dry-run` on each. It attests, drafts and publishes no release, publishes and smokes no package, and dispatches no tap.

### What a channel needs

- **Credentials.** The plan finds a credential among the secrets the caller passes, by its exact name. A file credential is checked only as set; the workflow does not write it to a file.
- **npm packages.** Without a `build`, each package in `packages` is published from the directory of the tracked `package.json` that names it. With a `build` and `out`, the npm job first downloads each file the `github-release` channel names, if there is one, from the published release to that file's path, then runs the `build`, and publishes each package from the directory of the `package.json` under `out` that names it. The job refuses `package_not_built`, `package_version_mismatch` or `package_order` before it publishes any package.
- **Package order.** Packages publish in the order `packages` lists them, and a package listed before a listed package it names in `dependencies` or `optionalDependencies` is refused `package_order`. A root that names its platform packages as optional dependencies goes last.
- **The smoke.** Four runs, each target's runner through npm and through Bun, install each listed package no other listed package depends on into a prefix of their own. Each then runs `smoke` in the project's checkout, with `VERSION` set to the version under release.
- **The smoke's `PATH`.** It holds only the prefix's programs, `/usr/bin` and `/bin`, and Node only when the channel sets `smoke-node`. A smoke fails when Bun is on that `PATH`, or Node without `smoke-node`, so a passing smoke shows the install needs neither.
- **The tap.** The dispatch is the `formula-release` event on the tap. Its payload holds `formula`, the formula file's name without `.rb`; `ref`, the tag; and `version`. The tap's own workflow repins the formula.

## Calling it

A project's own `.github/workflows/release.yml` runs on its release tags and calls the reusable workflow pinned to the full commit sha of an agent-ship release tag, with that tag's version as the trailing comment. It passes its secrets and grants the permission to request an OIDC token that npm's trusted publishing and the attestations need. It holds a concurrency group of its own per ref, so a second run of one tag waits for the first.

```yaml
name: Release

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      app:
        type: string
        default: ""

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    uses: cniska/agent-ship/.github/workflows/release.yml@<sha> # vX.Y.Z
    with:
      app: ${{ inputs.app }}
    permissions:
      contents: write
      id-token: write
      attestations: write
    secrets: inherit
```

`gh api repos/cniska/agent-ship/commits/vX.Y.Z -q .sha` prints the commit sha of a release tag. A repository of several apps triggers on each app's tag pattern, such as `cli-v*`.

The caller's `workflow_dispatch` trigger starts a [dry run](#dry-run): `gh workflow run release.yml --ref main` dry-runs the commit at `main`, and `-f app=cli` names the app in a repository with apps.

## Each release

1. On a clean release branch at origin's commit, run `agent-ship check`, then `agent-ship release`, which takes the bump the commits warrant, or `agent-ship release patch|minor|major`. `release` commits `chore: release <tag>`, tags it and prints the push command.
2. Push the branch, then the tag, as `release` prints. The tag starts the release.
3. Run `agent-ship status <tag>` until every channel is `served`.

A tag that published nothing can be deleted and made again once the fix is on the release branch. With a `github-release` channel, an npm job refuses built packages only after the release is published, so that tag has already published something. Once a tag has published anything, the fix goes out as a new, higher version; a tag is never moved.

## agent-ship's own release

agent-ship's `ship.toml` names three channels:

- **`github-release`**: `scripts/build` compiles `agent-ship` for `TARGET`, checks that the binary prints the version, and packs it into a tarball in `dist/`. It refuses a `TARGET` other than the machine it runs on. `assemble` writes `SHA256SUMS.txt` over the tarballs.
- **`npm`**: `scripts/build-npm.ts` builds three packages under `dist/npm` from the release's tarballs:
  - `@cniska/agent-ship-darwin-arm64` and `@cniska/agent-ship-linux-x64` each hold that platform's binary and install only on it.
  - `@cniska/agent-ship` holds only the launcher `npm/agent-ship` and names both as optional dependencies at its version. The launcher is a POSIX `sh` script that runs the binary of the platform package installed beside it, so an npm install needs no Bun.
  - The launcher's refusals are in the [errors table](commands.md#errors).
  - The smoke checks that `agent-ship --version` prints the version under release, with no Node on `PATH`.
- **`homebrew`**: `Formula/agent-ship.rb` in `cniska/homebrew-tap`, dispatched with `TAP_DISPATCH_TOKEN`.

## The owner's setup, once

For each project, and for agent-ship itself:

1. Publish each npm package in `packages` once by hand, such as a `0.0.0` holding only its `package.json`: npm sets a trusted publisher only on a package the registry holds.
2. Add a trusted publisher to each package, with publish allowed: GitHub Actions, the project's repository, workflow `release.yml`. On npm 11.15 or later, `npm trust github <package> --repo <owner>/<repo> --file release.yml --allow-publish` adds it.
3. In the project's Actions secrets, add each credential `ship.toml` names, such as `TAP_DISPATCH_TOKEN`, a fine-grained token on the tap with Contents read and write.
4. For a `homebrew` channel, add the formula to the tap: the dispatch repins a formula and creates none.

Run `agent-ship doctor` in the checkout to see which credentials are present and where each comes from.
