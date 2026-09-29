---
name: media-production
description: Generate images, audio and videos, combine assets into finished media, inspect the result and deliver playable artifacts.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Media Production

1. Establish the desired output, duration, aspect ratio and supplied reference material. A single image or speech request usually needs only its generation tool.
2. Use `generate` with the desired prompt and output options; Core resolves tool settings, inheriting the active conversation provider by default. If `selection_required` is returned, ask the owner which available provider to use; never silently switch accounts. Use `configure` only when they request a saved preference. Inspect `capabilities.defaults` when setup needs diagnosis. Reserve `generateWithModel` for an explicitly owner-requested provider/model; never pick an older model from memory or bypass a default after an error.
3. Generate assets with `media_generation.image`, `audio` and `video`. Reuse existing local speech tools when they fit. MiniMax music requires an eligible account.
4. A video `job_id` means pending work. Poll `video.status` at reasonable intervals until completed or failed; never submit another generation to check progress. Retain the job ID across continuation.
5. Use existing FFmpeg and FFprobe tools for composition, conversion and validation. Inspect representative frames and audio/duration before claiming the result is verified.
6. Generated artifacts are attached automatically. Attach composed/local files through `operating_system_control.file.attach` so the owner receives a player or download. Do not expose provider URLs, credentials or base64 in chat.
