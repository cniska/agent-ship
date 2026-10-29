# Releasing

How a project releases through agent-ship's reusable workflow, and how agent-ship releases itself. [`SPEC.md`](../SPEC.md) states what must hold.

## The reusable workflow

`.github/workflows/release.yml` runs when another workflow calls it, and when a `v*` tag is pushed to agent-ship itself. It checks out the caller's repository at the tag, and agent-ship at the commit of the workflow it runs.

| Job | Does |
| --- | --- |
| Plan | Refuses `tag_mismatch` or `missing_credential`, and, for an npm channel with no `build`, `package_not_tracked`, `package_version_mismatch` or `package_order`, before anything is built or published; decides each channel's stage |
| GitHub release | Runs the channel's `build`, attests the build provenance of each file, creates the tag's release as a draft with every file, then publishes it in a later step |
| npm | Builds the packages when the channel has a `build`, publishes each in the listed order with provenance through npm's trusted publishing and no npm token, waits until the registry serves each, then installs the version and runs `smoke` |
| Homebrew | Once the release is published, or when no release needs publishing, dispatches the tap to repin the formula |

Every job masks every secret value first; a channel's job sees only the credentials that channel names.

### Stages

The plan gives each channel kind one stage:

- **`publish`** when the channel does not serve the version, as [Status](commands.md#status) defines served, or when the plan cannot read it.
- **`served`** when it does; its job is skipped.
- **`absent`** when `ship.toml` names no such channel.

A rerun on the same tag publishes nothing twice. The release job attaches to an already published release only the files it lacks, and deletes a draft an earlier run left. The npm job skips each package the registry already serves.

### What a channel needs

- **Credentials.** The plan finds a credential among the secrets the caller passes, by its exact name. A file credential is checked only as set; the workflow does not write it to a file.
- **npm packages.** Without a `build`, each package in `packages` is published from the directory of the tracked `package.json` that names it. With a `build` and `out`, the npm job first downloads each file the `github-release` channel names, if there is one, from the published release to that file's path, then runs the `build`, and publishes each package from the directory of the `package.json` under `out` that names it. The job refuses `package_not_built`, `package_version_mismatch` or `package_order` before it publishes any package.
- **Package order.** Packages publish in the order `packages` lists them, and a package listed before a listed package it names in `dependencies` or `optionalDependencies` is refused `package_order`. A root that names its platform packages as optional dependencies goes last.
- **The smoke.** The job installs each listed package no other listed package depends on, then runs `smoke` with `PATH` holding only npm's global programs, Node among them, and `/usr/bin` and `/bin`. It fails when Bun is on that `PATH`, so a passing smoke shows the install needs no Bun.
- **The tap.** The dispatch is the `formula-release` event on the tap. Its payload holds `formula`, the formula file's name without `.rb`; `ref`, the tag; and `version`. The tap's own workflow repins the formula.

## Calling it

A project's own `.github/workflows/release.yml` runs on its release tags and calls the reusable workflow pinned to the full commit sha of an agent-ship release tag, with that tag's version as the trailing comment. It passes its secrets, and grants the permission to request an OIDC token that npm's trusted publishing and the attestations need.

```yaml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  release:
    uses: cniska/agent-ship/.github/workflows/release.yml@<sha> # vX.Y.Z
    permissions:
      contents: write
      id-token: write
      attestations: write
    secrets: inherit
```

`gh api repos/cniska/agent-ship/commits/vX.Y.Z -q .sha` prints the commit sha of a release tag. A repository of several apps triggers on each app's tag pattern, such as `cli-v*`.

## Each release

1. On a clean release branch at origin's commit, run `agent-ship check`, then `agent-ship release`, which takes the bump the commits warrant, or `agent-ship release patch|minor|major`. `release` commits `chore: release <tag>`, tags it and prints the push command.
2. Push the branch, then the tag, as `release` prints. The tag starts the release.
3. Run `agent-ship status <tag>` until every channel is `served`.

A tag that published nothing can be deleted and made again once the fix is on the release branch. With a `github-release` channel, an npm job refuses built packages only after the release is published, so that tag has already published something. Once a tag has published anything, the fix goes out as a new, higher version; a tag is never moved.

## agent-ship's own release

agent-ship's `ship.toml` names three channels:

- **`github-release`**: `scripts/build` compiles `agent-ship` for `darwin-arm64` and `linux-x64` into tarballs in `dist/`, with their `SHA256SUMS.txt`.
- **`npm`**: `scripts/build-npm.ts` builds three packages under `dist/npm` from the release's tarballs:
  - `@cniska/agent-ship-darwin-arm64` and `@cniska/agent-ship-linux-x64` each hold that platform's binary and install only on it.
  - `@cniska/agent-ship` holds only the launcher `npm/agent-ship` and names both as optional dependencies at its version. The launcher is a POSIX `sh` script that runs the binary of the platform package installed beside it, so an npm install needs no Bun.
  - The launcher's refusals are in the [errors table](commands.md#errors).
- **`homebrew`**: `Formula/agent-ship.rb` in `cniska/homebrew-tap`, dispatched with `TAP_DISPATCH_TOKEN`.

## The owner's setup, once

For each project, and for agent-ship itself:

1. Publish each npm package in `packages` once by hand, such as a `0.0.0` holding only its `package.json`: npm sets a trusted publisher only on a package the registry holds.
2. Add a trusted publisher to each package, with publish allowed: GitHub Actions, the project's repository, workflow `release.yml`. On npm 11.15 or later, `npm trust github <package> --repo <owner>/<repo> --file release.yml --allow-publish` adds it.
3. In the project's Actions secrets, add each credential `ship.toml` names, such as `TAP_DISPATCH_TOKEN`, a fine-grained token on the tap with Contents read and write.
4. For a `homebrew` channel, add the formula to the tap: the dispatch repins a formula and creates none.

Run `agent-ship doctor` in the checkout to see which credentials are present and where each comes from.
