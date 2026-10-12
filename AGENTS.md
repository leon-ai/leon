# Working on Leon AI

Read [ARCHITECTURE.md](core/context/ARCHITECTURE.md) for runtime boundaries and [LEON.md](core/context/LEON.md) for intended behavior. Verify the relevant source before changing a subsystem; these context files are generated summaries.

## Workflow

- For a new goal, inspect the existing implementation and confirm the plan with the owner before changing code.
- Use `pnpm`, never npm. Keep changes minimal; reuse existing SDK facilities and `server/src/helpers/` before adding abstractions. Remove superseded logic rather than maintaining parallel implementations.
- Preserve unrelated working-tree changes and profile isolation. Use existing profile/path/runtime utilities instead of hardcoded owner paths, runtime versions, or global mutable owner state.
- Run `pnpm lint`, fix warnings/errors, and run checks relevant to the change.
- Test current behavior with minimal coverage; extend existing suites. Trivial changes need no new tests.
- Do not create test files or add test cases for SDKs, tools or skills unless the owner explicitly requests them, regardless of where the tests would live. Run existing affected tests and adjust them for compatibility when necessary.
- Review only affected tests. Retain unique runtime contracts regardless of bug-fix origin; remove obsolete or duplicate reproductions.
- Use `pnpm test:unit` for fast feedback and `pnpm test:integration` for real worker, download, capture, and rendering changes; `pnpm test` includes both.
- Agent e2e tests must use `pnpm test:agent:e2e -- -t openai` unless the owner explicitly requests other providers.
- Suggest a commit message matching `scripts/commit-msg.js`; do not commit unless asked.

## Setup migrations

- Keep migration implementations self-contained under `scripts/setup/migrations/`. Do not introduce shared migration helpers or import another migration's implementation.
- Name migrations `YYYYMMDDHHmmssSS-description.js` using UTC, a fixed-width 16-digit timestamp, and a lowercase kebab-case description. `SS` is hundredths of a second. Generate the timestamp with `date -u +%Y%m%d%H%M%S%2N`; never use local time.
- The setup runner executes pending migrations from oldest to newest filename timestamp and records completion separately for each profile. Export a default `async migrate(profilePaths)` function and make it safe to retry after interruption.
- Preserve published migration filenames. If a rename is necessary, export the former filenames in `previousIds` so completed work is recognized without running it again.

## Tools

- Keep application/device-specific behavior in tools, orchestration in skills, and generic execution/transport in Core. Follow `tools/video_streaming/ffmpeg/` and the parent SDK classes before implementing a tool.
- Keep each tool self-contained. Duplicate small application-specific helpers when appropriate; do not introduce toolkit-level source folders. Put generic capabilities in SDK helpers when they avoid repeated dependencies or meaningful implementation duplication.
- Preserve the tool's existing directory layout. Actual implementations belong in `src/nodejs/` or `src/python/`: Node.js extends SDK `Tool` and exports through `index.ts`; Python extends SDK `BaseTool` and follows the package exports. Supporting scripts belong under the implementation's `lib/`, not in a language folder implying another SDK implementation.
- Use `ToolkitConfig` and inherited settings, validation, reporting, command and binary facilities. Keep tool-specific connection checks in the tool; do not create another settings loader or installer.
- Declare source-local dependencies in `package.json` and/or `pyproject.toml`. Reuse `scripts/setup/setup-tools-dependencies.js` and `sync-source-dependencies.js`; setup supplies managed Node.js, Python, pnpm and uv.
- Do not add nested `pnpm-workspace.yaml` files to tools, skills, bridges or generated tool projects. Keep shared build policy in the repository root; the shared installer carries it into independent source installs. Keep application-specific dependency compatibility rules in a source-local `.pnpmfile.mjs` hook, and include that hook in generated projects and source exports that need it.
- Before adding a dependency, inspect existing packages and SDK helpers. Prefer an existing package at a compatible pinned version. Keep application engines and assets tool-local; consider a bridge-owned package behind a generic SDK helper for reusable infrastructure. Judge each dependency individually instead of moving application behavior into the SDK merely to reduce package manifests.
- `tool.json` owns function schemas, descriptions, progressive guidance, and binary/resource declarations. Avoid separate instruction-fetching functions and duplicated guidance.
- Expose ordinary SDK tool methods. Do not introduce a Core provider or `execution` override to implement a tool; propose changes to shared runtime contracts first if something is missing.

## Bridge SDKs

- Organize generic helpers under `sdk/utils/`. Preserve existing public utility imports when reorganizing modules.
- Add small generic SDK capabilities when they serve shared infrastructure needs and avoid repeated dependencies or meaningful duplication. Keep application-specific behavior in its tool and avoid speculative shared APIs.
- Declare SDK helper dependencies in the corresponding bridge's own manifest. Bridges must not rely on Core's `node_modules` or import Core helpers for dependency reuse. Compatible package versions can share pnpm's store without sharing runtime ownership; prefer standard-library equivalents where available.
- Any shared SDK change must have equivalent behavior in both Node.js and Python, following each language's conventions. Keep host-specific transport internals outside the public SDK.

## Skills

- Native skills: `skills/native/<skill>/`, with `skill.json`, `locales/`, and action entry points in `src/actions/`. Follow the selected bridge's SDK conventions. Put reusable code in `src/lib/`, widgets in `src/widgets/`, and use SDK settings/memory APIs and declared tools. Examples: `timer_skill` (Node.js), `random_number_skill` (Python).
- Agent skills: `skills/agent/<skill>/SKILL.md`, with discovery frontmatter and concise workflow instructions; optional supporting scripts live in `scripts/`. They guide Leon's existing agent loop and tool calls. Do not build a second agent loop or native action manifest.

## Context files

- Maintain generated context through `server/src/core/context-manager/context-files/`. Update the relevant generator and regenerate through the context manager; do not maintain a separate hand-edited generated copy.
- Keep `LEON.md` and `ARCHITECTURE.md` limited to major behavioral/architectural facts. Tool usage details belong in tool guidance; task workflows belong in skills.

## Comments, documentation and tests

- Explain Leon's lasting requirements: what behavior is needed, why the code or configuration exists, and how it serves Leon. Write for a contributor who has never seen the task, conversation, bug report or PR.
- Do not use comments, documentation or tests as a record of the current change. Avoid upgrade narratives, incidental version details, temporary debugging context, and explanations centered on the specific incident that prompted the work. Keep change history in commit messages, PR descriptions or dedicated migration notes.
- Tests must express a lasting, observable contract through their names, fixtures and assertions. A bug can reveal a missing contract, but reproducing an incident alone is not a reason to add or keep a test. Preserve distinct contracts; remove redundant or obsolete cases.
- Before adding or editing any comment, documentation or test, check: would this still explain a necessary behavior to someone who knows nothing about the introducing change? If not, rewrite it around the general requirement or omit it.

## Code style

- Use braced, multiline control flow. Do not put an if, loop, try/catch, or function body on one line. Split long calls, object literals, and nested conditions across lines so the code is easy to scan; follow the surrounding style.
- Use blank lines to separate logical steps. Keep related declarations together, then add a blank line before the scope starts doing work. Separate validation, execution, cleanup, and return sections when it improves readability; follow the surrounding spacing rather than packing statements together or separating every line.
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
