---
name: document-authoring
description: Create, inspect, revise and deliver charts, PDFs, Word documents, spreadsheets and presentations as conversation artifacts.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Document Authoring

1. Establish the requested format, audience and content. Reuse supplied source material.
2. Choose the creation tool based on the requested output:
   - Charts: use `media_generation.echarts.render` with one named entry per requested chart and native ECharts JSON options. Ground the values in supplied/retrieved data, label units, and select only the requested image formats. Each chart becomes a separate SVG/PNG artifact. Use both formats when a vector document figure and raster preview are useful. Inspect a PNG preview and fix clipping or misleading axes before delivering it. Do not use image-generation models to invent or redraw quantitative charts.
   - PDF: write a local `.typ` source with the file tool, then call `media_generation.typst.compile`. Keep the source and selected assets together in a project directory. Use the smallest `rootPath` containing that project. Built-in/local assets require no generation-provider account or package download.
   - Editable Word: use `media_generation.document.create` with `format=docx`. Typst does not export DOCX.
   - SVG/PNG: compile Typst with the requested format. Each selected page becomes an image artifact. For a standalone figure, set the page dimensions to fit the figure rather than exporting a full report page.
   - Plain text, CSV, Markdown and source files: use existing file writing.
   - Hosted generation or Office formats requiring a provider: inspect `media_generation.document.capabilities`, then use `generate` with the configured defaults. Reserve `generateWithModel` for an explicitly owner-requested provider/model.

If hosted generation returns `selection_required`, ask the owner to select a provider or use local Typst/DOCX creation when it satisfies the request. Save a choice with `configure` only if asked to remember it.

3. Use readable typography, consistent headings and generous spacing. Typst source supports tables, lists, equations, references and figures; use these instead of flattening everything into paragraphs. Generate chart assets with `echarts.render` or reuse supplied SVG/PNG assets. For PDFs, copy selected assets into the Typst project with the shell tool, embed them with `image` inside `figure`, and add a useful caption. For DOCX, pass each selected absolute artifact path in `content.sections[].images` with `caption` and `altText`; the writer preserves proportions and includes PNG fallbacks for SVG. Images follow the section's paragraphs, so use separate sections to position figures between text blocks. Keep chart values grounded in supplied or retrieved data. Use `typst.listFonts` before choosing multilingual fonts, and provide local `fontPaths` when needed. Inspect compiler diagnostics and fix unknown fonts or layout warnings; do not silently produce missing glyphs. Preview-package imports may download missing packages, so avoid them for offline work.
4. Inspect the resulting content with the file tool. Render PDF pages with `readPdf` and inspect layout. For Word/Office files use an available renderer to inspect a PDF export; disclose when only structural/content checks were possible.
5. Fix clipped text, missing content or layout defects before delivering the final revision. A provider's success response alone is not a quality check.
6. Generated files already have artifact references. For existing files use `operating_system_control.file.attach`. Do not duplicate attachments, paste base64, or use server-local file markers as downloads.
