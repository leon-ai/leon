---
name: document-authoring
description: Create, inspect, revise and deliver PDFs, Word documents, spreadsheets and presentations as conversation artifacts.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Document Authoring

1. Establish the requested format, audience and content. Reuse supplied source material.
2. Inspect `media_generation.document.capabilities`. Use `generate` with tool defaults (inheriting the conversation provider) for hosted generation; reserve `generateWithModel` for an explicitly owner-requested provider/model, or `create` for local PDF/DOCX. Use existing file writing for plain text, CSV, Markdown and source files.
If hosted generation returns `selection_required`, ask the owner to select a provider or use local PDF/DOCX creation when it satisfies the request. Save a choice with `configure` only if asked to remember it.

3. Use structured content and readable typography. For multilingual PDFs select an installed font covering the text; do not silently produce missing glyphs.
4. Inspect the resulting content with the file tool. Render PDF pages with `readPdf` and inspect layout. For Word/Office files use an available renderer to inspect a PDF export; disclose when only structural/content checks were possible.
5. Fix clipped text, missing content or layout defects before delivering the final revision. A provider's success response alone is not a quality check.
6. Generated files already have artifact references. For existing files use `operating_system_control.file.attach`. Do not duplicate attachments, paste base64, or use server-local file markers as downloads.
