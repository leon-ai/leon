# Working on the web app

## Reuse and architecture

- Before adding code or dependencies, search existing utilities, hooks, shared
  components, styles, and installed packages. Inspect implementations, call sites,
  and relevant tests, not just names.
- Prefer reuse or small, backward-compatible options/variants over duplication;
  preserve defaults and runtime boundaries. Add focused abstractions/dependencies
  only when existing code cannot reasonably fit; remove superseded implementations.
- Inspect installed TanStack packages before routing, server-state, long-list,
  form, shortcut, debounce/throttle, or interaction-heavy work. Prefer Router for
  routing, Query for server state/request lifecycle, Virtual for long/dynamic lists.
- Reuse suitable installed facilities instead of custom replacements. Propose
  missing TanStack packages first, explaining avoided complexity and maintainability
  or performance benefits; never install packages by default.
- Give explicit owner actions feedback through shared request/toast facilities:
  confirm successful management mutations only after server acceptance and report
  actionable failures once. Preserve profile isolation; do not duplicate cache-owned
  errors or toast background fetches, streaming updates, or optimistic success.

## Design intent

- Make Leon feel cozy, warm, quietly creative, and unhurried: a human-centered
  space for craft, not urgency, hype, FOMO, or pressure to keep producing.
  Support the owner's pace through clear, friendly language, soft forms, calm
  hierarchy, and restrained, purposeful motion; avoid decorative noise.
- A slow-paced atmosphere must never mean slow software. Keep typing, navigation,
  loading, and feedback responsive; do not add artificial waits or blocking motion.
  Express warmth through the existing palette and interactions, not new colors.

## Design tokens and shared styles

- Write user-facing messages spoken by Leon in first person (“I”, “me”, “my”), not third person; preserve branding, technical identifiers, and neutral descriptive/accessibility labels.
- Use sentence case for authored titles, headings, labels, tooltips, and toast copy:
  capitalize only the first word, preserving proper names, acronyms, filenames,
  and user/model-authored content.
- Check `src/styles/_includes/themes.sass`, `variables.sass`, and existing components
  first. Reuse semantic tokens/shared components for colors, gradients, spacing,
  typography, radii, shadows, and motion where suitable.
- Choose tokens by purpose, not matching values: overlay/pressed-shadow colors are
  not unrelated surfaces/floating shadows. Avoid component-local copies, one-off
  colors, derived palette variants, and redundant aliases. Explain and agree on
  genuinely missing tokens before defining them centrally with dark/light values.
- Keep necessary geometry local, not a global token per measurement. `currentColor`,
  transparency, and black/white coverage masks are not new palette colors.
- Defaults are starting points: keep foundations/behavior consistent while allowing
  deliberate density, hierarchy, and emphasis differences. Use small, explicit,
  reusable variants/modifiers owned by the component/pattern, with existing tokens
  and preserved interaction states/accessibility behavior. Do not change global
  defaults for local layouts or scatter equivalent overrides across controls.
- Decide label typography, icon size, geometry, and hit area separately; align
  controls and balance visual weight. Main icons, brand marks, and secondary
  indicators need not match label size; verify rendered optical corrections.
- Use local SVGs through the shared icon component. Keep original artwork by
  default; use rounded redraws only for explicitly approved icons. Rounding must
  preserve the original silhouette, details, orientation, and meaning, not redesign
  the symbol. Keep canvas and optical weight consistent. Resolve dynamic names through
  an allowlisted local registry with compatibility aliases and category/generic
  fallbacks; never inject untrusted SVG or fetch/generate unknown icons at runtime.
  Keep brand artwork accurate and retain asset provenance/licenses; modification
  does not remove upstream rights or imply permission to publish an independent set.
- Use outline icons for actions and filled variants to communicate state/status,
  such as pinned sessions or fast service tier. Preserve explicit line/fill variants
  through the shared renderer; SVG fill-based outline geometry is not a filled icon.
- Icon motion should express the action through suitable SVG parts, play once on
  hover or keyboard focus, and respect reduced motion. Keep common icons readily
  available and uncommon assets locally cached; do not load an entire catalog.
- Stateful icon controls use the shared morph renderer and explicitly authored,
  compatible path pairs whose endpoints respect each icon's approved artwork,
  including original shapes and filled/outline styling. Animate actual state changes, never
  initial rendering/remounts; retain the final shape, preserve each control's
  meaning, and reverse interrupted motion from its current geometry. Confirm
  asynchronous success before showing it. Use native finite animations, skip
  motion when reduced, clean up on unmount, and avoid per-frame React work or
  runtime normalization of arbitrary SVGs.
- Keep targets accessible regardless of glyph size: meet WCAG 2.2 AA target sizing,
  consider enhanced 44px touch targets where feasible, and prevent overlapping
  hit areas.
  Check narrow layouts, long labels, both themes, and keyboard focus without
  inconsistently shrinking controls.

References: [Fluent layout](https://fluent2.microsoft.design/layout),
[GOV.UK modifications](https://design-system.service.gov.uk/get-started/extending-and-modifying-components/),
WCAG [minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
and [enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) target sizing.

## Performance and lifecycle

- Require smooth interaction, bounded memory, and idle efficiency. Reuse facilities
  before custom effects/interaction infrastructure; profile suspected bottlenecks
  before speculative optimization.
- Explicitly own and clean up every listener, observer, timer, animation frame,
  browser animation, and async operation. Cancel obsolete work, prevent stale async
  completions, and release resources on unmount.
- Never rely solely on animation/transition events for cleanup: closing must release
  content/effects with reduced motion, interruptions, zero durations, and rapid toggles.
- Prefer suitable CSS/browser-managed animations. Keep per-frame work outside React
  state; run loops only while useful, pausing unnecessary work when hidden,
  off-screen, inactive, or under reduced motion. Bound canvas resolution, particle
  counts, and drawing frequency.
- Keep typing/scroll/pointer/resize hot paths small: batch layout reads before writes,
  coalesce measurements, and avoid broad listeners causing unrelated layout/renders.
- Virtualize long/dynamic collections; bound DOM, including large text and structured
  row payloads. Scope caches/registries and define eviction; hiding entries does not
  bound memory.
- Verify relevant changes in production builds with realistic content and repeated
  navigation, open/close, typing, and scrolling. Check cleanup/reduced motion;
  distinguish retained caches/normal heap fluctuation from reproducible leaks.
  Report measurements and verification limits.

## Verification

- Use Playwright browser E2E flows for web-app behavior, not unit/component tests.
  Keep independent tests fully parallel with bounded workers, isolated contexts/data,
  user-facing locators, and auto-waiting assertions. Exercise normal/reduced motion
  and retain useful failure traces. Never use an owner's profile or paid live LLMs;
  distinguish deterministic API-fixture UI coverage from full-stack coverage.
- Review affected tests and fixtures with each change; remove obsolete, redundant
  or superseded coverage while preserving distinct, still-relevant behavioral
  contracts. Do not keep tests solely because they already exist or expand cleanup
  into unrelated suites.
