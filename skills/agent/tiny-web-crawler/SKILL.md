---
name: tiny-web-crawler
description: Crawl from one or more starting web pages, fetch readable content, search within pages, follow relevant links, and stop when the requested information is found or a bounded limit is reached.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Tiny Web Crawler

Use this skill to inspect web pages by fetching content, searching within it, and following relevant links from the starting page.

## Scripts

Use the bundled scripts for the actual web fetching and bounded crawling:

- `scripts/fetch-page.mjs`: fetch one page, extract compact readable text, links, and query snippets.
- `scripts/crawl-web.mjs`: crawl from one or more start URLs, follow relevant links, and stop at limits or strong matches.

Run scripts with a portable Node binary. Resolve Node in this order:

1. `$LEON_HOME/bin/node/bin/node` when `LEON_HOME` is set.
2. `node` from `PATH`.

Example:

```bash
"$LEON_HOME/bin/node/bin/node" scripts/crawl-web.mjs --url "https://example.com" --query "target phrase" --max-pages 8 --max-depth 2
```

If `LEON_HOME` is not set or that path does not exist, use `node scripts/crawl-web.mjs ...`.

## Workflow

1. Clarify the target only when the requested information or starting point is ambiguous.
2. Start from the owner-provided URL when one is given.
3. Use `scripts/crawl-web.mjs` to fetch pages, search within content, and follow relevant links.
4. Use `scripts/fetch-page.mjs` for one-off page inspection or deeper inspection of a promising page.
5. Start with compact fetches. Read full or later text chunks only when snippets, title, or links show the page is likely relevant.
6. Search within fetched content for exact names, phrases, dates, numbers, headings, or nearby synonyms.
7. Track visited URLs and do not revisit the same page.
8. Stop as soon as the target information is found with enough context to answer.
9. If the limit is reached, report what was checked and what remains unresolved.

## Limits

Default limits unless the owner specifies otherwise:

- Max pages: 8
- Max link depth from the starting page: 2
- Max pages from the same domain: 5

Prefer stopping early over crawling broadly.

## Progressive Fetching

`fetch-page.mjs` returns compact output by default:

- `textPreview`: short readable preview
- `snippets`: query matches with nearby context
- `links`: normalized URLs with short labels and context
- `chunk.hasMore` and `chunk.nextOffset`: use these to fetch more text only when needed

For deeper inspection, use `--include-text --offset <number> --max-text-chars <number>`.

## Link Selection

Prioritize links whose text, URL, title, surrounding text, or page structure mentions:

- The requested entity, topic, product, person, organization, date, or identifier
- Words such as docs, documentation, reference, API, pricing, changelog, release, support, help, FAQ, blog, news, about, contact, terms, policy, source, repository, issue, or discussion when relevant
- Internal pages that appear canonical before third-party summaries

Avoid links that are likely unrelated, duplicated, navigational noise, ads, tracking links, login-only pages, or broad category pages unless they are the best available path.

## Evidence Rules

- Cite the pages used to answer.
- Prefer primary sources over summaries.
- Distinguish directly found facts from inference.
- Do not claim the information was found if only adjacent or partial evidence was found.
- If sources conflict, say so and compare publication or update dates when available.
- Keep quoted text short and use paraphrase for most source content.

## Output

Answer directly first.

Then include concise source notes:

- Pages checked when useful
- The decisive source URL
- Any remaining uncertainty

If the target was not found, state that clearly and summarize the most relevant places checked.
