# Download sources

Leon prefers verified Chinese mirrors when the downloading machine's network exit is in China. Explicit registries, mirrors, credentials and proxy settings take precedence. Pinned versions, integrity checks and the **36-hour registry dependency cooldown** remain enforced.

Set `LEON_DOWNLOAD_REGION` before starting pnpm or Leon: `auto` (default), `cn` or `global`. For example, `LEON_DOWNLOAD_REGION=cn pnpm install`; in PowerShell, set `$env:LEON_DOWNLOAD_REGION = 'cn'` first. `global` retains original defaults without removing explicit mirror settings.

Automatic detection uses a bounded, cached request to `https://ipapi.co/country/`. Only the country decision is stored; no IP address is saved. A VPN/proxy affects the result. Profile location, language and timezone do not select mirrors. Failed detection retains original sources.

| Download | Chinese source |
| --- | --- |
| Public npm packages | `registry.npmmirror.com`, selected before package fetching; private/custom registries stay unchanged. |
| Managed uv's Python dependencies | Tsinghua PyPI, then original PyPI when eligible mirror artifacts or upload timestamps are unavailable. |
| Playwright browsers and its FFmpeg, Electron, Node.js/headers | npmmirror binaries through each installer's native configuration. |
| Standalone Python | npmmirror's exact upstream release asset, verified against upstream SHA-256. |
| pnpm, uv, jq, llama.cpp, llmfit, Leon binaries and server archives | GH-Proxy for allowlisted repositories with trusted release checksums. |
| Public Hugging Face weights | `hf-mirror.com`, verified against original LFS SHA-256 metadata; authenticated/custom endpoints stay unchanged. |
| Desktop icon converter | Verified npmmirror artifact, preserving the converter's pinned integrity checks. |

Leon-owned transfers use the [shared downloader](../../bridges/runtime/nodejs/file-downloader.ts), retry the original source on mirror failure/checksum mismatch, and isolate partial files by source. There is no blanket GitHub rewrite: unlisted origins and URLs with credentials, queries or fragments stay unchanged.

Managed uv retries an automatically selected mirror installation once against original PyPI; missing timestamps never bypass the cooldown. Owner-defined indexes/strategies retain their own behavior. Other external installers select verified native mirror settings and keep their retry behavior; availability checks cannot guarantee every artifact or network connection.

Docker pulls and initial system Node.js/pnpm installation happen before Leon's hooks and require separate bootstrap configuration. Source selection lives in [download-sources.js](../../bridges/runtime/nodejs/download-sources.js); region detection lives in [download-region.js](../../bridges/runtime/nodejs/download-region.js).
