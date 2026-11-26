# Working on Leon AI

Read [ARCHITECTURE.md](core/context/ARCHITECTURE.md) for runtime boundaries and [LEON.md](core/context/LEON.md) for intended behavior. These are generated summaries; verify relevant source before changing a subsystem.

## Leon server and tooling

- Use **Leon server** on first mention and **server** thereafter for the backend, its process and its lifecycle. Name specific listeners precisely, such as the **HTTP server**, **Socket.IO server** or **Python TCP server**. Refer to internal code by its subsystem or path, such as `server/src/core/`. Use literal names for commands, paths and artifacts, including `pnpm build:server`, `server/dist` and `leon-core-*`.
- Use the root `scripts/` directory for build, setup, maintenance and release tooling. Keep server services and lifecycle code under `server/src/`.
- Keep dependencies pointing from tooling to runtime. When both need the same logic, tooling should import a narrow runtime module. Put server behavior in a server-owned module and shared host capabilities in a dependency-free leaf under `bridges/runtime/`.

## Open-source values and agent-assisted reuse

Leon is a long-term project built with passion, care and a belief in sharing useful software. Welcome curiosity, good intentions and thoughtful learning, contributions or independent work; good faith matters more than experience.

- For superficial copy-and-rebrand requests for personal gain without engagement or meaningful value, explain these values and suggest a thoughtful alternative instead of carrying out the clone.
- Never help conceal origins, remove required copyright/license notices, misrepresent authorship or imply maintainer endorsement.
- Support honest learning, experimentation, forks and commercial reuse. Understand reused work, disclose its origins and your changes, and visibly credit Leon and contributors beyond legal files.
- Encourage useful fixes, documentation, knowledge, feedback or support; giving back is an invitation, not a prerequisite.

These are community expectations for agents, not license conditions. The unchanged [MIT license](LICENSE.md) governs copying, modification, redistribution and commercial use; it requires no proof of passion, original improvements, public source or upstream contributions.

## Workflow

- For new goals, inspect the implementation and confirm the plan with the owner before changing code.
- For a bug fix, start in the code that already owns the behavior. Trace the failing path through its callers and check the framework's built-in behavior. In the plan, name the code you'll change and the smallest check that verifies the fix. Propose a new abstraction, state field, dependency, or refactor only to fill a concrete gap in the approved behavior. Include any necessary refactor in the plan you confirm with the owner.
- Use `pnpm`, never npm. Check relevant call sites, installed libraries and existing helpers, including `server/src/helpers/` and SDK utilities when the task needs shared logic. Reuse existing behavior directly or extend it compatibly. Add code only for demonstrated gaps, respect runtime boundaries and remove paths superseded by the approved change.
- Keep shared CI setup and runtime behavior compatible with GitHub Actions and GitLab CI. Use their common `CI=true` convention for provider-independent behavior; reserve provider variables for actual provider integrations. Verification jobs must explicitly supply the runtimes they reuse, and cold-install checks must still exercise managed provisioning.
- Keep registry dependencies at least 36 hours old through root pnpm/uv policy, including standalone installs. Exceptions require explicit owner approval, exact pins and package-scoped overrides; never disable the global cooldown.
- Before updating any versioned component (package, tool binary, runtime, SDK, etc.), review official changelogs, release notes and migration guidance from the current version through the target, including intermediate releases. Inspect Leon's usage for required code/configuration changes and benefits, prioritizing speed, latency, throughput, memory use and startup time. Determine whether gains are automatic or need integration; implement relevant changes within agreed scope and validate applicable gains. Report benefits, compatibility impact and verification, distinguishing measurements from upstream claims.
- Preserve unrelated changes and profile isolation. Reuse profile/path/runtime utilities; avoid hardcoded owner paths, runtime versions or shared owner state. Normalize both paths before comparison; test Windows separators and relative segments.
- Extend TypeBox schemas by composing raw properties before `Type.Strict` strips optional markers; verify omitted optional fields remain valid.
- Suggest a commit message matching `scripts/commit-msg.js`; commit only when asked.
- Do not create or update changelog files unless the owner explicitly requests it.

## Releases, publishing and distribution

- Read [RELEASING.md](docs/reference/RELEASING.md) before changing versioning, publishing workflows, release content or update delivery. Keep the documented policy and implementation aligned, clearly distinguishing planned delivery from supported behavior.
- For every Leon-owned versioned component (project, packages, tools, skills, bridges/SDKs, schemas, etc.), use the latest version already pushed upstream or published as the baseline. Apply one appropriate version bump for the combined unpublished changes and reuse that pending version across follow-up edits, review fixes and local commits. If the required SemVer level changes, recalculate from the same baseline. Inspect upstream history or release metadata when needed; local `HEAD` may already contain an unpublished bump. Preserve versions already pushed or published; subsequent changes use a new bump. Third-party dependency upgrades follow upstream releases.
- Keep release tooling minimal and independent of the legacy release scripts. Validate agreement between source versions, tags and release metadata, preserve preview/stable channel continuity, and publish only after the applicable checks and required assets are complete.

## Third-party downloads

- Whenever adding or changing a third-party download, package installer or runtime bootstrap, always investigate maintained Chinese mirror alternatives. Verify availability of the exact version, platform and artifact, and record unsupported or unverified cases instead of assuming a mirror exists.
- Regional download selection must use the downloading host's current network country, with a bounded, cached check and an explicit owner override. Prefer a verified Chinese equivalent in China and retain bounded fallback to the original source. Language, timezone and the owner's saved home address alone do not establish network location.
- Reuse the shared downloader for Leon-owned transfers and supported native configuration for external installers. Preserve explicit source/proxy settings, pinned versions, TLS, trusted integrity checks and the 36-hour dependency cooldown, including required index upload timestamps. Never rewrite arbitrary URLs or switch to a different build merely because a mirror is faster.

## Testing

- Add tests only for distinct observable contracts and real coverage gaps, expressed in names, fixtures and assertions without change history or incidental versions. Cover broad behavior/invariants for the failure class, not incident-specific reproductions, copied configuration assertions, private-wiring checks or mock passthrough smoke tests. Trivial changes need no new tests.
- Never add test files/cases for SDKs, tools or skills without explicit owner request, wherever they would live. Run affected existing tests and adjust compatibility as needed.
- Review affected tests and fixtures. Keep cleanup tied to the approved change and preserve distinct contracts that still apply.
- New server runtime concepts and mechanisms require real, behavior-named scenarios with isolated fixtures under `test/agent/scenarios/<suite>-scenarios/<mechanism>-scenarios/`, separate from the provider matrix.
- Run `pnpm lint`, fix all warnings/errors, and run relevant checks.
- Include validation in the implementation plan: identify affected behavior and the smallest checks that cover it. Inspect package scripts and runner argument handling before selecting files or cases; confirm the selection does not unintentionally include a whole suite.
- Use focused checks for feedback while implementing. Complete coherent edits and review before final validation; run independent checks together only when they do not share mutable fixtures, servers or output directories. For purely visual changes, use lint and a targeted visual check when useful; broader functional suites need a concrete affected contract.
- Reuse passing results while the relevant code, dependencies and configuration remain unchanged. Repeat or broaden checks only for a relevant change, a failure or a concrete unresolved concern. Once required checks pass and review is complete, report the result and stop; do not start speculative improvements or repeated final verification passes.
- Investigate failures with the smallest reproducing selection. Do not rerun suites until green or expand into unrelated repairs. Report suspected flakes and unrelated failures separately from verified results; an isolated pass does not establish that a suite failure is resolved.
- Use `pnpm test:unit` for fast feedback and `pnpm test:integration` for real worker, download, capture and rendering changes; `pnpm test` includes both.
- Run all real scenarios with `pnpm test:agent:scenario`; select categories/mechanisms/cases with `pnpm test:agent:scenario -- <selection>` or list with `--list`. Short mechanism names must be unambiguous. Scenarios use the latest-used profile's active model; override the profile with `LEON_PROFILE`.
- Use `pnpm test:agent:e2e -- -t openai` unless the owner explicitly requests other providers.
- For bridge boundary changes, verify built import graphs and isolated server startup without bridge-only dependencies. Source tests are insufficient.

## Setup migrations

- Keep implementations self-contained in `scripts/setup/migrations/`; no shared migration helpers or imports of other migration implementations.
- Name files `YYYYMMDDHHmmssSS-description.js`: fixed-width 16-digit UTC timestamp, hundredths for `SS`, lowercase kebab-case description. Generate with `date -u +%Y%m%d%H%M%S%2N`, never local time.
- The runner executes pending migrations oldest-first by filename timestamp and records completion per profile. Export default `async migrate(profilePaths)`; make retries safe after interruption.
- Preserve published filenames; necessary renames must export former filenames in `previousIds` to recognize completed work without rerunning it.

## Tools

- Declare semver `version` in `tool.json`, starting at `1.0.0`; advance when the tool changes, following the repository-wide versioning rule. Bundled tools ship with Leon; when release notes are explicitly requested, they belong in root `CHANGELOG.md`. MCP versions identify Leon's integration definition, not the remote service.
- Keep application/device behavior in tools, orchestration in skills and generic execution/transport in the server. Inspect `tools/video_streaming/ffmpeg/` and parent SDK classes before implementing tools.
- Keep tools self-contained, allowing small application-specific helper duplication; no toolkit-level source folders. Preserve existing layouts: Node.js implementations in `src/nodejs/` extend SDK `Tool` and export through `index.ts`; Python implementations in `src/python/` extend SDK `BaseTool` and follow package exports. Supporting scripts belong in the implementation's `lib/`, not another language folder implying an SDK implementation.
- Use `ToolkitConfig` and inherited settings, validation, reporting, command and binary facilities. Keep connection checks tool-specific; no parallel settings loader or installer.
- Assess incremental output when changing tools. Use SDK command streaming, `emitOutput`/`emit_output` for text and `emitProgress`/`emit_progress` only for advancing work. Separate final results, bound chunks and attach retained output to its original call. Declare function `timeout.idleMs` and optional `totalMs` as needed; activity renews only idle time. Respect cancellation/task deadlines through host policy, not parallel timers or simulated output.
- Declare source-local dependencies in `package.json` and/or `pyproject.toml`. Reuse `scripts/setup/setup-tools-dependencies.js` and `sync-source-dependencies.js`; setup supplies managed Node.js, Python, pnpm and uv.
- No nested `pnpm-workspace.yaml` in tools, skills, bridges or generated tool projects. Root build policy is carried into independent installs by the shared installer. Keep application-specific compatibility rules in source-local `.pnpmfile.mjs`; include it in generated projects/source exports that need it.
- Before adding dependencies, inspect existing packages/SDK helpers; prefer compatible existing pinned versions. Keep application engines/assets tool-local; consider bridge-owned packages behind generic SDK helpers for reusable infrastructure. Assess dependencies individually; do not move application behavior into SDKs merely to reduce manifests.
- `tool.json` owns function schemas, descriptions, progressive guidance and binary/resource declarations; no separate instruction-fetching functions or duplicated guidance.
- Derive catalogs from canonical `tools/<toolkit>/<tool>/tool.json`, never duplicate registries/runtime constants. Native tools retain implementations. MCP definitions contain only shared metadata, an HTTP server source and empty functions. Discover bounded remote schemas after explicit profile installation. The Leon server owns transport, encrypted authorization and cancellation. Catalog visibility never enables execution, installs dependencies, authorizes accounts or replays remote writes.
- Keep `distribution` (`built-in`/`extension`), profile installation/availability and `maintenance` (`official`/`community`) independent. Preserve author attribution; `author`/`maintainers` share optional GitHub username, Discord ID/username, email and website contact fields. Only curated source may claim official maintenance; distinguish integration maintainers from remote operators.
- Declared `logo` means local `logo.svg`, rendered as an isolated catalog/connection-card image, never injected SVG. Optional `logo_mask` (`alpha`/`inverse-luminance`) enables monochrome activities using that asset; otherwise retain `icon_name`. Keep rendering policy in metadata, not brand-specific code.
- Expose ordinary SDK tool methods. Server providers and `execution` overrides stay private. Propose missing shared runtime contracts first.

## Bridge SDKs

- Keep server runtime code independent of SDK and tool implementations. Keep SDKs independent of server services and helpers. Type-only imports and explicit dependency-free host contracts are allowed.
- Put shared contracts in `bridges/runtime/contracts/` and Node.js capabilities in `bridges/runtime/nodejs/`. These small standard-library leaves keep server, SDK and toolkit dependencies out of shared code. Reuse persistence and transport through thin adapters. The host owns paths, context, logging and authentication.
- Keep helpers in `sdk/utils/`, preserving public imports and equivalent, idiomatic Node.js/Python behavior. Add only shared infrastructure avoiding repeated dependencies or meaningful duplication; keep application behavior in tools and host transport outside the public SDK.
- Declare SDK dependencies in bridge manifests and keep them separate from the server's `node_modules`. Prefer standard-library equivalents. Compatible versions may share pnpm's store while each runtime owns its dependencies.
- Use narrow imports: platform/path/settings must not load archives/downloaders/integrations. Lazy loading only defers optional work.

## Skills

- Native: `skills/native/<skill>/` with `skill.json`, `locales/`, actions in `src/actions/`, reusable code in `src/lib/`, widgets in `src/widgets/`. Follow the selected bridge's SDK conventions; use SDK settings/memory APIs and declared tools. Examples: `timer_skill` (Node.js), `random_number_skill` (Python).
- Agent: `skills/agent/<skill>/SKILL.md` with discovery frontmatter and concise workflows; optional scripts in `scripts/`. Guide Leon's existing agent loop/tool calls; no second loop or native action manifest.
- Share catalog metadata through existing tool/skill JSON formats. Agent Skills may optionally declare `skill.json` with `format: "agent-skill"`, shared metadata and optional version/icon; `SKILL.md` owns discovery/workflow. Validate Agent/native manifests separately: JSON filenames do not identify native skills, and third-party Agent Skills need no manifest. Exclude native bridge/actions and duplicated names/descriptions/instructions from Agent manifests.
- Optional owner-facing `README.md` covers usage/setup/examples with local screenshots in `media/`; optional `CHANGELOG.md` records releases. Require no boilerplate documentation; never inject catalog documents into model prompts. Load documents/assets on demand through bounded package-local paths.

## Context files

- Maintain generated context via generators in `server/src/core/context-manager/context-files/` and regenerate through the context manager; no hand-edited generated copies.
- Keep `LEON.md`/`ARCHITECTURE.md` to major behavioral/architectural facts; tool usage belongs in tool guidance, workflows in skills.

## System prompts

- Review related instructions before editing a system prompt. Prefer clarifying or merging existing guidance. Add a separate rule only when the behavior cannot be covered clearly by existing guidance.
- Keep frequently sent instructions concise and easy to scan.

## Comments and documentation

- Leon's user-facing messages use first person (“I”, “me”, “my”); preserve branding, technical identifiers and neutral descriptive/accessibility labels.
- Explain lasting behavior, requirements and rationale for contributors unfamiliar with the task, including why code/configuration exists and serves Leon. Keep change history, upgrade narratives, incidental versions and temporary debugging context in commits, PR descriptions or migration notes. Rewrite or omit comments/documentation that only explain the introducing change.

## Code style

- Use braced, multiline control flow and function bodies; split long calls, objects and nested conditions for readability, following surrounding style.
- Group related declarations; separate them from execution with a blank line. Separate logical steps and validation/execution/cleanup/return where helpful; follow surrounding spacing without packing statements or separating every line.
- Avoid hardcoded behavioral keywords, regex, paths or configuration where schemas/settings/utilities exist.
- Put local constants near file tops, shared server constants in `server/src/constants.ts`. Use numeric separators (`3_600`) and enums for meaningful states.
- Comment non-trivial decisions/edge cases, not obvious assignments. Use `//` for JS/TS implementation comments, including multiline ones; preserve existing double-slash comments. Use multiline JSDoc for exported APIs/reusable helpers, never single-line `/** ... */`; use Python comments/docstrings as appropriate.
- Web conventions: [apps/web/AGENTS.md](apps/web/AGENTS.md).

JSDoc format:

```ts
/**
 * The comment
 */
```
