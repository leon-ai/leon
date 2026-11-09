import type { AnswerPart, AuroraSpec } from '../../aurora/src/v2/contracts/answer'

export const AURORA_QUERY_EXAMPLES = {
  boolean: 'Help me polish this note: “Hey, thanks for helping today!” Before you rewrite it, find out whether I want to keep the casual tone.',
  'single-choice': 'Help me plan Sunday morning. First, find out whether I’d prefer a quiet morning, something creative or time outside.',
  'multi-choice': 'Help me plan a weekend around what I enjoy. First, find out which of cooking, reading, walking and drawing I want to include. I might choose more than one.',
  form: 'Help me shape a small project. Before making a plan, gather its name, whether I want a gentle or focused pace, and any notes.',
  'connection-notion': 'Help me connect my Notion account so we can work with my pages.',
  'connection-spotify': 'Help me connect Spotify so I can choose music with you.',
  'connection-ticktick': 'Help me connect TickTick so we can organize my tasks.',
  'data-table': 'Here are my reading notes: Monday 20 minutes, Tuesday 35, Wednesday 25, Thursday 45, Friday 15, Saturday 50 and Sunday 30. Organize them so I can easily find a day and compare the times.',
  comparison: 'Compare these two places for a quiet weekend: a cottage costing ¥600 with a kitchen and a garden, and a studio costing ¥400 with a kitchen but no garden. Help me see what differs.',
  chart: 'My reading time was 20, 35, 25 and 45 minutes from Monday to Thursday. Help me see how it changed and compare the days.',
  'reading-dashboard': 'I read for 20, 35, 25 and 45 minutes from Monday to Thursday. Help me compare those days and explore a daily reading goal between 10 and 60 minutes. Let me choose a goal to plan next week around.',
  'savings-calculator': 'I want to put aside a little money each month. Help me explore how changing my monthly saving from ¥100 to ¥2000 changes the total after a year, without interest.',
  'light-explorer': 'Help me understand how a lamp gets dimmer as I move it farther away. Let me explore the distance from one to four metres and compare it with the brightness at one metre.',
  'memory-map': 'Help me understand how your working context relates to temporary context, memory stores and conversation archives. Let me explore each source without losing sight of the overview.'
} as const

export const AURORA_PRESENTATION_SPEC: AuroraSpec = {
  root: 'presentation', elements: {
    presentation: { type: 'Stack', props: {}, children: ['data-table', 'comparison', 'chart'] },
    'data-table': { type: 'DataTable', props: { title: 'Reading notes', columns: [
      { key: 'day', label: 'Day' }, { key: 'minutes', label: 'Minutes' }
    ], rows: Array.from({ length: 16 }, (_, index) => ({
      id: `day-${index + 1}`, values: { day: `Day ${index + 1}`, minutes: (index + 1) * 5 }
    })) } },
    comparison: { type: 'Comparison', props: { title: 'A quiet weekend', criteria: [
      { key: 'price', label: 'Price (CNY)' }, { key: 'kitchen', label: 'Kitchen' }, { key: 'garden', label: 'Garden' }
    ], options: [
      { id: 'cottage', title: 'Cottage', values: { price: 600, kitchen: true, garden: true } },
      { id: 'studio', title: 'Studio', values: { price: 400, kitchen: true, garden: false } }
    ] } },
    chart: { type: 'Chart', props: { title: 'A little time to read', kind: 'bar', unit: 'min',
      categories: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], series: [{ label: 'Reading', values: [20, 35, 25, 45] }] } }
  }
}

export const AURORA_RETIRED_RESULTS_SPEC: AuroraSpec = {
  root: 'results', elements: {
    results: { type: 'Results', props: { title: 'A few places to begin', items: [
      { id: 'website', title: 'Meet Leon', description: 'An introduction to the project.', url: 'https://getleon.ai', source: 'Leon website' },
      { id: 'repository', title: 'Explore the source', description: 'The code and community behind Leon.', url: 'https://github.com/leon-ai/leon', source: 'GitHub' }
    ] } }
  }
}

export const AURORA_CHOICE_SPEC: AuroraSpec = {
  root: 'layout',
  elements: {
    layout: { type: 'Stack', props: {}, children: ['intro', 'choice'] },
    intro: { type: 'Text', props: { text: 'A little room for a new idea.' } },
    choice: { type: 'Choice', props: { title: 'How would you like to start?', options: [
      { value: 'quiet', label: 'A quiet morning' },
      { value: 'creative', label: 'Something creative' }
    ] } }
  }
}

export const AURORA_GENERATED_SPEC: AuroraSpec = {
  root: 'reading', elements: {
    reading: { type: 'Generated', props: {
      title: 'A little room for reading', height: 560,
      fallback: 'Reading time: Monday 20 min, Tuesday 35 min, Wednesday 25 min, Thursday 45 min. Total 125 min; average 31.25 min per day. Choose a daily goal between 10 and 60 minutes.',
      fields: [{ name: 'minutes', label: 'Daily reading goal (minutes)', type: 'number', required: true }],
      html: `<p>Small moments add up. Here is your reading time so far.</p>
        <div id="reading-chart" role="img" aria-label="Reading minutes by day" style="height:280px"></div>
        <label for="goal">Daily reading goal <output id="goal-value">30 min</output></label>
        <input id="goal" type="range" min="10" max="60" value="30" step="5">
        <p id="week-total"></p><div id="aurora-goal-action"></div>
        <details><summary>Reading data</summary><table><thead><tr><th>Day</th><th>Minutes</th></tr></thead>
        <tbody><tr><td>Monday</td><td>20</td></tr><tr><td>Tuesday</td><td>35</td></tr><tr><td>Wednesday</td><td>25</td></tr><tr><td>Thursday</td><td>45</td></tr></tbody></table></details>`,
      css: 'p{margin:0 0 var(--space-md)}label{display:flex;justify-content:space-between;gap:var(--space-sm)}input[type=range]{width:100%;margin:var(--space-md) 0}table{width:100%;text-align:left;border-collapse:collapse}th,td{padding:var(--space-xs);border-bottom:1px solid var(--color-border-secondary)}details{margin-top:var(--space-lg);color:var(--color-text-secondary)}summary{cursor:pointer}',
      javascript: `const goal = document.getElementById('goal');
const saved = Aurora.state.get();
goal.value = String(saved.minutes || 30);
const chart = await Aurora.chart(document.getElementById('reading-chart'), {
  grid: {left:36,right:16,top:24,bottom:36},
  tooltip: {trigger:'axis'},
  xAxis: {type:'category',data:['Mon','Tue','Wed','Thu']},
  yAxis: {type:'value',name:'min',max:60},
  series: [{name:'Reading',type:'bar',data:[20,35,25,45]}]
});
function update() {
  document.getElementById('goal-value').textContent = goal.value + ' min';
  document.getElementById('week-total').textContent = 'Your goal for a week: ' + Number(goal.value)*7 + ' minutes. There is no rush.';
  Aurora.state.set({minutes:Number(goal.value)});
}
goal.addEventListener('input', update);
Aurora.render(Aurora.h(Aurora.Button, {variant:'secondary', onClick:()=>Aurora.submit({minutes:goal.value})}, 'Plan around this goal'));
update();`
    } }
  }
}

export const AURORA_CALCULATOR_SPEC: AuroraSpec = {
  root: 'savings', elements: { savings: { type: 'Generated', props: {
    title: 'A small saving habit', height: 220,
    fallback: 'Without interest, your yearly saving is your monthly amount multiplied by 12. ¥500 per month becomes ¥6000 after a year.',
    html: '<label for="saving">Monthly saving</label><input id="saving" type="range" min="100" max="2000" step="100" value="500"><p><output id="monthly"></output> a month</p><h3><output id="yearly"></output> after a year</h3><p>No interest included. Start with what feels comfortable.</p>',
    css: 'input{display:block;width:100%;margin:var(--space-lg) 0}h3{color:var(--color-accent);font-size:var(--font-size-3xl)}p{color:var(--color-text-secondary)}',
    javascript: `const saving = document.getElementById('saving');
saving.value = String(Aurora.state.get().monthly || 500);
function update(){const value=Number(saving.value);document.getElementById('monthly').textContent='¥'+value;document.getElementById('yearly').textContent='¥'+value*12;Aurora.state.set({monthly:value});}
saving.addEventListener('input',update);update();`
  } } }
}

export const AURORA_LIGHT_SPEC: AuroraSpec = {
  root: 'light', elements: { light: { type: 'Generated', props: {
    title: 'A little light, a little distance', height: 280,
    fallback: 'For a point light source, brightness follows the inverse-square law: twice the distance gives one quarter of the brightness. At four metres it is one sixteenth of the brightness at one metre.',
    html: '<svg viewBox="0 0 520 120" role="img" aria-label="A lamp and a moving surface"><circle cx="30" cy="60" r="16" fill="var(--color-yellow)"/><path d="M50 25L490 5M50 95L490 115" stroke="var(--color-border-strong)"/><rect id="surface" x="150" y="20" width="16" height="80" rx="4" fill="var(--color-accent)"/></svg><label for="distance">Distance in metres</label><input id="distance" type="range" min="1" max="4" step="0.1" value="1"><p id="brightness"></p><small>Ideal point source; no reflections or other lights.</small>',
    css: 'svg{display:block;width:100%}input{width:100%;display:block;margin:var(--space-md) 0}small{color:var(--color-text-secondary)}',
    javascript: 'const distance=document.getElementById(\'distance\');distance.value=String(Aurora.state.get().distance||1);function update(){const metres=Number(distance.value);const fraction=1/(metres*metres);const surface=document.getElementById(\'surface\');surface.setAttribute(\'x\',String(90+metres*90));surface.style.opacity=String(Math.max(.15,fraction));document.getElementById(\'brightness\').textContent=metres.toFixed(1)+\' m — \'+(fraction*100).toFixed(1)+\'% of the brightness at one metre\';Aurora.state.set({distance:metres});}distance.addEventListener(\'input\',update);update();'
  } } }
}

export const AURORA_MEMORY_SPEC: AuroraSpec = {
  root: 'memory', elements: { memory: { type: 'Generated', props: {
    title: 'A little map of memory',
    fallback: 'Working context contains the current conversation, task and selected knowledge. Temporary context holds current circumstances, memory stores hold discussion, daily and persistent records, and archives hold original conversations. These are parallel sources for selective recall, not a retention ladder.',
    html: `<div class="memory-map">
      <div class="memory-context"><strong>Working context</strong><p>The conversation, the task, and only the knowledge that helps now.</p></div>
      <svg class="memory-connections" viewBox="0 0 600 56" aria-hidden="true"><path d="M100 55V28H500V55M300 55V1M292 9L300 1L308 9"/></svg>
      <div id="memory-source-actions"></div>
      <p class="memory-caption">Three sources for selective recall. Choose one to explore.</p>
      <section class="memory-detail" aria-live="polite"><h3 id="memory-title"></h3><p id="memory-description"></p></section>
      <p class="memory-note">Parallel sources, not stages that every fact passes through.</p>
    </div>`,
    css: `.memory-map{font-size:var(--font-size-md);line-height:var(--line-height-md)}
      .memory-context{text-align:center;padding:var(--space-lg);border-radius:var(--border-radius-md);background:var(--color-accent-soft)}
      .memory-context strong{font-weight:var(--font-weight-semi-bold)}.memory-context p{margin:var(--space-sm) 0 0}
      .memory-connections{display:block;width:100%;height:56px;fill:none;stroke:var(--color-border-strong);stroke-width:1.5}
      .memory-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-sm)}
      .memory-caption,.memory-note{font-size:var(--font-size-sm);line-height:var(--line-height-sm);color:var(--color-text-secondary);margin:var(--space-md) 0 0}
      .memory-detail{margin-top:var(--space-xl);padding-top:var(--space-lg);border-top:1px solid var(--color-border-secondary)}
      .memory-detail h3{font-size:var(--font-size-lg);line-height:var(--line-height-lg);margin-bottom:var(--space-sm)}
      .memory-detail p{margin:0}.memory-note{margin-top:var(--space-xl)}
      @media(max-width:480px){.memory-sources{grid-template-columns:1fr;margin-top:var(--space-lg)}.memory-connections{display:none}}`,
    javascript: `const sources = [
  {id:'temporary',label:'Temporary',title:'What is true for now',description:'Current circumstances shared across sessions, kept with a bounded lifetime in temporary context.'},
  {id:'stores',label:'Memory stores',title:'What helps across conversations',description:'Discussion preserves recent working context. Daily memory keeps summaries and timelines. Persistent memory holds durable facts and preferences. Relevant records are retrieved when needed.'},
  {id:'archives',label:'Archives',title:'The original conversation',description:'Original messages stay available as evidence when exact wording or history matters.'}
];
let selected = Aurora.state.get().source || 'stores';
function show(id) {
  const source = sources.find(item => item.id === id) || sources[1];
  selected = source.id;
  document.getElementById('memory-title').textContent = source.title;
  document.getElementById('memory-description').textContent = source.description;
  Aurora.state.set({source:selected});
  Aurora.render(Aurora.h('div',{className:'memory-sources'},...sources.map(item => Aurora.h(Aurora.Button,{
    key:item.id,variant:item.id === selected ? 'primary':'secondary',ariaPressed:item.id === selected,onClick:()=>show(item.id)
  },item.label))));
}
document.getElementById('memory-source-actions').appendChild(document.getElementById('aurora-root'));
show(selected);`
  } } }
}

export const AURORA_FORM_SPEC: AuroraSpec = {
  root: 'project', elements: {
    project: { type: 'Form', props: { title: 'A little project', fields: [
      { name: 'name', label: 'Project name', type: 'text', required: true },
      { name: 'pace', label: 'Pace', type: 'select', required: true, options: [
        { value: 'gentle', label: 'A gentle pace' }, { value: 'focused', label: 'A focused afternoon' }
      ] },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ] } }
  }
}

/**
 * Makes persisted and streamed fixtures share the same native UI contract.
 */
export function auroraParts(ownerMessageId: string, spec: AuroraSpec = AURORA_CHOICE_SPEC): AnswerPart[] {
  return [{ id: 'surface-one', kind: 'ui', surface: {
    id: 'surface-one', revision: 1, status: 'ready', purpose: 'clarification',
    spec: structuredClone(spec), receipts: {}, ownerMessageId
  } }]
}
