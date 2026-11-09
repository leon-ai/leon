import { randomUUID } from 'node:crypto'
import {
  auroraAuthoringSpecSchema, auroraNativeSpecSchema, auroraInputSchema,
  createAuroraInputSpec, describeAuroraSpecError, isAuroraSpec,
  MAXIMUM_UI_SURFACES, type AuroraSpec
} from '@@/aurora/src/v2/contracts/answer'
import type { OpenAITool, OpenAIToolCall } from '@/core/llm-manager/types'
import { parseToolCallArguments } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-utils'
import { validateGeneratedSurfaces } from './generated-validation'
import { getAuroraTokenNames } from './design-contract'
import {
  AGENT_CLARIFICATION_TOOL_NAME, AURORA_LOADER_NAME, AURORA_PRESENT_NAME,
  AURORA_PREVIEW_NAME, AuroraMode, isAuroraMode
} from './agent-ui-contract'

const MODE_ORDER = [AuroraMode.Input, AuroraMode.Native, AuroraMode.Generated]
const INPUT_GUIDANCE = 'Use request_clarification.input with BooleanChoice for yes/no, Choice for options (multiple:true for several), or Form for related missing fields. Ask only what the task needs; reuse supplied details. Single choices submit immediately; multiple choices and forms require confirmation. Never request credentials here. Clarification review publishes the input before pausing the task.'
const NATIVE_GUIDANCE = `Build the spec using preview_ui's schema, then publish its preview_id with present_ui, or request_clarification.preview_id for a composed required question. Do not repeat the spec. Previews check source/schema only, not browser appearance; regenerate expired IDs after resuming. Artifacts reference retained IDs, never paths or URLs.
Chart shows grounded trends/comparisons: line for change, bar for magnitudes, pie for parts of one total. Preserve values and units; distinguish missing data from zero and partial periods from complete ones. Chart includes a View data disclosure. DataTable is for useful search/sorting/pagination; small static tables stay Markdown. Comparison contrasts meaningful attributes of a few options. Use Mermaid for static relationship diagrams, or load_ui mode generated for bespoke layouts/interactions. Include every declared column/criterion in each row/option. Widgets change local presentation, never execute tools.`
const GENERATED_GUIDANCE = `Compose a useful visual answer, not a miniature website: clear hierarchy, restrained accent, few containers, and a readable overview rather than essential information hidden in tabs. Keep the composition cozy and calm, responsive at feed width, keyboard-accessible and reduced-motion aware. Use --font-size-md with --line-height-md for body text; smaller type is for captions. Use spacing tokens and avoid redundant outer cards/backgrounds, decorative branding and tiny dashboards. Diagram connectors must express the actual relationships. Ground all data and provide a readable fallback with values/units.
Use only supported Aurora tokens, shared controls and local assets. No invented palette/font tokens, literal colors/fonts, token redefinitions, control skins or !important. Local CSS variables are for geometry/state. Position controls through wrappers, not overrides of their appearance. The isolated runtime cannot access the app DOM, storage, filesystem, network, tools or arbitrary packages. Put styles in css and listeners in plain javascript; no JSX, inline event handlers, embedded scripts/styles or external resources. Never execute generated source in the host shell.
Runtime globals: Aurora and React. Aurora.h is React.createElement; Aurora.render(element) mounts into #aurora-root. Static html is in #aurora-content; DOM/SVG/canvas and listeners are supported. Components: Button, Input, Selection, Range, Surface, Loader, Progress, Icon (name), DataTableWidget, ComparisonWidget and ChartWidget (native node props); Switch (label, checked/defaultChecked, onChange); Segmented (label, options:[{value,label}], value/defaultValue, onValueChange); Tabs (label, items:[{value,label,content}], value/defaultValue, onValueChange); NumberStepper (label, string value/defaultValue, min/max/step, onValueChange); SearchSelect (label, options:[{value,label}], multiple?, string-array value/defaultValue, onValueChange). Example: Aurora.render(Aurora.h(Aurora.Button,{onClick:()=>document.querySelector('output').textContent='Ready'},'Try it')).
Prefer shared components over recreating controls. Button variant: primary for the main action, secondary, ghost for quiet actions, danger only for destructive ones; size md or sm. Native DOM buttons use data-variant and data-size with the same values (default secondary/md); the host styles native controls too. Use Aurora.Icon, not Unicode ornaments.
Prefer ChartWidget for standard charts. await Aurora.chart(element,EChartsOptions) supports line/area, bar, scatter, pie/donut and heatmap; returns setOption(options), on(event,handler), resize(), dispose(). Tooltips, legend, dataset, dataZoom and visualMap are available. Set a concrete chart height and include a readable summary/data view. For custom drawings use Aurora.token('--color-accent') or another supported token and update on aurora:theme; shared charts follow the host palette.
Aurora.state.get()/set(object) retains bounded tab-local JSON across navigation/refresh. Restore before initializing controls; save on changes, not per frame, and never store secrets or DOM trees. Optional follow-ups declare fields and call Aurora.submit({fieldName:'value'}) with string values; a trusted Send selection outside the frame confirms them. Local controls do not send messages or execute tools. Required missing inputs use request_clarification.input. Check source with preview_ui, repair diagnostics, then publish the preview_id; validation is not a screenshot or visual-quality check. Close with a concise answer, not a duplicate of the visual.`

export interface AgentUICatalog {
  tools: OpenAITool[]
  auroraMode?: AuroraMode
  // Delivery is turn-local so restored workflows can request guidance again.
  auroraGuidanceMode?: AuroraMode
  auroraPreviews?: Map<string, AuroraSpec>
}

export type PresentAgentUI = (
  spec: AuroraSpec, purpose: 'answer' | 'clarification', surfaceId?: string
) => Promise<string>

/**
 * Keeps ordinary clarification inexpensive; visual input contracts are added
 * only when the agent selects the matching capability.
 */
export function createClarificationTool(mode?: AuroraMode): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AGENT_CLARIFICATION_TOOL_NAME,
      description:
        'Pause for one required question after inspecting tool results. Call this alone, never alongside other calls or for draft text. Yes/no decisions, choices and related fields require native input: first load_ui with mode input, then supply input. Plain questions are for open-ended text or owner actions. The reply resumes the same plan, evidence and artifacts.',
      parameters: {
        type: 'object',
        properties: {
          ...(mode ? { input: { ...auroraInputSchema, description: 'Required BooleanChoice, Choice or Form. Omit for open-ended text. Do not combine with preview_id.' } } : {}),
          ...(mode && mode !== AuroraMode.Input ? { preview_id: {
            type: 'string', description: 'Checked composed question from preview_ui, instead of input. Publication waits for clarification review.'
          } } : {}),
          question: {
            type: 'string',
            description: 'One concise question that unblocks the current task.'
          },
          explanation: {
            type: 'string',
            description: 'Optional concise explanation of what remains incomplete and why.'
          },
          alternatives: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional practical alternatives available to the owner.'
          }
        },
        required: ['question'],
        additionalProperties: false
      }
    }
  }
}

/**
 * Advertises useful visuals without carrying their authoring contracts into
 * unrelated requests. An omitted mode preserves existing loader calls.
 */
export function createAuroraLoaderTool(): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AURORA_LOADER_NAME,
      description: 'Load UI proactively for understanding: input for decisions/forms, native for charts/comparisons or data exploration, generated for bespoke visuals/interactions. Numbers and small static tables stay Markdown. No display permission needed.',
      parameters: {
        type: 'object',
        properties: { mode: { type: 'string', enum: MODE_ORDER } },
        additionalProperties: false
      }
    }
  }
}

function visualSchema(mode: AuroraMode): typeof auroraAuthoringSpecSchema | typeof auroraNativeSpecSchema {
  return mode === AuroraMode.Generated ? auroraAuthoringSpecSchema : auroraNativeSpecSchema
}

function createPresentationTool(): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AURORA_PRESENT_NAME,
      description: 'Display the checked preview from preview_ui. Reuse surface_id to revise an unfinished surface. Required owner input uses request_clarification instead.',
      parameters: {
        type: 'object',
        properties: {
          preview_id: { type: 'string', description: 'Current-turn ID returned by preview_ui.' },
          surface_id: { type: 'string' }
        },
        required: ['preview_id'],
        additionalProperties: false
      }
    }
  }
}

function createPreviewTool(mode: AuroraMode): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AURORA_PREVIEW_NAME,
      description: 'Check a visual spec and source constraints without publishing or executing code. Returns diagnostics, not a screenshot or browser layout check.',
      parameters: {
        type: 'object',
        properties: { spec: visualSchema(mode) },
        required: ['spec'],
        additionalProperties: false
      }
    }
  }
}

/**
 * Upgrades model contracts in place, preserving tool order and previously
 * loaded capabilities. Safe persisted modes restore paused visual workflows.
 */
export function enableAuroraTools(catalog: AgentUICatalog, requested: AuroraMode): AuroraMode {
  const current = catalog.auroraMode
  const mode = current && MODE_ORDER.indexOf(current) > MODE_ORDER.indexOf(requested) ? current : requested
  catalog.auroraMode = mode
  const tools = [
    createClarificationTool(mode),
    ...(mode === AuroraMode.Input ? [] : [createPresentationTool(), createPreviewTool(mode)])
  ]
  for (const tool of tools) {
    const index = catalog.tools.findIndex((entry) => entry.function.name === tool.function.name)
    if (index < 0) {
      catalog.tools.push(tool)
    } else {
      catalog.tools[index] = tool
    }
  }

  return mode
}

function modeError(spec: AuroraSpec, catalog: AgentUICatalog): string | undefined {
  if (catalog.auroraMode !== AuroraMode.Generated &&
    Object.values(spec.elements).some((node) => node.type === 'Generated')) {
    return 'Call load_ui with mode generated before authoring custom HTML/CSS/JavaScript.'
  }

  return undefined
}

/**
 * Handles Aurora discovery, source diagnostics and publication while the agent
 * loop retains responsibility for scheduling, review and finalization.
 */
export async function executeAuroraToolCall(
  call: OpenAIToolCall, catalog: AgentUICatalog, present: PresentAgentUI | undefined
): Promise<{ content: string } | undefined> {
  const name = call.function.name
  if (![AURORA_LOADER_NAME, AURORA_PREVIEW_NAME, AURORA_PRESENT_NAME].includes(name)) {
    return undefined
  }
  if (!present) {
    return { content: 'Visual answers are unavailable for this client. Use ordinary text.' }
  }
  const input = parseToolCallArguments(call.function.arguments)
  if (name === AURORA_LOADER_NAME) {
    const requested = input?.['mode'] ?? AuroraMode.Generated
    if (!isAuroraMode(requested)) {
      return { content: 'Choose load_ui mode input, native or generated.' }
    }
    const mode = enableAuroraTools(catalog, requested)
    const previous = catalog.auroraGuidanceMode
    if (previous === mode) {
      return { content: `UI mode ${mode} is already loaded. Reuse its guidance and schemas; preview IDs remain turn-local.` }
    }
    const content = [
      ...(!previous ? [INPUT_GUIDANCE] : []),
      ...(mode !== AuroraMode.Input && previous !== AuroraMode.Native ? [NATIVE_GUIDANCE] : []),
      ...(mode === AuroraMode.Generated ? [
        GENERATED_GUIDANCE,
        `Supported Aurora tokens: ${[...getAuroraTokenNames()].sort().join(', ')}.`
      ] : [])
    ].join('\n')
    catalog.auroraGuidanceMode = mode

    return { content }
  }

  if (!catalog.auroraMode || catalog.auroraMode === AuroraMode.Input) {
    return { content: 'Call load_ui with mode native or generated before checking or publishing visual answers.' }
  }
  if (name === AURORA_PRESENT_NAME && input?.['spec'] !== undefined && input['preview_id'] !== undefined) {
    return { content: 'Visual answer rejected: provide spec or preview_id, not both.' }
  }
  // Replay accepts direct specs; model-facing publication references a checked
  // preview so the authoring schema belongs to only one tool.
  const previewId = input?.['preview_id']
  const spec = name === AURORA_PRESENT_NAME && previewId !== undefined
    ? typeof previewId === 'string' ? catalog.auroraPreviews?.get(previewId) : undefined : input?.['spec']
  if (!isAuroraSpec(spec)) {
    return { content: `Visual ${name === AURORA_PREVIEW_NAME ? 'source' : 'answer'} rejected: ${input?.['preview_id'] ? 'This preview is unavailable; check the source again with preview_ui.' : describeAuroraSpecError(spec)} Repair the spec using the loaded catalog and try again.` }
  }
  const unavailable = modeError(spec, catalog)
  if (unavailable) {
    return { content: unavailable }
  }
  const issues = validateGeneratedSurfaces(spec)
  if (name === AURORA_PREVIEW_NAME) {
    let previewId: string | undefined
    if (!issues.length) {
      const previews = catalog.auroraPreviews ??= new Map()
      if (previews.size >= MAXIMUM_UI_SURFACES) {
        previews.delete(previews.keys().next().value!)
      }
      previewId = randomUUID()
      previews.set(previewId, spec)
    }

    return { content: JSON.stringify({
      valid: issues.length === 0, issues, preview_id: previewId,
      checks: ['schema', 'bounded markup', 'resource declarations', 'JavaScript syntax', 'Aurora design tokens and control styling'],
      browserRendered: false
    }) }
  }
  if (issues.length) {
    return { content: `Visual answer rejected: ${issues.join('\n')}` }
  }
  if (input?.['surface_id'] !== undefined && typeof input['surface_id'] !== 'string') {
    return { content: 'Visual answer rejected: surface_id must be an existing surface ID string when provided.' }
  }

  try {
    const id = await present(spec, 'answer', input?.['surface_id'] as string | undefined)

    return { content: JSON.stringify({
      surface_id: id, displayed: true,
      instructions: 'This visual is already in the reply. Do not repeat its full content in the closing answer.'
    }) }
  } catch (error) {
    return { content: `Visual answer rejected: ${String(error)}` }
  }
}

/**
 * Resolves visual input through the same schema/validation boundary as answers,
 * without publishing anything before clarification review accepts the question.
 */
export function resolveAuroraClarification(
  args: Record<string, unknown> | null, catalog: AgentUICatalog, available: boolean
): { ui?: AuroraSpec, error?: string } {
  const input = args?.['input']
  let ui = args?.['ui']
  const previewId = args?.['preview_id']
  if ([input, ui, previewId].filter((value) => value !== undefined).length > 1) {
    return { error: 'Clarification rejected: provide input or one composed visual, not both.' }
  }
  if (input === undefined && ui === undefined && previewId === undefined) {
    return {}
  }
  if (!available) {
    return { error: 'Native visual input is unavailable for this client. Ask a plain-text clarification without visual input.' }
  }
  if (!catalog.auroraMode) {
    return { error: 'Call load_ui with mode input before requesting visual input.' }
  }
  if (previewId !== undefined) {
    ui = typeof previewId === 'string' ? catalog.auroraPreviews?.get(previewId) : undefined
    if (!ui) {
      return { error: 'This preview is unavailable; check the composed question again with preview_ui.' }
    }
  }
  if (input !== undefined) {
    ui = createAuroraInputSpec(input)
    if (!ui) {
      return { error: `Clarification input rejected: ${describeAuroraSpecError({ root: 'input', elements: { input } })} Use a BooleanChoice, Choice or Form node from the input schema.` }
    }
  } else if (catalog.auroraMode === AuroraMode.Input) {
    return { error: 'Use request_clarification.input, or call load_ui with mode native for a composed question.' }
  }
  if (!isAuroraSpec(ui)) {
    return { error: `Visual question rejected: ${describeAuroraSpecError(ui)} Repair the visual with preview_ui and try again.` }
  }
  const unavailable = modeError(ui, catalog)
  const issues = unavailable ? [unavailable] : validateGeneratedSurfaces(ui)

  return issues.length ? { error: `Visual question rejected: ${issues.join('\n')}` } : { ui }
}

