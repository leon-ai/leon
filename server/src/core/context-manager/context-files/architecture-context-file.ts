import { ContextFile } from '@/core/context-manager/context-file'
import { DateHelper } from '@/helpers/date-helper'

export class ArchitectureContextFile extends ContextFile {
  public readonly filename = 'ARCHITECTURE.md'
  public readonly ttlMs = null

  public generate(): string {
    return [
      '> Brain and routing, tool execution, context intelligence, memory layers, reliability loops. Leon-native skills are layered as Skills -> Actions -> Tools -> Functions (-> Binaries).',
      '# ARCHITECTURE',
      `- Generated at: ${DateHelper.getDateTime()}`,
      '- Leon-native layer model: `Skills -> Actions -> Tools -> Functions (-> Binaries)`.',
      '- Routing model: smart mode auto-selects the best path; controlled mode runs deterministic Leon-native skills/actions; agent mode runs a ReAct loop and can follow selected agent skills.',
      '- Core runtime: `core/brain/brain.ts`, `llm-duties/react-llm-duty.ts`, `toolkit-registry.ts`, `tool-executor.ts`.',
      '## Core Principles',
      '- Explicit tools over implicit behavior: I call declared tools/functions instead of free-form shell logic whenever possible.',
      '- Progressive grounding: I prefer context and memory tools first, then shell only when no dedicated tool can satisfy the request.',
      '- Auditable steps: I keep plan/execution traces, token usage logs, and tool observations so decisions remain inspectable.',
      '## ReAct Loop',
      '- Planning phase chooses either a direct answer, an ordered tool plan, or a relevant agent skill workflow.',
      '- Tool state is separated: installed tools exist in the registry, enabled tools are not disabled by the owner, and available tools have the required settings to run.',
      '- Execution phase resolves function arguments, validates schema, runs tools, and captures structured observations.',
      '- Human-in-the-loop pause/resume: when required input is missing, execution returns a clarification question, persists paused step state, then resumes the same step after the owner\'s reply instead of restarting from planning.',
      '- Recovery phase replans from failure state instead of restarting blindly.',
      '- Final-answer phase synthesizes a completed answer from observed results.',
      '- I have a living personality and a changing mood that influence my tone and behavior.',
      '- A bounded private self-model/diary is updated after turns, promotes repeated habits into stable behavioral principles, and injects only a compact snapshot into planning/recovery/final-answer prompts.',
      '- A periodic pulse manager can generate autonomous ReAct matters from memory, context deltas, and the private self-model, persist them to `PULSE.md`, execute at most one matter per tick, and suppress repeated matters after owner declines.',
      '## Context Intelligence',
      '- I maintain runtime context files (system, activity, browser, network, workspace, habits, inventory, media, architecture, identity).',
      '- I use `structured_knowledge.context.listContextFiles/searchContext/readContextFile` to discover and read relevant context data.',
      '- Context-first policy: for runtime/environment questions (VPN, system state, apps, browsing), I inspect context before memory/shell.',
      '- Persona environment context includes real-time weather snapshots that can influence mood state.',
      '## Memory System',
      '- Memory is layered into persistent, daily, and discussion stores, with context files available as a separate grounding source.',
      '- `OWNER.md` is a canonical curated owner-profile document updated from owner-relevant turns; `.owner-profile.json` is derived from it, while memory remains the broader layered recall system.',
      '- Conversation turns feed daily and discussion memory automatically; explicit durable writes and extracted long-term facts feed persistent memory.',
      '- Memory content is mirrored into QMD collections for retrieval, and embeddings are refreshed on demand when QMD reports pending vectors.',
      '- Recall starts with QMD retrieval, then reranks and may run adaptive follow-up passes when the first result looks weak.',
      '- Read priority stays grounded: context for environment/runtime facts, memory for personal history/preferences, shell as a last resort.',
      '- Runtime maintenance keeps memory lean: indexing is throttled, only dirty namespaces are refreshed, and older short-term memory is compacted or pruned.',
      '## Reliability',
      '- Schema-guided tool calls and argument repair reduce malformed executions.',
      '- Duplicate-input and failure-aware retries reduce repeated bad calls.',
      '- Replanning after failed steps preserves successful progress and improves completion rate.',
      '- I prefer dedicated tools over shell commands to keep behavior stable and auditable.'
    ].join('\n')
  }
}
