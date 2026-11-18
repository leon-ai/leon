# Releasing Leon

GitHub Releases are the distribution record for complete Leon versions. Publication is gated by [the release workflow](../../.github/workflows/release.yml). The Core updater renders the generated Markdown description; direct JSON changelog consumption remains planned.

## Versions and channels

- Root `package.json` owns Leon's version. Commit it before tagging; the tag (`v<version>`) and release metadata must match.
- Use [SemVer](https://semver.org/): patch for compatible fixes, minor for compatible features, major for breaking public-contract changes. Increment prerelease numbers for successive previews.
- Follow the [repository versioning rule](../../AGENTS.md#releases-publishing-and-distribution): reuse the pending bump across local follow-up work; preserve versions already pushed or published.
- Before the public announcement, use `2.0.0-alpha.0`, then `2.0.0-alpha.0.1`, `2.0.0-alpha.0.2`, etc. Reserve `2.0.0-alpha.1` for the announcement; continue through alpha, beta, rc, and finally `2.0.0`.
- Preview installs receive eligible prereleases and stable releases; stable installs receive stable releases. Changed distributions need unique, increasing versions. `+dev` metadata does not increase version precedence.
- Tools, skills, and bridges keep independent versions. Distinguish their separate releases from complete Leon releases.

## Release content

Author `release.json`: `schemaVersion: 1`, `version`, `title`, Markdown `summary`, `highlights` with `title`/`body`, and `changes` arrays named `new`, `improvements`, `fixes`, and `removed`.

Run `pnpm release` to validate the pending version against published Core releases and remote version tags. When `release.json` is absent, the command creates an empty review scaffold; when its version is stale, it updates that field while preserving authored text and stops for review. Review the notes, commit and push the code and metadata, then run the command again. It never changes `package.json` or commits on your behalf. Commit messages alone cannot establish an appropriate SemVer bump or accurate owner-facing highlights; the maintainer reviews those decisions.

`pnpm release --dry-run` checks eligibility without changing metadata, creating a tag or starting CI. The command needs Git access to push tags to the GitHub `origin` remote; no extra CLI is required. Public release discovery uses GitHub's API; optional `GH_TOKEN`/`GITHUB_TOKEN` supports authenticated checks and private repositories. Failed release tags remain used versions; inspect and rerun their failed Actions jobs instead of moving or overwriting tags.

CI generates the GitHub description and `leon-release.json` asset from it. GitHub supplies the publication date and stores each release's content; CI generation files are temporary.

## Publishing

1. Review the version and content, commit and push the branch, then run `pnpm release`. It requires a clean tree and the exact branch commit on origin, creates the immutable `v<version>` tag and pushes it to request the release workflow.
2. CI reuses `build.yml` for lint/build/tests and `fresh-install.yml` for cold installations and live inference checks on Linux, macOS, and Windows.
3. The Linux OTA gate starts the previous published OTA-capable version in the same channel, installs the exact candidate, and verifies restart, version, profile credentials, and a live LLM ping.
4. Native workers package Core archives for macOS ARM64, Linux x64/ARM64 and Windows x64. Each archive must pass isolated startup, the real HTTP artifact-OTA flow, existing conversations/workspaces in two isolated profiles, credential preservation and live inference. Until a predecessor archive is published for that platform, the artifact gate records an explicit bootstrap baseline.
5. Only after every gate passes, CI verifies archive hashes and receipts against the exact commit/workflow run, uploads notes/JSON, `leon-runtime-assets.json` and platform archives to a draft, then publishes it. Alpha/beta/rc releases are prereleases; only stable releases are marked latest.

Without an OTA-capable predecessor, the gate records a bootstrap smoke upgrade using candidate source and a synthetic older version. It does not claim compatibility with legacy installations. Failed or skipped gates block automated publication; administrators can still publish manually through GitHub.

Routine build/test and scheduled or manually dispatched fresh-install checks use `ubuntu-latest`, `macos-latest` and `windows-latest` to detect compatibility changes. Release calls select explicit images: `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15` (ARM64) and `windows-2022` (x64). The additional native Linux ARM64 installation gate runs during releases. These images still receive maintenance updates; their labels do not pin every installed tool. The release build image alone does not establish an older Linux compatibility guarantee; supporting an older system requires separate installation and runtime verification on that baseline.

Native Windows ARM64 is not a published Core target yet. Managed Python provides a native archive, but the complete dependency graph, bundled binaries and installation/OTA paths require native verification before its runner and archive can become required release gates. macOS Intel is not a release target.

## Owner updates

Leon checks published releases on startup and every six hours with up to fifteen minutes of jitter. Recent metadata is cached for five minutes across restarts, ETags avoid retransferring unchanged notes, and rate-limit responses defer requests until the server permits retry. Unauthenticated GitHub API limits remain shared per public IP; no maintainer token is shipped to owners. Branch commits alone do not trigger OTA; owners choose when to install.

Git-clone OTA requires a clean, fast-forwardable checkout launched with `pnpm start`. It pins the release, stops Core, installs dependencies, runs setup/migrations and builds, then restarts and reloads the app. Active turns are interrupted. Failure recovery attempts to restore/rebuild the previous code; profile-data migrations are not rolled back.

Portable-runtime setup stages downloads and validates the expected executable before replacing the working directory. Failed downloads and extraction preserve the installed binary and manifest for recovery. Operating-system executable locks can still reject replacement safely; prebuilt runtimes avoid shared executable replacement by keeping code versions separate.

Prebuilt installations use the same release channels, authenticated update API, notes, owner confirmation and restart states. Core stages a platform archive while serving requests, verifies its size/SHA-256, then stops for compiled profile setup and atomic version selection. The archive includes compiled Core, its matching web frontend, production dependencies, managed Node/pnpm/Python/uv/jq and Python bridge dependencies. Owners need no system Git, Node, pnpm, compiler or source installation. Optional tool binaries and models retain their existing profile-aware installation policy.

Runtime code lives under `LEON_HOME/runtimes/core/versions/<version>`; profiles remain outside it. A candidate that fails startup restores the previous code version. Profile migrations are retryable and tracked per profile; code recovery does not undo data migrations, so migrations must remain compatible with the supported recovery window. Older runtimes are pruned after readiness while retaining recovery and any running launcher.

Leon has one product version and release notes. Core archives and desktop installers remain different artifacts: Core includes the locally served web frontend, while the desktop artifact contains Electron and native integration. This pipeline publishes Core archives. The prepared desktop workflow attaches signed installers from the same commit to the matching `v<version>` release; it remains inactive until desktop integration and native verification are complete.


## Desktop delivery

The update dialog presents one **Update Leon** action. Browsers update their server; desktop clients coordinate available server and app payloads, waiting for a successful server receipt before replacing the app. A failed server update never triggers app replacement. Native updates remain accessible when server discovery fails. Component versions are available in optional installation details. Aurora previews cover browser, desktop, combined updates and first-time Core setup.

Source setup and the compiled prebuilt entry point both call `scripts/setup/setup-profile.js`. It owns the ordered profile preparation: directories, configuration, Python bridge environment, authentication/encryption keys, instance identity, migrations and tool/skill settings. Source-only callbacks supply runtime downloads and dependency installation; prebuilt setup binds bundled packages. The entry point does not maintain a second profile setup sequence.

During an accepted Core update, the browser requests native leave confirmation while installation is active. Accepting closes the page while the host continues installation; declining keeps the page open. Browser policy controls whether a prompt is shown and its wording. The handler is removed after completion/failure, including before the automatic post-update reload. Electron confirms window closing through native unload handling and keeps transport state intact when closing is cancelled.

Browser clients see a reconnect loader while Core is stopped; the managed desktop host reads the public update receipt locally so profile preparation and restart remain visible.

Desktop releases require native installers and platform verification. macOS uses Developer ID signing, hardened runtime and notarization; Windows uses timestamped Authenticode signatures; Linux provides AppImage and Debian packages. Installer replacement and relaunch are performed by the desktop updater, leaving Core and profiles in their managed home. Debian installation can request administrator authentication.

The desktop publisher verifies the exact product release version and commit, then attaches immutable installers before advancing its app-update metadata. Its small channel-pointer releases contain delivery metadata, not a separate product version or changelog. A release without desktop installers leaves the existing app-update pointer intact. Desktop signing credentials belong only in protected CI secrets, never application configuration or release assets.
