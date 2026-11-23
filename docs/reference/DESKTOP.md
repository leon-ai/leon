# Desktop

**Leon (Alpha)** is an Electron host in `apps/desktop/` using the shared web app. It opens the root/new-session page, automatically connects to a compatible Core or prepares one, and shows progress, details and retry controls when needed.

| Operation | Runtime and behavior |
| --- | --- |
| Download Core | Electron's built-in Node.js runs Leon's shared downloader. It selects a GitHub Release archive for the machine, verifies its size/SHA-256 and extracts it. |
| Prepare profiles | The archive's own Node.js runs compiled setup, sharing `scripts/setup/setup-profile.js` with source installations. Profiles, credentials and migrations follow the same setup sequence. |
| Start Core | Electron spawns the managed Node.js binary, which runs a detached supervisor and launches the compiled server. A compatible running Core is reused. |

**Prebuilt installations need no system Git, Node.js, pnpm or Python.** Core archives include their runtimes and dependencies; optional models and tool binaries follow normal setup policy. Keeping Core's Node.js separate allows it to run and update independently of Electron.

Storage defaults to `~/.leon/`, overridden by `LEON_HOME`:

- `runtimes/core/versions/<version>/`: immutable Core installations; `active.json` selects one.
- `runtimes/core/downloads/`: temporary archives, removed after successful extraction.
- `profiles/<profile>/`: profile data, preserved across updates.
- `desktop/`: installation selection, supervisor configuration and logs.

On macOS, the red cross hides the window and preserves its draft; the Dock restores it. **Cmd+Q** quits Desktop. Core survives quitting Desktop. The native **Core** menu provides start/stop, logs and opt-in startup at sign-in, using launchd, systemd user services or Windows Task Scheduler. Native turn-completion notifications work while Desktop runs, including hidden/minimized; they contain no answer content and reject cross-profile events and replay.

UI preferences use the renderer's `localStorage`, backed by `servers/<server-hash>/preferences.json` under Electron's user-data directory (`~/Library/Application Support/Leon/` on macOS). Theme, accent, sidebar, sound and recent-model preferences are isolated per server; regular browsers keep their own copies. Core-owned settings remain in the profile. Credential persistence initializes OS encryption lazily through async APIs; local ad-hoc macOS builds keep authentication in memory while retaining preferences on disk.

Electron retains the main window's size, position and display state across launches. The draggable title bar follows Leon's saved Light/Dark/System preference, keeps native window controls and shares the sidebar border color. The macOS Dock icon follows the OS appearance independently.

Desktop uses Cmd/Ctrl+O for a new session (Shift+O remains an alias), Cmd/Ctrl+K for search and Cmd/Ctrl+, for settings. Cmd/Ctrl+W hides the main window on macOS or minimizes it on Windows/Linux; account and artifact popups close normally. Native menus retain editing, zoom and full-screen controls. Browser new-session shortcuts keep Shift to leave Open to the browser.

Desktop requires Core at or above its build version, below the next major, and with the same desktop protocol. Download selection skips unsupported platforms/protocols; incompatible running servers are rejected. Desktop-initiated updates validate compatibility before installation. Independently updating Core can require a newer Desktop. See [releases and OTA](RELEASING.md) and [download sources](DOWNLOADS.md).

After normal repository setup, run `pnpm build:server`, `pnpm build:desktop`, then `pnpm start:desktop`. The repository launcher supplies its checkout through `LEON_CODEBASE_PATH`; `pnpm start:desktop --server http://127.0.0.1:5366` connects without managing that server. Desktop has its own workspace manifest and shares the root version/lockfile.

`pnpm test:desktop` checks host contracts. After building diagnostics with `node apps/desktop/scripts/build.mjs --diagnostics`, `pnpm check:desktop` runs hidden checks with disposable profiles. `pnpm bench:desktop --runs 3` measures macOS host resources, excluding Core/models; it does not establish visible GPU performance or other-platform results. Generated output and signing material stay out of Git.

macOS uses layered `packaging/Leon.icon` artwork with Xcode 26+; local fallback builds select full-resolution light/dark images with a static shiny rim. Their bundled ICNS matches macOS appearance at build time to prevent a different icon on exit; rebuild that fallback after changing OS appearance. The native layered source has no baked lighting. OS icon rendering, notification delivery and signed installer/update behavior require native verification.
