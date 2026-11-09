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
const INPUT_GUIDANCE = 'Use request_clarification.input for required yes/no decisions (BooleanChoice), options (Choice; multiple:true for several selections), or related missing fields (Form). Use the loaded schema, not a second rendering spec. Single choices submit on activation; multiple choices and forms require confirmation. Ask only for information the task needs, reuse supplied details, and never invent questions just to display UI. Credentials belong to trusted connection cards, never these fields. The normal clarification lifecycle pauses and resumes the task; publication happens only after review.'
const NATIVE_GUIDANCE = `Choose the simplest format that communicates best, not a widget merely because it exists. A number, explanation, list, or small static table belongs in Markdown. For numerical trends across time or comparisons across categories, lead with Chart; exact figures are available through its View data disclosure. Line charts show change; bars compare magnitudes; pie charts show a small set of nonnegative parts of one total. Do not add cached tokens to input tokens when cached tokens are already included. Distinguish missing records from zero and partial periods from complete ones.
Use DataTable only when search, sorting or pagination adds real value. Do not replace a small Markdown table with a DataTable that disables both search and sorting. Comparison helps compare meaningful attributes of a few options. Use Markdown Mermaid for a static relationship diagram when it is sufficient. For useful custom interaction or a visual explanation that needs bespoke layout, call load_ui with mode generated. Do not turn routine coding work or simple replies into dashboards.
Examples: six months of usage -> a monthly bar chart, a concise total and coverage caveats, not a table alone; three exact configuration values -> a Markdown table; a large inventory to filter -> DataTable. Request the needed breakdown from tools rather than inventing chart points.
DataTable.props: title, optional description, columns [{key,label}] (up to 12), rows [{id,values:{columnKey: string|number|boolean|null}}] (up to 128), optional searchable/sortable booleans. Every row must contain exactly the declared columns. The host provides local search, sorting and bounded pages. Single-choice and yes/no widgets submit on activation; multiple-choice widgets and forms retain a confirmation button.
Comparison.props: title, optional description, criteria [{key,label}], options [{id,title,values:{criterionKey:value}}] (2..4 options, up to 12 criteria). Include every criterion in every option, without invented recommendations. Chart.props: title, optional description, kind (bar|line|pie), categories (up to 96), series [{label,values:number[]}] (up to 4), optional unit. Every series must align with categories; pie requires one nonnegative series. Preserve source values/units. Charts load lazily and include a data view. These widgets only change local presentation, never execute tools or commit external actions.`
const GENERATED_GUIDANCE = `Generated.props: title, html (body fragment), optional css, optional javascript (plain JS, async allowed), fallback (required readable summary with actual data/units), optional height (120..1200), optional fields (same definitions as Form). Mix Generated with Text, native inputs and Artifacts in a Stack. It is a real custom HTML/CSS/JS surface, not a fixed widget template.
Compose an answer, not a miniature website. Start with the useful insight or diagram; omit hero banners, branding, decorative footers and repeated titles. Aim for a calm, warm, readable composition at the feed width (about 772px), not a desktop dashboard squeezed into chat. Use normal body text (--font-size-md with --line-height-md); smaller text is for short captions, not the main explanation. Never pair large headings with a smaller line-height. Use generous --space-lg/--space-xl separation, clear alignment and few containers instead of a wall of nested bordered cards.
Use one primary accent; extra semantic colors must explain a real distinction, not decorate every node. Use Aurora.Icon for supporting icons, never Unicode ornament. For a relationship diagram, show the overview at once: short labeled nodes and visible labeled connectors, with details revealed on selection. Tabs are useful only for genuinely different tasks/views, not to hide the core explanation. Keep essential relationships clear on narrow screens without clipping or tiny type. Avoid misleading sequential arrows for parallel sources.
Composition examples: a memory map has a central working-context node, a small set of clearly connected sources and a readable selected-node detail below, not three pages of cards; a usage explorer has one chart, a concise summary and a meaningful time/series control, not static metrics wrapped in custom HTML. Prefer Aurora.ChartWidget for ordinary charts even inside a Generated composition. Keep these examples as design principles, not mandatory templates. Source validation cannot certify visual beauty; never claim a browser-rendered preview unless one actually exists.
The opaque sandbox has no app DOM, storage, filesystem, network, tools or arbitrary packages. Never use external scripts, URLs, fonts, iframes, inline event handlers, HTML script/style resources or fetch. Put listeners in javascript and styles in css. Aurora's design system is mandatory: use exact supported --color-*, --space-*, --font-*, --line-height-* and --border-radius-* tokens. Never invent token names, literal palette colors, fonts or new control skins, redefine supplied tokens or use !important. Declare any local geometry variables in css. Fluid width, natural height, no viewport-height loops; support narrow layouts, keyboard and reduced motion. No outer page background or redundant card. Keep source bounded and data grounded; never invent measurements.
Runtime globals: Aurora and React. Aurora.h is React.createElement; Aurora.render(element) mounts shared components into #aurora-root. Available: Button, Input, Selection, Range, Switch (label, checked/defaultChecked, onChange), Segmented (label, options [{value,label}], value/defaultValue, onValueChange), Tabs (label, items [{value,label,content}], value/defaultValue, onValueChange), NumberStepper (label, string value/defaultValue, min/max/step, onValueChange), SearchSelect (label, options [{value,label}], multiple?, string-array value/defaultValue, onValueChange), Surface, Loader, Progress, Icon, DataTableWidget, ComparisonWidget and ChartWidget (same native node props). HTML is in #aurora-content. Ordinary DOM/SVG/canvas and event listeners are supported too. Example: Aurora.render(Aurora.h(Aurora.Button,{onClick:()=>document.querySelector('output').textContent='Ready'},'Try it')). No JSX transpiler is available.
Use Aurora.Button, Input, Selection and Range for controls, not custom recreations. Button variant is primary for the main action, secondary for other actions, ghost for quiet actions, danger only for destructive actions. Button size is md by default or sm. DOM-only controls are automatically styled by the same Aurora classes without replacing nodes: use data-variant="primary|secondary|ghost|danger" and data-size="md|sm" on native buttons; default is secondary/md. Do not style control colors, fonts, padding, borders, radius or shadows. Use wrappers for custom sizing/layout. Authored css lives in a lower-priority layer than shared components. For SVG/canvas/chart color values use Aurora.token('--color-accent') or other supported semantic tokens, never hardcoded colors. Listen to aurora:theme to refresh custom drawing.
await Aurora.chart(element, EChartsOptions) lazily loads interactive line/area, bar, scatter, pie/donut and heatmap charts. Returns setOption(options), on(event,handler), resize(), dispose(). Tooltips, legend, dataset, dataZoom and visualMap are available; give the chart a concrete pixel height and include a readable data table/summary. Local filtering and sliders do not send messages.
Aurora.state.get() reads a bounded tab-local JSON object; Aurora.state.set(object) explicitly retains interface state across navigation/refresh. Restore it before initializing controls. Do not capture secrets or entire DOM trees. Use change/commit events, not animation-frame snapshots. Listen for aurora:theme for custom drawing; charts follow the host palette.
For an optional follow-up action, declare fields and call Aurora.submit({fieldName:'value'}) with all values as strings. This only proposes values: the owner confirms with a trusted Send selection button outside the frame. It cannot invoke tools or silently submit. For required missing inputs use request_clarification.input so the task pauses correctly.
Use preview_ui for source/schema diagnostics before present_ui; it never executes code or claims a screenshot/layout check. On success, publish its preview_id instead of repeating the source. Preview IDs are bounded and turn-local; regenerate one after resuming if unavailable. Fix errors, then publish a complete revision. Never run generated JavaScript in the host shell. Include a concise closing answer rather than duplicating the entire visual.`

export interface AgentUICatalog {
  tools: OpenAITool[]
  auroraMode?: AuroraMode
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
          ...(mode ? { input: { ...auroraInputSchema, description: 'Required native input: BooleanChoice, Choice or Form. Omit for open-ended text. Do not combine with ui.' } } : {}),
          ...(mode && mode !== AuroraMode.Input ? { ui: visualSchema(mode) } : {}),
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

function createPresentationTool(mode: AuroraMode): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AURORA_PRESENT_NAME,
      description: 'Display a visual answer. Supply a checked preview_id OR spec, never both. Reuse surface_id to revise an unfinished surface. Required owner input uses request_clarification instead.',
      parameters: {
        type: 'object',
        properties: {
          spec: visualSchema(mode),
          preview_id: { type: 'string', description: 'Current-turn ID from preview_ui, instead of repeating source.' },
          surface_id: { type: 'string' }
        },
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
    ...(mode === AuroraMode.Input ? [] : [createPresentationTool(mode), createPreviewTool(mode)])
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

    return {
      content: mode === AuroraMode.Input ? INPUT_GUIDANCE :
        [
          INPUT_GUIDANCE,
          'Compose visual answers with present_ui, or a required composed question with request_clarification.ui. Ask one question per reply. Artifacts use retained IDs, never paths or URLs.',
          NATIVE_GUIDANCE,
          ...(mode === AuroraMode.Generated ? [
            GENERATED_GUIDANCE,
            `Supported Aurora tokens: ${[...getAuroraTokenNames()].sort().join(', ')}.`
          ] : [])
        ].join('\n')
    }
  }

  if (!catalog.auroraMode || catalog.auroraMode === AuroraMode.Input) {
    return { content: 'Call load_ui with mode native or generated before checking or publishing visual answers.' }
  }
  if (name === AURORA_PRESENT_NAME && input?.['spec'] !== undefined && input['preview_id'] !== undefined) {
    return { content: 'Visual answer rejected: provide spec or preview_id, not both.' }
  }
  const spec = name === AURORA_PRESENT_NAME && input?.['preview_id'] !== undefined
    ? catalog.auroraPreviews?.get(String(input['preview_id'])) : input?.['spec']
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
  if (input !== undefined && ui !== undefined) {
    return { error: 'Clarification rejected: provide input or a composed ui, not both.' }
  }
  if (input === undefined && ui === undefined) {
    return {}
  }
  if (!available) {
    return { error: 'Native visual input is unavailable for this client. Ask a plain-text clarification without input or ui.' }
  }
  if (!catalog.auroraMode) {
    return { error: 'Call load_ui with mode input before requesting visual input.' }
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
    return { error: `Visual question rejected: ${describeAuroraSpecError(ui)} Repair ui using the loaded catalog and try again.` }
  }
  const unavailable = modeError(ui, catalog)
  const issues = unavailable ? [unavailable] : validateGeneratedSurfaces(ui)

  return issues.length ? { error: `Visual question rejected: ${issues.join('\n')}` } : { ui }
}

