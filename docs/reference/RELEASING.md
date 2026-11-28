# Releasing Leon

Leon has **one product version and release notes** for the server, web and Desktop. Root `package.json`, tag `v<version>` and `release.json` must agree. Tools, skills and bridges retain their own versions. Follow [repository versioning policy](../../AGENTS.md#releases-publishing-and-distribution): one pending bump for unpublished work; never overwrite published versions or used tags.

Preview installs receive eligible prereleases and stable releases; stable installs receive stable releases only. Before the announcement, increment `2.0.0-alpha.0`, `.0.1`, `.0.2`, etc.; reserve `2.0.0-alpha.1` for the announcement. Every changed distribution needs a higher SemVer version; `+dev` does not increase precedence.

## Work in parallel

Start each change from `develop` on its own topic branch. Name it `<type>/<short-kebab-case-description>`, for example `fix/session-search`. Use the same remote branch when continuing the change on another computer. Merge ready changes into `develop`.

The release maintainer selects the batch and prepares one product version bump and one set of release notes. Keeping `package.json` and `release.json` in the same release preparation change gives contributors a single version and summary for the batch.

## Prepare a version

Review the full batch and its commit messages before pushing the version and notes to `develop`. Update the notes whenever the batch changes.

- Write the title, summary, and highlights around what gets better for owners. Use plain English and group commits by outcome.
- Start each `changes` entry with a brief, bold sentence that begins with a past-tense verb. Follow it with why the change matters and the details owners need.

  > **Added a web search fallback.** If your model’s search is unavailable or returns no useful results, I can look for public sources with Keenable.

- Check the previous version before calling a capability new.
- Name the package or runtime, exact version, and owner benefit. Check upstream notes and Leon’s code. Back speed or quality claims with evidence.
- Name the prebuilt binaries, supported platforms and architectures, and matching runtime versions. Use a Markdown table when those versions differ by platform.

Set `desktop.minimumServerVersion` in `release.json` to the oldest server version supported by Desktop in the release's major version. The Desktop build embeds this value for startup and update checks. Carry it forward across releases and raise it when Desktop requires a newer server capability.

During parallel development, create and push `release/<version>` from the reviewed commit on `origin/develop`, for example `release/2.1.0`. The release branch keeps the candidate available for verification and tagging while new changes land on `develop`.

**Planned release media.** While drafting, keep screenshots and clips in a local folder outside the checkout, organized by version. The planned publishing flow attaches them to the GitHub release draft, and the update dialog displays those assets before installation.

## Publish a version

1. Check out the branch for the reviewed release candidate. Its local and remote tips must point to the same commit.
2. Run `pnpm release` from the clean, pushed branch to check published releases and remote tags, then create and push the immutable tag that triggers CI. If it prepares missing release-note scaffolding or updates a stale metadata version, review the notes, commit and push them, then run it again. The command leaves the `package.json` bump and commits to the maintainer.

Use `pnpm release --dry-run` for a read-only check before tagging. Optional `GH_TOKEN` or `GITHUB_TOKEN` authenticates discovery.

[Release CI](../../.github/workflows/release.yml) gates publication on build/lint/tests, Desktop builds, cold installs, [Quick Evals](../../.github/workflows/quick-evals.yml), and source/archive OTA checks with profile preservation, restart and live inference. Server archives and Desktop builds require native verification for `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`. Windows ARM64 remains unverified; macOS Intel is excluded. Without a predecessor, gates record a bootstrap baseline, not a proven public upgrade.

CI verifies receipts/hashes against the exact commit/run, uploads to a draft, then publishes notes, `leon-release.json`, `leon-runtime-assets.json`, `leon-quick-evals.json` and `leon-core-<version>-<platform>.tar.gz`. Prereleases are not marked latest. Failed/skipped gates block publication; rerun failed jobs without moving tags. Quick Evals history uses the `eval-history` branch; [calibration and budgets](../../scripts/ci/quick-evals.ts) remain source-owned.

The server checks GitHub at startup and every six hours, plus up to fifteen minutes of randomized delay. Cached metadata, ETags and rate-limit backoff bound requests. Branch pushes alone do not trigger OTA; owners choose installation. A first published archive enables fresh installations; a newer release enables the public upgrade path.

| Installation | Update behavior |
| --- | --- |
| Source checkout | Requires clean, fast-forwardable code started through `pnpm start`; pins the release, stops the server, installs/setup/builds, then restarts. |
| Prebuilt server | Stages and size/SHA-256-verifies the archive while serving, then stops for shared profile setup and atomic version selection. Keeps profiles separate and a previous code version for recovery. |
| Desktop | `electron-updater` handles native app replacement, separately from server updates. The shared dialog coordinates the server first, then Desktop. Desktop replacement requires a successful server update. |

Active turns can be interrupted. Closing the update view asks for confirmation where supported; accepted installation continues in the background. Code recovery does not undo profile migrations. See [Desktop mechanisms](DESKTOP.md) and [download policy](DOWNLOADS.md).

**Desktop delivery is not enabled yet.** [desktop-build.yml](../../.github/workflows/desktop-build.yml) verifies unsigned builds for the release commit and can also be run manually from Actions. Local builds disable automatic replacement. Signing/publication helpers are prepared, but protected publishing and native verification remain required. macOS needs Developer ID, hardened runtime and notarization; Windows needs timestamped Authenticode signing; Linux targets AppImage and Debian packages. Keep signing secrets in protected CI.

Desktop installers must match the server release's version/commit. The publisher attaches verified installers before advancing `desktop-preview`/`desktop-stable` metadata pointers; these are delivery feeds, not separate product releases. A server-only release leaves Desktop's pointer unchanged. Publish installers and verify replacement/relaunch before enabling desktop OTA.
