import type { Route } from '@playwright/test'
import { test, expect, SESSION_ID, SESSION_URL } from './fixtures'
import { AURORA_FORM_SPEC, AURORA_GENERATED_SPEC, AURORA_CALCULATOR_SPEC, AURORA_PRESENTATION_SPEC, AURORA_RETIRED_RESULTS_SPEC, auroraParts } from '../../fixtures/aurora'
import type { ConversationRecord } from '../../../apps/web/src/data/conversation'
import { PreparationStatus } from '../../../aurora/src/v2/contracts/preparation'

test('replays active data widgets and retired results without sending owner commands', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const spec = structuredClone(AURORA_PRESENTATION_SPEC)
  const root = spec.elements[spec.root]!
  if (root.type !== 'Stack') {
    throw new Error('The data fixture requires a stack.')
  }
  root.children.unshift('results')
  spec.elements['results'] = AURORA_RETIRED_RESULTS_SPEC.elements['results']!
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
  const commands: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      commands.push(new URL(request.url()).pathname)
    }
  })
  await page.goto(SESSION_URL)
  const table = page.getByRole('region', { name: 'Reading notes', exact: true })
  await expect(table.getByRole('row')).toHaveCount(13)
  await table.getByRole('searchbox').fill('Day 16')
  await expect(table.getByRole('cell', { name: '80', exact: true })).toBeVisible()
  await page.getByRole('switch', { name: 'Only differences' }).check()
  await expect(page.getByRole('cell', { name: 'Kitchen', exact: true })).toHaveCount(0)
  const chart = page.getByRole('region', { name: 'A little time to read', exact: true })
  await expect(chart.locator('canvas')).toBeVisible()
  await chart.getByText('View data', { exact: true }).click()
  await expect(chart.getByRole('cell', { name: '45', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'A few places to begin', exact: true })).toContainText('https://github.com/leon-ai/leon')
  await expect(chart.locator('canvas')).toBeVisible()
  expect(commands).toEqual([])
})

test('reserves generated geometry across cold preparation and session remounts', async ({ page, ui }) => {
  const spec = structuredClone(AURORA_CALCULATOR_SPEC)
  const node = spec.elements['savings']!
  if (node.type !== 'Generated') {
    throw new Error('The fixture requires a generated surface.')
  }
  node.props.height = 520
  node.props.html = '<div id="scene">Preparing a little space.</div>'
  node.props.css = '#scene { min-height:520px }'
  node.props.javascript = `await new Promise(resolve => window.addEventListener('fixture:finish', resolve, {once:true}));
document.getElementById('scene').innerHTML = '<h3>A little room to create.</h3><p>The first render is ready.</p>';`
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.answerParts = [...auroraParts(history.at(-2)!.messageId, spec),
    { kind: 'text', id: 'reading-anchor', text: 'Keep this line in place.' }]
  const blocked = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route('**/generated-frame-*.js', async (route) => {
    blocked.resolve()
    await release.promise
    await route.continue()
  })
  await page.goto(SESSION_URL)
  await blocked.promise
  const response = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  const layout = response.locator('.visual-layout').last()
  await expect(layout).toHaveAttribute('aria-busy', 'true')
  const initial = (await layout.boundingBox())!.height
  expect(initial).toBeGreaterThan(520)
  release.resolve()
  const frame = page.frameLocator('iframe[title="A small saving habit"]')
  await expect(frame.locator('#scene')).toHaveText('Preparing a little space.')
  await expect(layout).toHaveAttribute('aria-busy', 'true')
  expect(Math.abs((await layout.boundingBox())!.height - initial)).toBeLessThan(2)
  await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('fixture:finish')))
  await expect(layout).toHaveAttribute('aria-busy', 'false')
  await expect(frame.getByRole('heading', { name: 'A little room to create.' })).toBeVisible()
  const settled = (await layout.boundingBox())!.height
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expect(frame.locator('#scene')).toHaveText('Preparing a little space.')
  await expect(layout).toHaveAttribute('aria-busy', 'true')
  expect(Math.abs((await layout.boundingBox())!.height - settled)).toBeLessThan(2)
  const anchor = response.getByText('Keep this line in place.', { exact: true })
  await expect(anchor).toBeVisible()
  const before = (await anchor.boundingBox())!.y
  await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('fixture:finish')))
  await expect(layout).toHaveAttribute('aria-busy', 'false')
  expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2)
})

test('keeps the reading anchor when an overscanned visual finishes above the viewport', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const spec = structuredClone(AURORA_CALCULATOR_SPEC)
  const node = spec.elements['savings']!
  if (node.type !== 'Generated') {
    throw new Error('The fixture requires a generated surface.')
  }
  node.props.height = 180
  node.props.html = '<div id="scene">Preparing a little space.</div>'
  node.props.css = '#scene { min-height:180px }'
  node.props.javascript = `await new Promise(resolve => window.addEventListener('fixture:finish', resolve, {once:true}));
document.getElementById('scene').style.minHeight = '900px';`
  history.at(-3)!.answerParts = auroraParts(history.at(-4)!.messageId, spec)
  history.at(-1)!.message = Array.from({ length: 42 }, (_, index) => `Reading line ${index}.`).join('\n\n')
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A small saving habit"]')
  await expect(frame.locator('#scene')).toHaveText('Preparing a little space.')
  const scroller = page.locator('.app-main')
  const originalOffset = await scroller.evaluate((element) => element.scrollTop)
  await scroller.evaluate((element) => { element.scrollTop -= 120 })
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(originalOffset - 100)
  const anchor = page.getByText('Reading line 30.', { exact: true })
  await expect(anchor).toBeInViewport()
  const frameElement = page.locator('iframe[title="A small saving habit"]')
  const offscreen = (await frameElement.boundingBox())!
  expect(offscreen.y + offscreen.height).toBeLessThan(0)
  const before = (await anchor.boundingBox())!.y
  await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('fixture:finish')))
  await expect(page.getByRole('region', { name: 'A small saving habit', exact: true })
    .getByRole('button', { name: 'Copy image', exact: true })).toBeEnabled()
  await expect.poll(() => frameElement.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(900)
  expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2)
})

test('loads optional composite controls inside the isolated runtime and preserves their native targets', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const spec = structuredClone(AURORA_CALCULATOR_SPEC)
  const node = spec.elements['savings']!
  if (node.type !== 'Generated') {
    throw new Error('The generated fixture must declare an isolated surface.')
  }
  node.props.title = 'A few shared controls'
  node.props.html = '<label><input id="kept" type="checkbox">Keep this idea</label><output id="changes">0</output>'
  node.props.css = ''
  node.props.javascript = `const input = document.getElementById('kept');
let changes = 0;
input.addEventListener('change', () => { document.getElementById('changes').textContent = String(++changes); });
const h = Aurora.h;
Aurora.render(h('div', {className:'aurora-fields'},
  h(Aurora.Tabs, {label:'Views',items:[
    {value:'first',label:'First',content:'A little room to explore.'},
    {value:'second',label:'Second',content:'A few notes.'}
  ]}),
  h(Aurora.SearchSelect,{label:'Choose a pace',options:[{value:'gentle',label:'Gentle'},{value:'focused',label:'Focused'}]}),
  h(Aurora.Segmented,{label:'Choose a view',defaultValue:'day',options:[{value:'day',label:'Day'},{value:'week',label:'Week'}]}),
  h(Aurora.Switch,{label:'Play music',defaultChecked:true})
));`
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A few shared controls"]')
  await expect(frame.getByRole('tab', { name: 'First', exact: true })).toBeVisible()
  await frame.getByRole('tab', { name: 'First', exact: true }).focus()
  await frame.getByRole('tab', { name: 'First', exact: true }).press('ArrowRight')
  await expect(frame.getByRole('tab', { name: 'Second', exact: true })).toHaveAttribute('aria-selected', 'true')
  const search = frame.getByRole('combobox', { name: 'Choose a pace' })
  await search.fill('Focused')
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(search).toHaveValue('Focused')
  await frame.getByRole('checkbox', { name: 'Keep this idea' }).check()
  await expect(frame.locator('#changes')).toHaveText('1')
  await frame.getByRole('radio', { name: 'Week', exact: true }).check()
  await expect(frame.getByRole('radio', { name: 'Week', exact: true })).toBeChecked()
  await frame.getByRole('switch', { name: 'Play music' }).uncheck()
  await expect(frame.getByRole('switch', { name: 'Play music' })).not.toBeChecked()
})

for (const theme of ['dark', 'light'] as const) {
  test(`keeps native, dynamic and React controls on the same Aurora foundation (${theme})`, async ({ page, ui }, testInfo) => {
    const history = ui.history.get(SESSION_ID)!
    const spec = structuredClone(AURORA_CALCULATOR_SPEC)
    const node = spec.elements['savings']!
    if (node.type !== 'Generated') {
      throw new Error('The control fixture requires a generated surface.')
    }
    node.props.title = 'Shared control foundation'
    node.props.html = `<div class="controls">
      <button id="raw-primary" data-variant="primary" style="padding:1px;background:magenta">Native action</button>
      <label>Native text<input id="raw-text" aria-label="Native text" placeholder="A small idea"></label>
      <label>Native range<input type="range" aria-label="Native range" min="0" max="100" value="40"></label>
      <label><input type="checkbox" aria-label="Keep room">Keep room</label>
      <label>Native select<select aria-label="Native select"><option>A gentle pace</option></select></label>
      <output id="clicked">0</output><div id="later"></div></div>`
    // Saved documents may predate source checks. Their ordinary control rules
    // still cannot override the trusted, unlayered Aurora foundation.
    node.props.css = '#raw-primary{background:magenta;color:yellow;padding:1px;border-radius:0;font-size:11px}.controls{display:grid;gap:var(--space-md)}'
    node.props.javascript = `const h = Aurora.h;
let clicks = 0;
const clicked = () => { document.getElementById('clicked').textContent = String(++clicks); };
document.getElementById('raw-primary').addEventListener('click', clicked);
Aurora.render(h('div', {className:'aurora-fields'},
  h(Aurora.Button, {variant:'primary', onClick:clicked}, 'Shared action'),
  h(Aurora.Input, {ariaLabel:'Shared text',placeholder:'A small idea'}),
  h(Aurora.Range, {'aria-label':'Shared range',min:0,max:100,defaultValue:40}),
  h(Aurora.Button, {variant:'secondary',onClick:()=>{
    const button = document.createElement('button');
    button.dataset.variant = 'danger';
    button.textContent = 'Later action';
    button.style.backgroundColor = 'magenta';
    button.addEventListener('click', clicked);
    document.getElementById('later').append(button);
  }}, 'Add a control')));`
    history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
    await page.addInitScript((value) => {
      window.localStorage.setItem('leon.web-app.theme', value)
    }, theme)
    await page.goto(SESSION_URL)
    const frame = page.frameLocator('iframe[title="Shared control foundation"]')
    const raw = frame.getByRole('button', { name: 'Native action', exact: true })
    await expect(frame.getByRole('button', { name: 'Shared action', exact: true })).toBeVisible()
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme)
    await page.mouse.move(0, 0)
    const appearances = await frame.locator('body').evaluate((body) => {
      const properties = ['background-image', 'color', 'border-radius', 'font-family', 'font-size', 'font-weight', 'padding-left', 'padding-right', 'height']
      const appearance = (element: Element): string[] => {
        const style = getComputedStyle(element)
        return properties.map((property) => style.getPropertyValue(property))
      }
      return { native: appearance(body.querySelector('#raw-primary')!),
        shared: appearance([...body.querySelectorAll('button')].find((element) => element.textContent === 'Shared action')!),
        nativeInput: appearance(body.querySelector('#raw-text')!),
        sharedInput: appearance(body.querySelector('input[aria-label="Shared text"]')!),
        nativeThumb: getComputedStyle(body.querySelector('input[aria-label="Native range"]')!, '::-webkit-slider-thumb').backgroundColor,
        sharedThumb: getComputedStyle(body.querySelector('input[aria-label="Shared range"]')!, '::-webkit-slider-thumb').backgroundColor }
    })
    expect(appearances.native).toEqual(appearances.shared)
    expect(appearances.nativeInput).toEqual(appearances.sharedInput)
    expect(appearances.nativeThumb).toEqual(appearances.sharedThumb)
    await raw.click()
    await expect(frame.locator('#clicked')).toHaveText('1')
    await frame.getByRole('textbox', { name: 'Native text', exact: true }).fill('Keep this draft')
    await frame.getByRole('checkbox', { name: 'Keep room', exact: true }).check()
    await frame.getByRole('button', { name: 'Add a control', exact: true }).click()
    const later = frame.getByRole('button', { name: 'Later action', exact: true })
    await expect(later).toHaveCSS('border-radius', appearances.shared[2]!)
    await later.click()
    await expect(frame.locator('#clicked')).toHaveText('2')
    await expect(frame.getByRole('textbox', { name: 'Native text', exact: true })).toHaveValue('Keep this draft')
    await page.locator('iframe').screenshot({ path: testInfo.outputPath(`generated-controls-${theme}.png`) })
  })
}

test('runs a bespoke chart, retains local state and confirms declared submissions outside the sandbox', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.answerParts = auroraParts(history.at(-2)!.messageId, AURORA_GENERATED_SPEC)
  const requests: { id: string, values: Record<string, string> }[] = []
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages/${answer.messageId}/ui`, async (route) => {
    const body = route.request().postDataJSON()
    requests.push(body)
    const part = answer.answerParts![0]!
    if (part.kind === 'ui') {
      part.surface.receipts['reading'] = { commandId: body.id, revision: 1, values: body.values, submittedAt: Date.now() }
    }
    await route.fulfill({ json: { answerParts: answer.answerParts } })
  })
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A little room for reading"]')
  await expect(frame.locator('canvas')).toBeVisible()
  await frame.getByRole('slider', { name: 'Daily reading goal' }).fill('45')
  await expect(frame.locator('#week-total')).toContainText('315 minutes')
  await page.reload()
  await expect(frame.getByRole('slider', { name: 'Daily reading goal' })).toHaveValue('45')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(frame.locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await frame.getByRole('button', { name: 'Plan around this goal', exact: true }).click()
  const send = page.getByRole('button', { name: 'Send selection', exact: true })
  await expect(send).toBeVisible()
  expect(requests).toEqual([])
  await send.click()
  await expect(page.getByText('Sent. Thank you.', { exact: true })).toBeVisible()
  await expect(send).toBeDisabled()
  expect(requests).toHaveLength(1)
  expect(requests[0]!.values).toEqual({ minutes: '45' })
  await page.reload()
  await expect(send).toBeDisabled()
  expect(requests).toHaveLength(1)
})

test('keeps non-chart interactions local and preserves their frame through theme changes and source viewing', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, AURORA_CALCULATOR_SPEC)
  const charts: string[] = []
  const commands: string[] = []
  page.on('request', (request) => {
    if (/\/(charts|chart-series|_virtual_aurora-charts)-/.test(request.url())) {
      charts.push(request.url())
    }
    if (request.method() === 'POST') {
      commands.push(request.url())
    }
  })
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A small saving habit"]')
  await frame.getByRole('slider', { name: 'Monthly saving' }).fill('900')
  await expect(frame.locator('#yearly')).toHaveText('¥10800')
  const original = await page.locator('iframe').elementHandle()
  await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.locator('iframe').evaluate((element, previous) => element === previous, original)).toBe(true)
  await expect(frame.locator('#yearly')).toHaveText('¥10800')
  await page.getByRole('button', { name: 'View source', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Interface source' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Copy source' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(frame.locator('#yearly')).toHaveText('¥10800')
  await page.getByText('Text summary', { exact: true }).click()
  const calculator = AURORA_CALCULATOR_SPEC.elements['savings']!
  if (calculator.type !== 'Generated') {
    throw new Error('The calculator fixture requires a generated surface.')
  }
  await expect(page.getByText(calculator.props.fallback, { exact: true })).toBeVisible()
  expect(charts).toEqual([])
  expect(commands).toEqual([])
})

test('blocks app access, network requests and automatic commands from generated code', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const spec = structuredClone(AURORA_GENERATED_SPEC)
  const node = spec.elements['reading']!
  if (node.type !== 'Generated') {
    throw new Error('The sandbox fixture requires a generated surface.')
  }
  node.props.html = '<output id="boundaries"></output>'
  node.props.javascript = 'let parentBlocked=false;let cookieBlocked=false;try{parent.document.body.dataset.leaked=\'yes\'}catch{parentBlocked=true}try{document.cookie}catch{cookieBlocked=true}document.getElementById(\'boundaries\').textContent=String(parentBlocked&&cookieBlocked);fetch(\'https://leak.invalid/fetch\').catch(()=>{});const image=new Image();image.src=\'https://leak.invalid/image\';document.body.append(image);Aurora.submit({minutes:\'45\'});parent.postMessage({type:\'submit\',values:{minutes:\'60\'}},\'*\');'
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
  const escaped: string[] = []
  const commands: string[] = []
  await page.route('https://leak.invalid/**', async (route) => {
    escaped.push(route.request().url())
    await route.abort()
  })
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      commands.push(request.url())
    }
  })
  await page.goto(SESSION_URL)
  const frame = page.frameLocator('iframe[title="A little room for reading"]')
  await expect(frame.locator('#boundaries')).toHaveText('true')
  await expect(page.getByRole('button', { name: 'Send selection', exact: true })).toBeVisible()
  const child = page.frames().find((item) => item.url().startsWith('blob:'))!
  await child.evaluate(() => { window.location.href = 'https://leak.invalid/navigation' })
  await expect(page.locator('body')).not.toHaveAttribute('data-leaked', 'yes')
  expect(escaped).toEqual([])
  expect(commands).toEqual([])
})

test('unloads failed generated code while keeping its summary and the conversation usable', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const spec = structuredClone(AURORA_CALCULATOR_SPEC)
  const node = spec.elements['savings']!
  if (node.type !== 'Generated') {
    throw new Error('The failure fixture requires a generated surface.')
  }
  node.props.javascript = 'throw new Error("The interface could not initialize.")'
  history.at(-1)!.answerParts = auroraParts(history.at(-2)!.messageId, spec)
  await page.goto(SESSION_URL)
  await expect(page.getByText('I couldn’t run this interface. You can still read the summary below.', { exact: true })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.getByText(node.props.fallback, { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message Leon' }).fill('Show this another way')
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveValue('Show this another way')
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`keeps streamed native forms stable, restores partial drafts and saves accepted values (${reducedMotion})`, async ({ page, ui }) => {
    const history = ui.history.get(SESSION_ID)!
    const owner = history.at(-2)!
    const answer = history.at(-1)!
    answer.answerParts = auroraParts(owner.messageId, AURORA_FORM_SPEC)
    const requests: { id: string, values: Record<string, string> }[] = []
    const pending = Promise.withResolvers<Route>()
    await page.route(`**/api/v1/sessions/${SESSION_ID}/messages/${answer.messageId}/ui`, async (route) => {
      requests.push(route.request().postDataJSON())
      pending.resolve(route)
    })
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const form = page.getByRole('region', { name: 'A little project', exact: true })
    const name = form.getByRole('textbox', { name: 'Project name', exact: true })
    await name.fill('A little garden')
    await page.reload()
    await expect(name).toHaveValue('A little garden')
    await expect(form.getByRole('combobox', { name: 'Pace', exact: true })).toHaveValue('')
    await form.getByRole('combobox', { name: 'Pace', exact: true }).selectOption('gentle')
    await form.getByRole('textbox', { name: 'Notes', exact: true }).fill('Leave time to explore.')
    const original = await name.elementHandle()
    await name.focus()
    await ui.emit([{ type: 'answer_parts', sequence: 1, session_id: SESSION_ID, turn_id: null,
      response_id: answer.messageId, created_at: Date.now(), data: { answer_parts: structuredClone(answer.answerParts) } }])
    await expect(name).toBeFocused()
    expect(await name.evaluate((element, previous) => element === previous, original)).toBe(true)
    await expect(name).toHaveValue('A little garden')
    const save = form.getByRole('button', { name: 'Save', exact: true })
    await save.click()
    const route = await pending.promise
    await expect(save).toBeDisabled()
    await expect(save).toHaveAttribute('aria-busy', 'true')
    const receipt = { commandId: requests[0]!.id, revision: 1, values: requests[0]!.values, submittedAt: Date.now() }
    const part = answer.answerParts![0]!
    if (part.kind === 'ui') {
      part.surface.receipts['project'] = receipt
    }
    await route.fulfill({ json: { answerParts: answer.answerParts } })
    await expect(form.getByRole('status')).toHaveText('Saved. Thank you.')
    await page.reload()
    await expect(name).toHaveValue('A little garden')
    await expect(name).toBeDisabled()
    await expect(form.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Leave time to explore.')
    await expect(save).toBeDisabled()
    expect(requests).toHaveLength(1)
  })
}

test('restores browsed single-choice drafts without submitting and locks an activated answer while saving', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.answerParts = auroraParts(history.at(-2)!.messageId)
  let finish: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const requests: unknown[] = []
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages/${answer.messageId}/ui`, async (route) => {
    const body = route.request().postDataJSON()
    requests.push(body)
    await pending
    const part = answer.answerParts![0]!
    if (part.kind === 'ui') {
      part.surface.receipts['choice'] = { commandId: body.id, revision: 1, values: body.values, submittedAt: Date.now() }
    }
    await route.fulfill({ json: { answerParts: answer.answerParts } })
  })

  try {
    await page.goto(SESSION_URL)
    const choice = page.getByRole('region', { name: 'How would you like to start?', exact: true })
    await choice.getByRole('radio').first().focus()
    await choice.getByRole('radio').first().press('ArrowDown')
    const selected = choice.getByRole('radio', { name: 'Something creative', exact: true })
    await expect(selected).toBeChecked()
    expect(requests).toHaveLength(0)
    await page.reload()
    await expect(selected).toBeChecked()
    expect(requests).toHaveLength(0)
    await selected.click()
    await expect(choice.getByRole('group')).toHaveAttribute('aria-busy', 'true')
    await expect(selected).toBeDisabled()
    expect(requests).toHaveLength(1)
    finish?.()
    await expect(choice.getByRole('status')).toHaveText('Saved. Thank you.')
    expect(requests).toHaveLength(1)
  } finally {
    finish?.()
  }
})

test('retains choices through uncertain delivery and reuses the command ID on explicit retry', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.answerParts = auroraParts(history.at(-2)!.messageId)
  const unanswered = structuredClone(answer.answerParts)
  const commands: string[] = []
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages/${answer.messageId}/ui`, async (route) => {
    const body = route.request().postDataJSON() as { id: string, values: string[] }
    commands.push(body.id)
    if (commands.length === 1) {
      await route.fulfill({ status: 503, json: { message: 'I could not confirm delivery. Please try again.' } })
      return
    }
    const part = answer.answerParts![0]!
    if (part.kind === 'ui') {
      part.surface.receipts['choice'] = { commandId: body.id, revision: 1, values: body.values, submittedAt: Date.now() }
    }
    await route.fulfill({ json: { answerParts: answer.answerParts } })
  })
  await page.goto(SESSION_URL)
  const choice = page.getByRole('region', { name: 'How would you like to start?', exact: true })
  const radio = choice.getByRole('radio', { name: 'A quiet morning', exact: true })
  await expect(choice.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)
  await radio.check()
  await expect(choice.getByRole('alert')).toContainText('try again')
  await expect(page.locator('.toast-error')).toHaveCount(1)
  await expect(radio).toBeChecked()
  await expect(choice.getByRole('radio').last()).toBeDisabled()
  expect(commands).toHaveLength(1)
  await choice.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(choice.getByRole('status')).toHaveText('Saved. Thank you.')
  await ui.emit([{ type: 'answer_parts', sequence: 1, session_id: SESSION_ID, turn_id: null,
    response_id: answer.messageId, created_at: Date.now(), data: { answer_parts: unanswered } }])
  await expect(choice.getByRole('status')).toHaveText('Saved. Thank you.')
  await expect(radio).toBeDisabled()
  expect(commands).toHaveLength(2)
  expect(new Set(commands).size).toBe(1)
})

test('leaves draft and obsolete controls inactive while keeping legacy text answers readable', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const original = history.at(-1)!
  original.answerParts = auroraParts(history.at(-2)!.messageId)
  history.push({ who: 'owner', messageId: 'later-owner', message: 'Let’s do something else.', sentAt: Date.now(), isAddedToHistory: true }, {
    who: 'leon', messageId: 'later-owner:leon', message: 'Of course. There’s no rush.', sentAt: Date.now() + 1, isAddedToHistory: true
  })
  await page.goto(SESSION_URL)
  await expect(page.getByText('Of course. There’s no rush.', { exact: true })).toBeVisible()
  const choice = page.getByRole('region', { name: 'How would you like to start?', exact: true })
  await expect(choice.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await expect(choice.getByRole('radio').first()).toBeDisabled()
  await expect(page.getByText('This question is no longer active.', { exact: true })).toBeVisible()
  const pending: ConversationRecord = { who: 'leon', messageId: 'later-owner:leon', message: '', sentAt: Date.now() + 2,
    isAddedToHistory: false, answerParts: auroraParts('later-owner') }
  const part = pending.answerParts![0]!
  if (part.kind === 'ui') {
    part.surface.status = 'draft'
  }
  history[history.length - 1] = pending
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.reload()
  const drafting = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  await expect(drafting.getByRole('radio').first()).toBeDisabled()
  await expect(drafting.getByText('Getting this ready…')).toBeVisible()
})

test('does not load native or generated rendering engines for ordinary Markdown answers', async ({ page, ui }) => {
  void ui
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(SESSION_URL)
  await expect(page.getByText('Saved answer 239', { exact: true })).toBeVisible()
  expect(requests.some((url) => /(?:aurora-surface|generated-frame|charts|chart-engine|chart-series|controls)-/.test(url))).toBe(false)
})

test('streams Markdown beside native surfaces without waiting for the final response', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  answer.message = ''
  answer.isAddedToHistory = false
  answer.answerParts = auroraParts(history.at(-2)!.messageId)
  const part = answer.answerParts[0]!
  if (part.kind === 'ui') {
    part.surface.status = 'draft'
    part.surface.purpose = 'answer'
  }
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  await page.goto(SESSION_URL)
  await expect(page.getByRole('region', { name: 'How would you like to start?', exact: true })).toBeVisible()
  const event = { sequence: 1, session_id: SESSION_ID, turn_id: null, response_id: answer.messageId, created_at: Date.now() }
  await ui.emit([{ ...event, type: 'text_stream', data: { kind: 'answer', generationId: 'live-answer', token: 'A new idea is taking shape.' } }])
  await expect(page.getByText('A new idea is taking shape.', { exact: true })).toBeVisible()
  await ui.emit([{ ...event, sequence: 2, type: 'answer_parts', data: { answer_parts: structuredClone(answer.answerParts) } }])
  await expect(page.getByText('A new idea is taking shape.', { exact: true })).toBeVisible()
  await ui.emit([{ ...event, sequence: 3, type: 'text_stream', data: { kind: 'answer', generationId: 'live-answer', reset: true } }])
  await expect(page.getByText('A new idea is taking shape.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'How would you like to start?', exact: true })).toBeVisible()
  await ui.emit([{ ...event, sequence: 4, type: 'error', data: { message: 'I could not finish this answer. Please try again.' } }])
  await expect(page.getByRole('region', { name: 'Session messages', exact: true })
    .getByText('I could not finish this answer. Please try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'How would you like to start?', exact: true })
    .getByRole('radio').first()).toBeDisabled()
})

test('places retained files once, between native text inside the final answer', async ({ page, ui }) => {
  const history = ui.history.get(SESSION_ID)!
  const answer = history.at(-1)!
  const url = `/api/v1/artifacts/${SESSION_ID}/garden-plan`
  answer.artifacts = [{ id: 'garden-plan', session_id: SESSION_ID, filename: 'garden.pdf',
    mime_type: 'application/pdf', size_bytes: 2_048, created_at: Date.now(), source: 'fixture', url }]
  answer.answerParts = auroraParts(history.at(-2)!.messageId, {
    root: 'layout', elements: {
      layout: { type: 'Stack', props: {}, children: ['intro', 'files', 'closing'] },
      intro: { type: 'Text', props: { text: 'Here is a little garden plan.' } },
      files: { type: 'Artifacts', props: { title: 'Your garden plan', artifactIds: ['garden-plan'] } },
      closing: { type: 'Text', props: { text: 'There is room to make it your own.' } }
    }
  })
  history.push({ who: 'leon', messageId: 'artifacts:fixture', message: '', sentAt: Date.now(),
    isAddedToHistory: true, artifacts: answer.artifacts })
  await page.goto(SESSION_URL)
  const response = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
  const files = response.getByRole('region', { name: 'Your garden plan', exact: true })
  await expect(files.getByRole('figure')).toContainText('garden.pdf')
  await expect(page.getByRole('figure')).toHaveCount(1)
  await expect(files.getByRole('link', { name: 'Download', exact: true })).toHaveAttribute('href', `${url}?download=true`)
  await expect(files.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute('href', url)
  const introText = response.getByText('Here is a little garden plan.', { exact: true })
  const closingText = response.getByText('There is room to make it your own.', { exact: true })
  await expect(introText).toBeVisible()
  await expect(closingText).toBeVisible()
  const intro = await introText.boundingBox()
  const file = await files.boundingBox()
  const closing = await closingText.boundingBox()
  expect(intro!.y).toBeLessThan(file!.y)
  expect(file!.y).toBeLessThan(closing!.y)
})

for (const form of [false, true]) {
  test(`keeps ${form ? 'form details' : 'choices'} readable when the optional renderer cannot load`, async ({ page, ui }) => {
    const history = ui.history.get(SESSION_ID)!
    const answer = history.at(-1)!
    answer.answerParts = auroraParts(history.at(-2)!.messageId, form ? AURORA_FORM_SPEC : undefined)
    await page.route('**/assets/aurora-surface-*.js', (route) => route.abort())
    await page.goto(SESSION_URL)
    await expect(page.getByText('I couldn’t display the interactive version. You can still read it here and reply below.', { exact: true })).toBeVisible()
    const question = page.getByRole('region', { name: form ? 'A little project' : 'How would you like to start?', exact: true })
    await expect(question).toBeVisible()
    await expect(question.getByRole('button')).toHaveCount(0)
    await expect(question.getByRole('listitem')).toContainText(form
      ? ['Project name', 'Pace', 'Notes'] : ['A quiet morning', 'Something creative'])
    if (form) {
      await expect(question).toContainText('A gentle pace')
      await expect(question).toContainText('A focused afternoon')
    }
    const composer = page.getByRole('textbox', { name: 'Message Leon', exact: true })
    await composer.fill('Here is my answer.')
    await expect(composer).toHaveValue('Here is my answer.')
  })
}

test('keeps a measured file list in the answer and cancels only after server acknowledgement', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = ''
  answer.isAddedToHistory = false
  const preparation = { status: PreparationStatus.Downloading, detail: 'Downloading the speech model',
    executionId: 'speech-preparation', downloads: [
      { id: 'config', fileName: 'config.json', status: 'complete' as const,
        downloadedBytes: 1_024, totalBytes: 1_024, etaMs: null },
      { id: 'model', fileName: 'model.safetensors', status: 'downloading' as const,
        downloadedBytes: 40, totalBytes: 100, etaMs: 10_000 },
      { id: 'vocabulary', fileName: 'vocabulary.json', status: 'queued' as const,
        downloadedBytes: 0, totalBytes: null, etaMs: null }
    ] }
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [{
    id: 'speech-call', name: 'speech.asr.transcribe', status: 'running', startedAt: Date.now(),
    toolCallTitle: 'Transcribe the recording', toolkitName: 'Speech', toolName: 'Speech recognition', preparation
  }] }
  ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
  const pending = Promise.withResolvers<Route>()
  let cancellations = 0
  await page.route('**/api/v1/tool-executions/cancel', async (route) => {
    cancellations += 1
    expect(route.request().postDataJSON()).toEqual({ sessionId: SESSION_ID, executionId: preparation.executionId })
    pending.resolve(route)
  })
  await page.goto(SESSION_URL)
  const widget = page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
    .getByRole('region', { name: 'Getting files ready', exact: true })
  await expect(widget.getByRole('listitem')).toHaveCount(3)
  await expect(widget.getByText('40%', { exact: true })).toHaveCount(1)
  await expect(widget).toContainText('40 B / 100 B · ETA 10s')
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '40')
  const event = { session_id: SESSION_ID, turn_id: null, response_id: answer.messageId, created_at: Date.now() }
  const tool = { id: 'speech-call', name: 'speech.asr.transcribe', status: 'running', preparation }
  await ui.emit([{ ...event, sequence: 1, type: 'tool_call', data: { tool_call: {
    ...tool, preparation: { ...preparation, downloads: preparation.downloads.map((file) =>
      file.id === 'model' ? { ...file, downloadedBytes: 65 } : file) }
  } } }])
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '65')
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click()
  const route = await pending.promise
  await expect(widget.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect(widget.getByRole('progressbar')).toBeVisible()
  await route.fulfill({ json: { execution: { state: 'canceled' } } })
  await expect(page.getByText('I cancelled the preparation', { exact: true })).toBeVisible()
  const cancelled = { ...preparation, status: PreparationStatus.Cancelled, detail: 'The preparation was cancelled.',
    downloads: preparation.downloads.map((file) => file.status === 'complete' ? file
      : { ...file, status: 'cancelled' as const, etaMs: null }) }
  await ui.emit([{ ...event, sequence: 2, type: 'tool_call', data: { tool_call: { ...tool, status: 'error', preparation: cancelled } } }])
  await expect(widget.getByText('Cancelled', { exact: true })).toHaveCount(2)
  await expect(widget.getByRole('progressbar')).toHaveCount(0)
  expect(cancellations).toBe(1)
  answer.agentResponseTrace!.toolCalls[0]!.preparation = cancelled
  answer.agentResponseTrace!.toolCalls[0]!.status = 'error'
  await page.reload()
  await expect(widget.getByRole('listitem')).toHaveCount(3)
  await expect(widget.getByText('Cancelled', { exact: true })).toHaveCount(2)
})

test('keeps retained preparation updates separate from accepted answer text and turn timing', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.message = 'The model is downloading. We can keep talking while it finishes.'
  const preparation = { status: PreparationStatus.Downloading, detail: 'Downloading the speech model',
    executionId: 'retained-preparation', completed: 25, total: 100 }
  answer.agentResponseTrace = { id: answer.messageId, planSteps: [], toolCalls: [{
    id: 'retained-call', name: 'speech.asr.transcribe', status: 'running', startedAt: Date.now(),
    toolCallTitle: 'Prepare the speech model', preparation
  }], metrics: { durationMs: 7_000 } }
  await page.goto(SESSION_URL)
  const widget = page.getByRole('region', { name: 'Getting files ready', exact: true })
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '25')
  await ui.emit([{ type: 'tool_call', sequence: 1, session_id: SESSION_ID, turn_id: null,
    response_id: answer.messageId, created_at: Date.now(), data: { tool_call: {
      id: 'retained-call', name: 'speech.asr.transcribe', status: 'running', preparation: { ...preparation, completed: 75 }
    } } }])
  await expect(widget.getByRole('progressbar')).toHaveAttribute('value', '75')
  await expect(page.getByRole('button', { name: 'Worked for 7s', exact: true })).toBeVisible()
  await expect(page.getByText(answer.message, { exact: true })).toBeVisible()
  await ui.emit([{ type: 'tool_call', sequence: 2, session_id: SESSION_ID, turn_id: null,
    response_id: 'unloaded-answer', created_at: Date.now(), data: { background: true, tool_call: {
      id: 'other-call', name: 'speech.asr.transcribe', status: 'running', preparation
    } } }])
  await expect(page.getByRole('button', { name: 'Worked for', exact: false })).toHaveCount(1)
})
