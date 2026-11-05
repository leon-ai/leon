import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateFyi, selectFyi } from '@/core/fyi'
import { FyiKind } from '@/core/fyi/fyi-contract'
import { FYI_VISIONS } from '@/core/fyi/visions'
import { InferencePurpose } from '@/core/llm-manager/types'

const fixture = vi.hoisted(() => ({ prompt: vi.fn() }))
const SUBSTANTIVE_ANSWER = 'An accepted answer with enough context to support a related learning nugget. '.repeat(3)
vi.mock('@/core', () => ({ LLM_PROVIDER: { prompt: fixture.prompt } }))
vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: { getMoodState: (): { getCurrentMood: () => string } => ({ getCurrentMood: (): string => 'tired' }) }
}))

beforeEach(() => {
  vi.restoreAllMocks()
  fixture.prompt.mockReset()
})

describe('FYI selection', () => {
  it.each([
    [0, FyiKind.Fact], [0.719_999, FyiKind.Fact],
    [0.72, FyiKind.Mood], [0.799_999, FyiKind.Mood],
    [0.8, FyiKind.Vision], [0.999_999, FyiKind.Vision]
  ])('applies the 72/8/20 distribution at draw %s', (random, kind) => {
    expect(selectFyi(SUBSTANTIVE_ANSWER, random)).toBe(kind)
  })

  it.each([0, 0.25, 0.72, 0.8, 0.999_999])(
    'skips brief answers regardless of the draw %s', (random) => {
      expect(selectFyi('You are welcome.', random)).toBeNull()
    }
  )

  it('measures the complete trimmed answer before context truncation', () => {
    expect(selectFyi(`  ${'x'.repeat(95)}  `, 0)).toBeNull()
    expect(selectFyi(`  ${'x'.repeat(96)}  `, 0)).toBe(FyiKind.Fact)
    expect(selectFyi('x'.repeat(10_000), 0)).toBe(FyiKind.Fact)
  })

  it('keeps all approved mindset lines short with stable, distinct identities', () => {
    expect(FYI_VISIONS).toHaveLength(16)
    expect(new Set(FYI_VISIONS.map((vision) => vision.id)).size).toBe(FYI_VISIONS.length)
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
    for (const vision of FYI_VISIONS) {
      expect([...segmenter.segment(vision.text)].length).toBeLessThanOrEqual(2)
    }
  })

  it('generates only the selected fact with bounded context and at most two sentences', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    fixture.prompt.mockResolvedValue({ output: JSON.stringify({
      text: 'FYI, the first detail is useful. Another detail follows. A third is unnecessary.'
    }), usedInputTokens: 10, usedOutputTokens: 10 })

    expect(await generateFyi('q'.repeat(2_000), SUBSTANTIVE_ANSWER.repeat(100))).toEqual({
      kind: FyiKind.Fact, text: 'FYI, the first detail is useful. Another detail follows.'
    })
    const [prompt, options] = fixture.prompt.mock.calls[0]!
    const context = JSON.parse(prompt)
    expect(context.query).toHaveLength(600)
    expect(context.answer).toHaveLength(4_000)
    expect(context).not.toHaveProperty('mood')
    expect(options).toMatchObject({ usagePurpose: InferencePurpose.Fyi, timeout: 15_000, maxRetries: 0, disableThinking: true, maxTokens: 200 })
    expect(options.systemPrompt).toContain('Teach one related fact')
    expect(options.systemPrompt).toContain('Use simple everyday words, short direct sentences, and one clear idea')
    expect(options.systemPrompt).not.toContain('first-person aside')
    expect(fixture.prompt).toHaveBeenCalledTimes(1)
  })

  it('generates only the selected mood with the current state and a small answer excerpt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    fixture.prompt.mockResolvedValue({ output: JSON.stringify({ text: 'I am taking things gently today.' }) })
    expect(await generateFyi('A private query that is unnecessary here.', SUBSTANTIVE_ANSWER.repeat(10))).toEqual({
      kind: FyiKind.Mood, text: 'I am taking things gently today.'
    })
    const [prompt, options] = fixture.prompt.mock.calls[0]!
    const context = JSON.parse(prompt)
    expect(context).toMatchObject({ mood: 'tired' })
    expect(context.answer).toHaveLength(600)
    expect(context).not.toHaveProperty('query')
    expect(options.systemPrompt).toContain('first-person aside')
    expect(options.systemPrompt).toContain('Use simple everyday words, short direct sentences, and one clear idea')
    expect(options.systemPrompt).not.toContain('Teach one related fact')
  })

  it.each([
    { answer: SUBSTANTIVE_ANSWER, random: 0.9 },
    { answer: 'You are welcome.', random: 0.1 }
  ])('bypasses inference for mindsets and ineligible replies at draw $random', async ({ answer, random }) => {
    vi.spyOn(Math, 'random').mockReturnValue(random)
    expect(await generateFyi('Thanks!', answer)).toBeNull()
    expect(fixture.prompt).not.toHaveBeenCalled()
  })

  it.each([null, [], '', 'x'.repeat(361)])('falls back without a second inference for invalid or unavailable text: %j', async (text) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    fixture.prompt.mockResolvedValue({ output: JSON.stringify({ text }) })
    expect(await generateFyi('Explain something.', SUBSTANTIVE_ANSWER)).toBeNull()
    expect(fixture.prompt).toHaveBeenCalledTimes(1)
  })

  it.each([
    { random: 0.1, text: SUBSTANTIVE_ANSWER.trim() },
    { random: 0.75, text: 'AN ACCEPTED ANSWER WITH ENOUGH CONTEXT TO SUPPORT A RELATED LEARNING NUGGET.' },
    { random: 0.1, text: 'FYI, An accepted answer with enough context to support a related learning nugget.' },
    { random: 0.75, text: 'An accepted answer\n\nwith enough context to support a related learning nugget. I am taking it gently today.' }
  ])('rejects copied fact or mood sentences without another inference (draw: $random)', async ({ random, text }) => {
    vi.spyOn(Math, 'random').mockReturnValue(random)
    fixture.prompt.mockResolvedValue({ output: JSON.stringify({ text }) })

    expect(await generateFyi('Explain the detail.', SUBSTANTIVE_ANSWER)).toBeNull()
    expect(fixture.prompt).toHaveBeenCalledTimes(1)
    expect(fixture.prompt.mock.calls[0]![1].systemPrompt).toContain('Never repeat or paraphrase the answer')
  })

  it('checks copied passages against the entire answer rather than just its prompt excerpt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const text = 'A distinct closing sentence belongs to the answer, not the footer.'
    fixture.prompt.mockResolvedValue({ output: JSON.stringify({ text }) })

    expect(await generateFyi('Explain the detail.', `${'Earlier context. '.repeat(400)}${text}`)).toBeNull()
    expect(JSON.parse(fixture.prompt.mock.calls[0]![0]).answer).not.toContain(text)
    expect(fixture.prompt).toHaveBeenCalledTimes(1)
  })
})
