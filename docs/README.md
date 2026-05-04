# Leon Docs

This folder contains the Leon 2.0 documentation app.

## Development

```sh
pnpm --dir docs install
pnpm run dev:docs
```

The docs app uses Fumadocs, MDX, and Next.js.

## LLM Files

The app exposes:

- `/llms.txt`
- `/llms-full.txt`
- per-page Markdown-oriented output through `*.mdx` routes
