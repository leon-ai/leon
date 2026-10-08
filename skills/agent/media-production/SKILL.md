---
name: media-production
description: Generate and edit images, vector artwork, photos, audio and video; inspect results and deliver finished artifacts.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Media Production

1. Establish the desired output, duration, aspect ratio and supplied reference material. A single image or speech request usually needs only its generation tool.
2. For hosted image generation, use `media_production.image.generate` with the desired prompt and output options; Core resolves tool settings, inheriting the active conversation provider by default. If `selection_required` is returned, ask the owner which available provider to use; never silently switch accounts. Use `configure` only when they request a saved preference. Inspect `capabilities.defaults` when setup needs diagnosis. Reserve `generateWithModel` for an explicitly owner-requested provider/model; never pick an older model from memory or bypass a default after an error.
3. Generate image assets with `media_production.image`. Use existing `music_audio` speech tools for narration and owner-supplied audio or video clips for other media assets.
4. For local production, use `media_production.photocraft` for layered raster edits, `vectorcraft` for vector artwork, `hyperframes` for social videos and motion graphics, `filmcraft` for timelines, and `lightcraft` for photo development. These tools run headlessly; PhotoCraft desktop control is optional. For Craft tools, discover commands and parameter schemas before edits, inspect the source, and use returned object/media IDs instead of guessing. Ordinary edits produce new artifacts while preserving originals. Keep referenced media available and use absolute asset paths. Select persistent LightCraft libraries only when the owner requests library work.
5. For an authored social video or motion graphic, establish a short storyboard and consistent visual direction: one main idea per scene, readable typography at phone size, deliberate spacing, a focused palette, and useful visual assets. Match pacing to the brief; avoid walls of small text, repeated generic panels and gratuitous effects. Use `hyperframes.create` for a new project and the file tool to author its HTML, CSS and scene timelines. Look for suitable catalog components before inventing complex effects. Preserve supplied source by working in a copy. Tool guidance owns the composition and animation contract.
6. Run a full strict Hyperframes check, inspect representative animation frames, and review the rendered video before delivery.
7. Preview edited artwork and representative timeline/composition positions. Use existing FFmpeg and FFprobe tools for simple composition, conversion and validation. Inspect frames and audio/duration before claiming the result is verified. Wait for background renders to complete before delivery.
8. Generated and edited artifacts are attached automatically. Attach other composed/local files through `operating_system_control.file.attach` so the owner receives a player or download. Do not expose provider URLs, credentials or base64 in chat.
