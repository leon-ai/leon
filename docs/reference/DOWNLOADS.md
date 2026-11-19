# Download sources

Leon selects supported Chinese mirrors when the machine downloading dependencies or assets has a Chinese network exit. The early pnpm configuration hook runs before package fetching, so a normal `pnpm install` can use the public npm mirror, including transitive dependencies. Private scopes, custom registries, credentials, pinned versions, lockfile integrity and the strict 36-hour dependency cooldown remain in effect.

`LEON_DOWNLOAD_REGION` accepts `auto` (default), `cn` or `global`. Set it in the shell or CI environment before starting pnpm or Leon. For example, `LEON_DOWNLOAD_REGION=cn pnpm install` forces Chinese sources; `LEON_DOWNLOAD_REGION=global pnpm install` retains original sources. PowerShell users can set `$env:LEON_DOWNLOAD_REGION = 'cn'` first. This setting does not undo explicitly configured third-party mirrors.

Automatic detection contacts `https://ipapi.co/country/` with a one-second deadline. Only the country decision is cached, under `${XDG_CACHE_HOME:-~/.cache}/leon/downloads/`; no IP address is saved. Successful detection lasts six hours; unavailable detection retains original sources for five minutes. Explicit overrides skip geolocation. A VPN or proxy can change the detected network exit. The owner's profile location, language and timezone are not used.

| Download | Chinese source | Selection and verification |
| --- | --- | --- |
| Public npm packages | `registry.npmmirror.com` | Default public registry only; pnpm retains package integrity and release-age checks. |
| Python dependencies installed by managed uv, including OCR and bridge packages | Tsinghua PyPI (`pypi.tuna.tsinghua.edu.cn/simple/`), then original PyPI | Prefer eligible mirror artifacts; search original PyPI when mirror metadata is missing or fails the release-age policy. Explicit index environment/configuration takes precedence. |
| Playwright browsers, headless shell and Playwright's FFmpeg | npmmirror Playwright binaries | Uses `PLAYWRIGHT_DOWNLOAD_HOST`; per-browser overrides remain effective. |
| Electron downloads | npmmirror Electron binaries | Uses Electron's native mirror setting and retains explicit settings. |
| Managed Node and native build headers | npmmirror Node binaries | Exact original version/platform paths; header installers use their native distribution URL setting. |
| Managed standalone Python | npmmirror python-build-standalone binaries | Leon downloads the same GitHub release asset and verifies its upstream SHA-256; uv's own Python bootstrap uses its native mirror setting. |
| Managed pnpm, uv, jq, CMake, Ninja, llama.cpp, llmfit, Leon binaries and Core release assets | GH-Proxy | Only the repositories listed in the shared source policy; requires a declared SHA-256 or a matching digest fetched from GitHub release metadata. |
| Public Hugging Face model weights | `hf-mirror.com` | Requires public repository metadata and the file's LFS SHA-256 from Hugging Face; explicit authenticated/endpoint settings stay on the original source. |

Leon-owned transfers try the selected mirror first and fall back to the original source on failure or checksum mismatch. Mirror and original partial files are isolated, so retries cannot combine bytes from different sources. Release metadata checks are bounded to two seconds; unavailable trusted metadata retains the original source. URLs containing credentials, queries, fragments, or unlisted origins are not rewritten. Existing model/binary cache identities remain based on their canonical sources.

Managed Python dependency installs use uv's ordered `unsafe-first-match` search only for the two equivalent public PyPI endpoints. Missing upload timestamps never disable the 36-hour cooldown. If the automatically selected mirror installation fails, Leon retries once with original PyPI alone, retaining the same dependencies and root policy. The mirror attempt defaults to a 15-second HTTP timeout with no internal HTTP retries; explicit uv timeout/retry settings remain effective. This retry also covers failures while fetching wheel archives. Owner-defined indexes or index strategies, including file configuration, do not receive automatic public fallback.

Other external installers generally accept one mirror host. Leon checks availability with a one-second deadline before selecting their native settings; if that check fails, it retains their original configuration. A failure after selection follows the external installer's retry behavior. Use `global` to retry with original defaults. These checks cannot guarantee that every artifact exists at a mirror or that the original source is reachable.

There is no blanket GitHub rewrite. Source archives, private/signed downloads, unsupported tools and package-specific binary installers without a verified native mirror retain their original sources. Playwright's FFmpeg and Leon's declared FFmpeg binaries are separate builds; one never substitutes for the other. Docker image pulls happen before Leon starts and require runner/daemon configuration. Installing the initial system pnpm or Node also happens before the project hook and requires the owner's bootstrap configuration.
