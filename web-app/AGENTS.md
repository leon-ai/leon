# Working on the web app

## Architecture and packages

- Before adding routing, server-state, long-list, form, shortcut,
  debouncing/throttling, or interaction-heavy logic, inspect the installed
  TanStack packages. Prefer Router for routing, Query for server state and
  request lifecycle, and Virtual for long or dynamic lists.
- Reuse an installed package when it fits. Propose a missing TanStack package
  before adding it, explaining the complexity it avoids and the benefit to
  maintainability or performance. Do not install packages by default or build
  custom replacements for installed facilities that already solve the task.

## Design tokens and shared styles

- Check `src/styles/_includes/themes.sass`, `variables.sass`, and existing
  components before adding visual styles. Reuse semantic tokens and shared
  components for colors, gradients, spacing, typography, radii, shadows, and
  motion whenever they fit.
- Choose tokens by their purpose, not just a matching color or number. Do not
  substitute an overlay or pressed-shadow color for an unrelated surface or
  floating shadow, or add component-specific copies of shared styling.
- Explain and agree on genuinely missing semantic tokens before introducing
  them. Define shared tokens centrally, with appropriate dark/light theme
  values; do not add one-off colors, derived palette variants, or redundant
  aliases in component styles.
- Keep necessary component geometry local rather than creating a global token
  for every measurement. `currentColor`, transparency, and black/white mask
  values used for coverage are not new palette colors.
- Treat shared component defaults as starting points, not a requirement that
  every context look identical. Keep foundations and behavior consistent while
  allowing deliberate differences in density, hierarchy, and emphasis.
- Express contextual differences through a small, explicit reusable variant or
  modifier owned by the relevant component or pattern. Reuse existing tokens;
  do not change app-wide defaults to solve a local layout or scatter equivalent
  overrides across individual controls. Preserve shared interaction states and
  accessibility behavior when adding a visual variant.
- Decide label typography, icon size, control geometry, and hit area separately.
  Align related controls and balance their visual weight; main icons, brand
  marks, and secondary indicators need not match the label's font size. Permit
  intentional optical corrections after checking the rendered result.
- Keep pointer targets accessible independently of visible glyph size. Meet
  WCAG 2.2 AA target-size requirements; consider the enhanced 44px target for
  touch interaction where feasible. Expanded hit areas must not overlap nearby
  controls. Check narrow layouts, long labels, both themes, and keyboard focus
  without shrinking individual controls inconsistently.
- See [Fluent layout guidance](https://fluent2.microsoft.design/layout),
  [GOV.UK component modifications](https://design-system.service.gov.uk/get-started/extending-and-modifying-components/),
  and WCAG's [minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  and [enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
  target-size guidance for these principles.

## Performance and lifecycle

- Treat smooth interaction, bounded memory, and idle efficiency as requirements.
  Reuse shared components and installed facilities before adding custom effects
  or interaction infrastructure. Profile suspected bottlenecks before adding
  speculative optimizations.
- Every listener, observer, timer, animation frame, browser animation, and async
  operation needs a clear owner and cleanup path. Cancel obsolete work, prevent
  stale async completions, and release resources when their owner unmounts.
- Do not rely solely on animation/transition events for cleanup. Closing must
  release content and effects with reduced motion, interrupted animations,
  zero-duration styles, and rapid open/close sequences too.
- Prefer CSS or browser-managed animations when they fit. Keep per-frame work
  outside React state, run loops only while useful, and pause unnecessary work
  when hidden, off-screen, inactive, or under reduced-motion preferences. Bound
  canvas resolution, particle counts, and drawing frequency.
- Keep hot paths such as typing, scrolling, pointer movement, and resize small.
  Batch layout reads before writes, coalesce repeated measurements, and avoid
  broad event listeners that trigger unrelated layout work or React renders.
- Virtualize long or dynamic collections and keep rendered DOM bounded,
  including large text and structured payloads within individual rows. Give
  caches and registries explicit scope and eviction policies; visually hiding
  entries does not bound their memory use.
- Verify relevant changes in a production build with realistic content and
  repeated navigation, open/close, typing, and scrolling. Check cleanup and
  reduced motion, and distinguish retained caches or normal heap fluctuation
  from reproducible leaks. Report measured findings and verification limits.
