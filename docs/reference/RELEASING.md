# Releasing Leon

Leon has **one product version and release notes** for Core, web and Desktop. Root `package.json`, tag `v<version>` and `release.json` must agree. Tools, skills and bridges retain their own versions. Follow [repository versioning policy](../../AGENTS.md#releases-publishing-and-distribution): one pending bump for unpublished work; never overwrite published versions or used tags.

Preview installs receive eligible prereleases and stable releases; stable installs receive stable releases only. Before the announcement, increment `2.0.0-alpha.0`, `.0.1`, `.0.2`, etc.; reserve `2.0.0-alpha.1` for the announcement. Every changed distribution needs a higher SemVer version; `+dev` does not increase precedence.

1. Bump `package.json` appropriately and author `release.json`: title, summary, highlights and changes under `new`, `improvements`, `fixes`, `removed`.
2. Run `pnpm release`. It checks published releases/remote tags, creates missing release-note scaffolding or updates a stale metadata version, then stops for review when needed. It never bumps `package.json` or commits.
3. Commit and push the reviewed version, notes and code. Run `pnpm release` again from the clean, pushed branch to create/push the immutable tag and trigger CI. `pnpm release --dry-run` checks without writes. Optional `GH_TOKEN`/`GITHUB_TOKEN` authenticates discovery; no maintainer token ships to owners.

Set `desktop.minimumCoreVersion` in `release.json` to the oldest Core version supported by Desktop in the release's major version. The Desktop build embeds this value for startup and update checks. Carry it forward across releases and raise it when Desktop requires a newer Core capability.

[Release CI](../../.github/workflows/release.yml) gates publication on build/lint/tests, Desktop builds, cold installs, [Quick Evals](../../.github/workflows/quick-evals.yml), and source/archive OTA checks with profile preservation, restart and live inference. Core archives and Desktop builds require native verification for `darwin-arm64`, `linux-x64`, `linux-arm64`, `win32-x64`. Windows ARM64 remains unverified; macOS Intel is excluded. Without a predecessor, gates record a bootstrap baseline, not a proven public upgrade.

CI verifies receipts/hashes against the exact commit/run, uploads to a draft, then publishes notes, `leon-release.json`, `leon-runtime-assets.json`, `leon-quick-evals.json` and `leon-core-<version>-<platform>.tar.gz`. Prereleases are not marked latest. Failed/skipped gates block publication; rerun failed jobs without moving tags. Quick Evals history uses the `eval-history` branch; [calibration and budgets](../../scripts/ci/quick-evals.ts) remain source-owned.

Core checks GitHub at startup and every six hours, plus up to fifteen minutes of randomized delay. Cached metadata, ETags and rate-limit backoff bound requests. Branch pushes alone do not trigger OTA; owners choose installation. A first published archive enables fresh installations; a newer release enables the public upgrade path.

| Installation | Update behavior |
| --- | --- |
| Source checkout | Requires clean, fast-forwardable code started through `pnpm start`; pins the release, stops Core, installs/setup/builds, then restarts. |
| Prebuilt Core | Stages and size/SHA-256-verifies the archive while serving, then stops for shared profile setup and atomic version selection. Keeps profiles separate and a previous code version for recovery. |
| Desktop | `electron-updater` handles native app replacement, separately from Core OTA. The shared dialog coordinates Core first, then Desktop; failed Core installation blocks app replacement. |

Active turns can be interrupted. Closing the update view asks for confirmation where supported; accepted installation continues in the background. Code recovery does not undo profile migrations. See [Desktop mechanisms](DESKTOP.md) and [download policy](DOWNLOADS.md).

**Desktop delivery is not enabled yet.** [desktop-build.yml](../../.github/workflows/desktop-build.yml) verifies unsigned builds for the release commit and can also be run manually from Actions. Local builds disable automatic replacement. Signing/publication helpers are prepared, but protected publishing and native verification remain required. macOS needs Developer ID, hardened runtime and notarization; Windows needs timestamped Authenticode signing; Linux targets AppImage and Debian packages. Keep signing secrets in protected CI.

Desktop installers must match the Core release's version/commit. The publisher attaches verified installers before advancing `desktop-preview`/`desktop-stable` metadata pointers; these are delivery feeds, not separate product releases. A Core-only release leaves Desktop's pointer unchanged. Publish installers and verify replacement/relaunch before enabling desktop OTA.
