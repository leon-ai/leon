export const PLAN_STEP_PROPERTIES_SCHEMA = {
  function: { type: 'string' },
  label: { type: 'string' },
  agent_skill_id: { type: 'string' }
}

export const PLAN_STEP_SCHEMA = {
  type: 'object',
  properties: PLAN_STEP_PROPERTIES_SCHEMA,
  required: ['function', 'label'],
  additionalProperties: false
}

const NULLABLE_PLAN_STEPS_SCHEMA = {
  anyOf: [
    {
      type: 'array',
      items: PLAN_STEP_SCHEMA
    },
    { type: 'null' }
  ]
}

const NULLABLE_STRING_SCHEMA = {
  anyOf: [{ type: 'string' }, { type: 'null' }]
}

const NULLABLE_PLAN_INTENT_SCHEMA = {
  anyOf: [
    {
      type: 'string',
      enum: ['answer', 'clarification', 'cancelled', 'error']
    },
    { type: 'null' }
  ]
}

export const PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['plan', 'final'] },
    steps: NULLABLE_PLAN_STEPS_SCHEMA,
    summary: NULLABLE_STRING_SCHEMA,
    answer: NULLABLE_STRING_SCHEMA,
    intent: NULLABLE_PLAN_INTENT_SCHEMA
  },
  required: ['type', 'steps', 'summary', 'answer', 'intent'],
  additionalProperties: false
}
