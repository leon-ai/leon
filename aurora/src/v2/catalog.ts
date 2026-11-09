/**
 * Names the public building blocks independently of React or a model provider.
 */
export const AURORA_CATALOG = [
  { id: 'button', kind: 'component', title: 'Buttons', description: 'Actions, toggles and submission states.' },
  { id: 'input', kind: 'component', title: 'Inputs', description: 'Native text fields with shared typing and selection.' },
  { id: 'selection', kind: 'component', title: 'Selections', description: 'Keyboard-accessible radio and checkbox rows.' },
  { id: 'range', kind: 'component', title: 'Ranges', description: 'Native sliders with the shared accent and focus treatment.' },
  { id: 'switch', kind: 'component', title: 'Switches', description: 'A clear on/off setting with native keyboard behavior.' },
  { id: 'segmented', kind: 'component', title: 'Segmented controls', description: 'Compact, mutually exclusive settings.' },
  { id: 'tabs', kind: 'component', title: 'Tabs', description: 'Keyboard navigation between related views.' },
  { id: 'number-stepper', kind: 'component', title: 'Number steppers', description: 'Native numeric constraints with explicit increment and decrement actions.' },
  { id: 'search-select', kind: 'component', title: 'Searchable selection', description: 'Find one or several options without leaving the keyboard.' },
  { id: 'loader', kind: 'component', title: 'Loaders', description: 'Small and medium indeterminate indicators.' },
  { id: 'progress', kind: 'component', title: 'Progress', description: 'Measured progress and unknown totals.' },
  { id: 'surface', kind: 'component', title: 'Surfaces', description: 'Quiet containers for related information.' },
  { id: 'boolean', kind: 'widget', title: 'Boolean choice', description: 'Answer yes or no directly, without another confirmation.' },
  { id: 'single-choice', kind: 'widget', title: 'Single choice', description: 'Activate an option to continue; arrow keys only browse.' },
  { id: 'multi-choice', kind: 'widget', title: 'Multiple choice', description: 'Choose several options together.' },
  { id: 'form', kind: 'widget', title: 'Form', description: 'Labelled fields, native validation and a submission receipt.' },
  { id: 'preparation', kind: 'widget', title: 'Tool preparation', description: 'Preparing, downloading, ready, failed and cancelled.' },
  { id: 'artifacts', kind: 'widget', title: 'Artifacts', description: 'Images, audio, video and document cards inside an answer.' },
  { id: 'data-table', kind: 'widget', title: 'Data table', description: 'Searchable, sortable data with small pages and horizontal scrolling.' },
  { id: 'comparison', kind: 'widget', title: 'Comparison', description: 'Compare the same criteria and focus on differences.' },
  { id: 'chart', kind: 'widget', title: 'Chart', description: 'Interactive bar, line and pie charts with a readable data view.' },
  { id: 'reading-dashboard', kind: 'generated', title: 'Reading dashboard', description: 'A bespoke chart, goal slider and optional conversation action.' },
  { id: 'savings-calculator', kind: 'generated', title: 'Savings calculator', description: 'A custom local calculation without loading a chart engine.' },
  { id: 'light-explorer', kind: 'generated', title: 'Light explorer', description: 'An interactive SVG explanation with a distance control.' },
  { id: 'memory-map', kind: 'generated', title: 'Memory map', description: 'A connected overview with meaningful source selection and readable detail.' }
] as const
