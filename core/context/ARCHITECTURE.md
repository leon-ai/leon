> Brain and routing, tool execution, context intelligence, memory layers, reliability loops. Leon-native skills are layered as Skills -> Actions -> Tools -> Functions (-> Binaries).
# ARCHITECTURE
- Generated at: 2026-07-13T21:45:01+08:00
- Leon-native layer model: `Skills -> Actions -> Tools -> Functions (-> Binaries)`.
- Routing model: smart mode auto-selects the best path; controlled mode runs deterministic Leon-native skills/actions; agent mode runs the continuous agent loop and can follow selected agent skills.
- Core runtime: `core/brain/brain.ts`, `llm-duties/react-llm-duty.ts`, `toolkit-registry.ts`, `tool-executor.ts`.
## Core Principles
- Explicit tools over implicit behavior: I call declared tools/functions instead of free-form shell logic whenever possible.
- Progressive grounding: I prefer context and memory tools first, then shell only when no dedicated tool can satisfy the request.
- Auditable steps: I keep plan/execution traces, token usage logs, and tool observations so decisions remain inspectable.
## Client Interfaces
- Leon exposes a client-agnostic Socket.IO interface so built-in and custom clients can connect through the same live dialogue contract.
- HTTP APIs remain request/response support surfaces; live owner utterances should use the Socket.IO client interface.
- External HTTP plugins can extend Leon's HTTP contract without patching the core API for each integration.
- Custom clients can read profile-owned extension JSON files through a generic redacted HTTP endpoint, covering skill memory, skill settings, and tool settings without exposing secrets.
## Agent Loop
- One continuous provider tool-calling transcript carries the owner request, assistant tool calls, matching tool results, recovery decisions, and final answer.
- Tool schemas are disclosed progressively: the loop starts with control tools and the toolkit catalog, then loads only the exact schemas and compact toolkit context needed for the task.
- The model-facing transcript has a fixed input budget: large tool results stay in artifact logs with bounded previews, and inactive toolkit schemas plus older completed tool exchanges are compacted progressively only when needed.
- Earlier-turn artifact manifests have one global size bound, and overlapping reads of the same artifact range are rejected so follow-up turns do not rebuild oversized duplicate context.
- Tool state is separated: installed tools exist in the registry, enabled tools are not disabled by the owner, and available tools have the required settings to run.
- Deterministic runtime guards validate and repair arguments, block duplicate calls, execute tools, and return every success or failure as a structured observation to the same loop.
- Human-in-the-loop pause/resume persists the full agent transcript, visible plan state, and clarification question, then appends the owner reply and continues without rebuilding a phase prompt.
- Each run has 32 operational iterations. At that checkpoint, a tool-restricted synthesis either answers the original request from verified evidence or explains what remains, offers alternatives, and asks permission to continue with a focused next pass.
- The final eight iterations add convergence guidance. Context-pressure failures get one smaller compacted retry, while failed checkpoint synthesis gets one evidence-only retry before a focused continuation is offered.
- Terminal tool handoffs, missing-settings blockers, and final text responses end the loop directly without an extra planning, recovery, or final-answer inference.
- Empty or truncated model output gets one compacted retry with reasoning disabled; repeated exhaustion returns a precise error instead of looping.
- I have a living personality and a changing mood that influence my tone and behavior.
- A bounded private self-model/diary is updated after turns, promotes repeated habits into stable behavioral principles, and injects only a compact snapshot into the first agent request.
- A periodic pulse manager can generate autonomous agent matters from memory, context deltas, and the private self-model, persist them to `PULSE.md`, execute at most one matter per tick, and suppress repeated matters after owner declines.
## Context Intelligence
- I maintain runtime context files (system, activity, browser, network, workspace, habits, inventory, media, architecture, identity).
- I use `structured_knowledge.context.listContextFiles/searchContext/readContextFile` to discover and read relevant context data.
- Context-first policy: for runtime/environment questions (VPN, system state, apps, browsing), I inspect context before memory/shell.
- Persona environment context includes real-time weather snapshots that can influence mood state.
## Memory System
- Memory is layered into persistent, daily, and discussion stores, with context files available as a separate grounding source.
- `OWNER.md` is a canonical curated owner-profile document updated from owner-relevant turns; `.owner-profile.json` is derived from it, while memory remains the broader layered recall system.
- Conversation turns feed daily and discussion memory automatically; explicit durable writes and extracted long-term facts feed persistent memory.
- Memory content is mirrored into QMD collections for retrieval, and embeddings are refreshed on demand when QMD reports pending vectors.
- Recall starts with QMD retrieval, then reranks and may run adaptive follow-up passes when the first result looks weak.
- Read priority stays grounded: context for environment/runtime facts, memory for personal history/preferences, shell as a last resort.
- Runtime maintenance keeps memory lean: indexing is throttled, only dirty namespaces are refreshed, and older short-term memory is compacted or pruned.
## Reliability
- Schema-guided tool calls and argument repair reduce malformed executions.
- Duplicate-input guards and observation-driven recovery reduce repeated bad calls while preserving successful progress.
- I prefer dedicated tools over shell commands to keep behavior stable and auditable.
