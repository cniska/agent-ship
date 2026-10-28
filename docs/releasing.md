# Releasing

How a project releases through agent-ship's reusable workflow, and how agent-ship releases itself. [`SPEC.md`](../SPEC.md) states what must hold; the workflow is specified and not yet built.

## The reusable workflow

`.github/workflows/release.yml` runs when another workflow calls it, and when a `v*` tag is pushed to agent-ship itself. It reads the caller's `ship.toml` and, for the pushed tag:

1. Refuses `tag_mismatch` when the tag is not the version source's release tag, and `missing_credential` when a credential a channel names is not set, before it builds or publishes anything.
2. Masks each credential value it reads before any step that could print it.
3. For `github-release`, builds the channel's files, attests the build provenance of each, creates the tag's release as a draft with every file attached, and publishes it only once every file is attached.
4. For `npm`, publishes each package with provenance through npm's trusted publishing, with no npm token, then installs the published version from the registry and runs the channel's smoke command against it.
5. For `homebrew`, once the release is published, dispatches the tap to repin the formula to the version.

A channel that already serves the version is skipped, so rerunning the workflow on the same tag publishes nothing twice and reaches each channel still missing.

## Calling it

A project's own `.github/workflows/release.yml` runs on its release tags and calls the reusable workflow at a release tag of agent-ship. It passes its secrets, and grants the permission to request an OIDC token that npm's trusted publishing and the attestations need.

```yaml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  release:
    uses: cniska/agent-ship/.github/workflows/release.yml@vX.Y.Z
    permissions:
      contents: write
      id-token: write
      attestations: write
    secrets: inherit
```

A repository of several apps triggers on each app's tag pattern, such as `cli-v*`.

## Each release

1. On a clean release branch at origin's commit, run `agent-ship check`, then `agent-ship release`, which takes the bump the commits warrant, or `agent-ship release patch|minor|major`. `release` commits `chore: release <tag>`, tags it and prints the push command.
2. Push the branch, then the tag, as `release` prints. The tag starts the release.
3. Run `agent-ship status <tag>` until every channel is `served`.

A tag that published nothing can be deleted and made again once the fix is on the release branch. Once a tag has published anything, the fix goes out as a new, higher version; a tag is never moved.

## The owner's setup, once

For each project, and for agent-ship itself:

1. Publish each npm package once by hand, so trusted publishing can be set on it.
2. On npmjs.com, add a trusted publisher to each package: GitHub Actions, the project's repository, workflow `release.yml`.
3. In the project's Actions secrets, add each credential `ship.toml` names, such as `TAP_DISPATCH_TOKEN`, a fine-grained token on the tap with Contents read and write.

Run `agent-ship doctor` in the checkout to see which credentials are present and where each comes from.
