# Working on Leon AI

Read [ARCHITECTURE.md](core/context/ARCHITECTURE.md) for runtime boundaries and [LEON.md](core/context/LEON.md) for intended behavior. Verify the relevant source before changing a subsystem; these context files are generated summaries.

## Workflow

- For a new goal, inspect the existing implementation and confirm the plan with the owner before changing code.
- Use `pnpm`, never npm. Keep changes minimal; reuse existing SDK facilities and `server/src/helpers/` before adding abstractions. Remove superseded logic rather than maintaining parallel implementations.
- Preserve unrelated working-tree changes and profile isolation. Use existing profile/path/runtime utilities instead of hardcoded owner paths, runtime versions, or global mutable owner state.
- Run `pnpm lint`, fix warnings/errors, and run checks relevant to the change. Keep tests focused on meaningful behavior and regressions; avoid redundant tests.
- Agent e2e tests must use `pnpm test:agent:e2e -- -t openai` unless the owner explicitly requests other providers.
- Suggest a commit message matching `scripts/commit-msg.js`; do not commit unless asked.

## Tools

- Keep application/device-specific behavior in tools, orchestration in skills, and generic execution/transport in Core. Follow `tools/video_streaming/ffmpeg/` and the parent SDK classes before implementing a tool.
- Preserve the tool's existing directory layout. Actual implementations belong in `src/nodejs/` or `src/python/`: Node.js extends SDK `Tool` and exports through `index.ts`; Python extends SDK `BaseTool` and follows the package exports. Supporting scripts belong under the implementation's `lib/`, not in a language folder implying another SDK implementation.
- Use `ToolkitConfig` and inherited settings, validation, reporting, command and binary facilities. Keep tool-specific connection checks in the tool; do not create another settings loader or installer.
- Declare source-local dependencies in `package.json` and/or `pyproject.toml`. Reuse `scripts/setup/setup-tools-dependencies.js` and `sync-source-dependencies.js`; setup supplies managed Node.js, Python, pnpm and uv.
- `tool.json` owns function schemas, descriptions, progressive guidance, and binary/resource declarations. Avoid separate instruction-fetching functions and duplicated guidance.
- Expose ordinary SDK tool methods. Do not introduce a Core provider or `execution` override to implement a tool; propose changes to shared runtime contracts first if something is missing.

## Bridge SDKs

- Add to a bridge SDK only when the capability is used across several skills or tools. Otherwise keep it in the specific skill or tool; avoid speculative shared APIs.
- Any shared SDK change must have equivalent behavior in both Node.js and Python, following each language's conventions. Keep host-specific transport internals outside the public SDK.

## Skills

- Native skills: `skills/native/<skill>/`, with `skill.json`, `locales/`, and action entry points in `src/actions/`. Follow the selected bridge's SDK conventions. Put reusable code in `src/lib/`, widgets in `src/widgets/`, and use SDK settings/memory APIs and declared tools. Examples: `timer_skill` (Node.js), `random_number_skill` (Python).
- Agent skills: `skills/agent/<skill>/SKILL.md`, with discovery frontmatter and concise workflow instructions; optional supporting scripts live in `scripts/`. They guide Leon's existing agent loop and tool calls. Follow `tiny-web-crawler`; do not build a second agent loop or native action manifest.

## Context files

- Maintain generated context through `server/src/core/context-manager/context-files/`. Update the relevant generator and regenerate through the context manager; do not maintain a separate hand-edited generated copy.
- Keep `LEON.md` and `ARCHITECTURE.md` limited to major behavioral/architectural facts. Tool usage details belong in tool guidance; task workflows belong in skills.

## Code style

- Avoid hardcoded behavioral keywords, regex rules, paths, and configuration when existing schemas/settings/utilities provide them.
- Put file-local constants near the top; shared server constants belong in `server/src/constants.ts`. Use numeric separators (`3_600`) and enums for meaningful states.
- Comment non-trivial decisions and edge cases, not obvious assignments. Use `//` for JS/TS implementation comments, including multiline implementation comments; preserve existing double-slash comments. Use multiline JSDoc for exported APIs and reusable helpers, never single-line `/** ... */`. Use Python comments/docstrings where appropriate.
- In `web-app/`, inspect installed TanStack packages first: Router for routing, Query for server state, Virtual for long lists. Propose a missing package before adding it; avoid custom replacements when an installed package fits.

JSDoc format:

```ts
/**
 * The comment
 */
```
