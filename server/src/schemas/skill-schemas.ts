import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

import { globalResolverSchemaObject } from '@/schemas/global-data-schemas'
import { SkillBridges } from '@/core/brain/types'
import { NLPAction } from '@/core/nlp/types'

const SKILL_ACTION_ANSWERS_DESCRIPTION =
  'Answers are the responses that Leon can give to the owners. They can be simple strings or objects with speech and text properties to differentiate between spoken and written responses.'

const actionParametersType = Type.Recursive((self) =>
  Type.Union([
    Type.Object({}), // Base case for nested objects
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Array(self), // Recursive for arrays
    Type.Literal('custom'), // Enums via literals
    Type.Object({
      type: Type.Literal('object'),
      properties: Type.Record(Type.String(), self),
      description: Type.Optional(
        Type.String({
          minLength: 8,
          maxLength: 128
        })
      )
    }),
    Type.Object({
      type: Type.Literal('string'),
      enum: Type.Optional(Type.Array(Type.String())),
      description: Type.Optional(
        Type.String({
          minLength: 8,
          maxLength: 128
        })
      )
    }),
    Type.Object({
      type: Type.Literal('number'),
      description: Type.Optional(
        Type.String({
          minLength: 8,
          maxLength: 128
        })
      )
    })
  ])
)
const skillBridges = [
  Type.Literal(SkillBridges.Python),
  Type.Literal(SkillBridges.NodeJS),
  Type.Null()
]
const skillActionTypes = [
  Type.Literal('logic', {
    description: 'It runs the business logic implemented in actions via code.'
  }),
  Type.Literal('dialog', {
    description:
      "Action that don't need code to run. Leon actually just answers without any business logic."
  })
]
const skillDataTypes = [
  Type.Literal('skill_resolver'),
  Type.Literal('global_resolver'),
  Type.Literal('entity'),
  Type.Literal('utterance')
]
const answerTypes = Type.Union(
  [
    Type.String(),
    Type.Object({
      speech: Type.String(),
      text: Type.Optional(Type.String())
    })
  ],
  {
    description: SKILL_ACTION_ANSWERS_DESCRIPTION
  }
)
const skillCustomEnumEntityType = Type.Object(
  {
    type: Type.Literal('enum', {
      description:
        'Enum: define a bag of words and synonyms that should match your new entity.'
    }),
    name: Type.String(),
    options: Type.Record(
      Type.String({ minLength: 1 }),
      Type.Object({
        synonyms: Type.Array(Type.String({ minLength: 1 }))
      })
    )
  },
  {
    additionalProperties: false
  }
)
const skillCustomRegexEntityType = Type.Object(
  {
    type: Type.Literal('regex', {
      description: 'Regex: you can create an entity based on a regex.'
    }),
    name: Type.String({ minLength: 1 }),
    regex: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
)
const skillCustomTrimEntityType = Type.Object(
  {
    type: Type.Literal('trim', {
      description:
        'Trim: you can pick up a data from an utterance by clearly defining conditions (e.g: pick up what is after the last "with" word of the utterance).'
    }),
    name: Type.String({ minLength: 1 }),
    conditions: Type.Array(
      Type.Object(
        {
          type: Type.Union([
            Type.Literal('between'),
            Type.Literal('after'),
            Type.Literal('after_first'),
            Type.Literal('after_last'),
            Type.Literal('before'),
            Type.Literal('before_first'),
            Type.Literal('before_last')
          ]),
          from: Type.Optional(
            Type.Union([
              Type.Array(Type.String({ minLength: 1 })),
              Type.String({ minLength: 1 })
            ])
          ),
          to: Type.Optional(
            Type.Union([
              Type.Array(Type.String({ minLength: 1 })),
              Type.String({ minLength: 1 })
            ])
          )
        },
        {
          additionalProperties: false
        }
      )
    )
  },
  { additionalProperties: false }
)
const skillCustomLLMEntityType = Type.Object(
  {
    type: Type.Literal('llm', {
      description:
        'LLM: you can define an entity based on a JSON schema and the LLM (Large Language Model) will be able to grab it by itself based on the schema.'
    }),
    schema: Type.Object(
      {
        /**
         * Any key is allowed
         * @see https://github.com/withcatai/node-llama-cpp/blob/6b012a6/src/utils/gbnfJson/types.ts#L2
         */
      },
      { additionalProperties: true }
    )
  },
  { additionalProperties: false }
)
const skillCustomEntityTypes = [
  Type.Array(skillCustomTrimEntityType),
  Type.Array(skillCustomRegexEntityType),
  Type.Array(skillCustomEnumEntityType),
  Type.Array(skillCustomLLMEntityType)
]

export const domainSchemaObject = Type.Strict(
  Type.Object({
    name: Type.String({ minLength: 1, description: 'The name of the domain.' })
  })
)

export const skillLocaleConfigObject = Type.Strict(
  Type.Object({
    variables: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          'Variables are used to define dynamic values that can be used in the locale configuration.'
      })
    ),
    common_answers: Type.Optional(
      Type.Record(Type.String(), Type.Array(answerTypes), {
        description:
          'Common answers are used to avoid repeating the same answers across different actions. They can be used to define answers that can be reused in multiple actions.'
      })
    ),
    widget_contents: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Array(Type.String())], {
          description:
            'Widget contents are used to define the content of the widgets that will be displayed in the UI.'
        })
      )
    ),
    actions: Type.Record(
      Type.String(),
      Type.Object({
        answers: Type.Optional(
          Type.Union([
            Type.Record(Type.String(), Type.Array(answerTypes), {
              description: SKILL_ACTION_ANSWERS_DESCRIPTION
            }),
            Type.Array(answerTypes)
          ])
        ),
        missing_param_follow_ups: Type.Optional(
          Type.Record(
            Type.String(),
            Type.Array(Type.String(), {
              description:
                'Missing parameter follow-ups are used to ask the owner for more information when a required parameter is missing. They are used to be customized and to guide the owner to provide the necessary information to complete the action.'
            })
          )
        ),
        // TODO: core rewrite
        // unknown_answers: Type.Optional(Type.Array(answerTypes)),
        suggestions: Type.Optional(
          Type.Array(Type.String(), {
            description:
              'Suggestions are a simple way to suggest owners what can be answered next.'
          })
        )
      })
    )
  })
)
export const skillSchemaObject = Type.Strict(
  Type.Object({
    name: Type.String({ minLength: 1, description: 'The name of the skill.' }),
    bridge: Type.Union(skillBridges, { description: 'Bridge SDK.' }),
    version: Type.String({
      minLength: 1,
      description: 'Version following semver.'
    }),
    description: Type.String({
      minLength: 1,
      description: 'This helps people understand what your skill does.'
    }),
    author: Type.Object(
      {
        name: Type.String({ minLength: 1, description: 'Name of the author.' }),
        email: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 254,
            format: 'email',
            description: 'Email address of the author.'
          })
        ),
        url: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 255,
            format: 'uri',
            description: 'Website of the author.'
          })
        )
      },
      {
        additionalProperties: false,
        description:
          'A person who has been involved in creating or maintaining this skill.'
      }
    ),
    flow: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'The flow is a sequence of actions that will be executed in order. Only the first action in the flow will be added to the action calling to avoid overloading the context with too many actions.'
      })
    ),
    actions: Type.Record(
      Type.String(),
      Type.Object(
        {
          type: Type.Union(skillActionTypes),
          description: Type.String({
            minLength: 16,
            maxLength: 128,
            description:
              'This helps to understand what your action does. Also used by the LLM (Large Language Model) to match the action.'
          }),
          is_loop: Type.Optional(
            Type.Boolean({
              description:
                'An action loop is a concept to keep Leon triggering the same skill action until the logic of the skill breaks the loop.'
            })
          ),
          parameters: Type.Optional(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            Type.Record(Type.String(), actionParametersType, {
              description:
                'Parameters are used to define the data that the action expects to receive. They can be used to pass data from the utterance to the action code.'
            })
          ),
          optional_parameters: Type.Optional(
            Type.Array(
              Type.String({
                minLength: 1,
                description:
                  'By default, all parameters are required, but you can define optional parameters that can be used to pass data to the action code. They are not mandatory and can be omitted.'
              })
            )
          )
        },
        { additionalProperties: false }
      ),
      {
        description:
          'Actions are the functions that are triggered within a skill, they define what Leon can do with this skill.'
      }
    ),
    action_notes: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Action notes are used to provide additional information about the action when prompting the LLM (Large Language Model).'
      })
    )
  })
)
export const skillConfigSchemaObject = Type.Strict(
  Type.Object({
    variables: Type.Optional(Type.Record(Type.String(), Type.String())),
    actions: Type.Record(
      Type.String(),
      Type.Object(
        {
          type: Type.Union(skillActionTypes),
          disable_llm_nlg: Type.Optional(
            Type.Boolean({
              description:
                'Disable the LLM (Large Language Model) for NLG (Natural Language Generation) in the action.'
            })
          ),
          loop: Type.Optional(
            Type.Object(
              {
                expected_item: Type.Object(
                  {
                    type: Type.Union(skillDataTypes),
                    name: Type.String()
                  },
                  {
                    description:
                      'An item can be a entity, a resolver or an utterance.'
                  }
                )
              },
              {
                additionalProperties: false,
                description:
                  'The action loop is a concept to keep Leon triggering the same skill action until the logic of the skill breaks the loop according to new utterances content.'
              }
            )
          ),
          http_api: Type.Optional(
            Type.Object(
              {
                entities: Type.Array(
                  Type.Object(
                    {
                      entity: Type.String(),
                      resolution: Type.Array(Type.String())
                    },
                    { additionalProperties: false }
                  )
                )
              },
              { additionalProperties: false }
            )
          ),
          utterance_samples: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Utterance samples are used by the NLU (Natural Language Understanding) to train the skill. They are examples of what Leon owners can say to trigger the skill action.'
            })
          ),
          answers: Type.Optional(Type.Array(answerTypes)),
          unknown_answers: Type.Optional(Type.Array(answerTypes)),
          suggestions: Type.Optional(
            Type.Array(Type.String(), {
              description:
                'Suggestions are a simple way to suggest Leon owners what can be answered next.'
            })
          ),
          slots: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  name: Type.String(),
                  item: Type.Object(
                    {
                      type: Type.Union(skillDataTypes),
                      name: Type.String()
                    },
                    { additionalProperties: false }
                  ),
                  questions: Type.Array(Type.String()),
                  suggestions: Type.Optional(
                    Type.Array(Type.String(), {
                      description:
                        'Suggestions are a simple way to suggest Leon owners what can be answered next.'
                    })
                  )
                },
                {
                  additionalProperties: false,
                  description:
                    'A slot expects a type of data called "item", and makes use of questions to let Leon owners knows what data they need to provide.'
                }
              ),
              {
                description:
                  'Depending on how skill developers wants to design their skill, they have the possibility to ask for more information before to get to the meat of the skill. In this way, Leon can gather these information to operate the skill in a complete manner. These information are called "slots".'
              }
            )
          ),
          entities: Type.Optional(Type.Union(skillCustomEntityTypes)),
          next_action: Type.Optional(
            Type.String({
              description:
                'The next action property is useful when a skill needs to follow a specific order of actions, it helps to connect actions in a specific order to feed the context with data.'
            })
          )
        },
        { additionalProperties: false }
      )
    ),
    answers: Type.Optional(Type.Record(Type.String(), Type.Array(answerTypes))),
    widget_contents: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Array(Type.String())])
      )
    ),
    entities: Type.Optional(Type.Record(Type.String(), Type.String())),
    resolvers: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object(
          {
            intents: globalResolverSchemaObject.properties.intents
          },
          { additionalProperties: false }
        ),
        {
          description:
            'You can see resolvers as utterance samples that are converted (resolved) to a value of your choice. They are very handy when skills expect specific utterances and then according to these utterances attribute a value that can be handled by the skill. If a skill action expects to receive a resolver, then Leon will convert the value for you and this value will be usable from the skill action code. Any value can be passed to resolvers which allow a large possibilities of usages.'
        }
      )
    )
  })
)

export type DomainSchema = Static<typeof domainSchemaObject>
export type SkillSchema = Static<typeof skillSchemaObject>
export type SkillConfigSchema = Static<typeof skillConfigSchemaObject>
export type SkillLocaleConfigSchema = Static<typeof skillLocaleConfigObject>
export type SkillActionConfig = SkillSchema['actions'][NLPAction] &
  SkillLocaleConfigSchema['actions'][NLPAction]
export type SkillBridgeSchema = Static<typeof skillSchemaObject.bridge>
export type SkillCustomTrimEntityTypeSchema = Static<
  typeof skillCustomTrimEntityType
>
export type SkillCustomRegexEntityTypeSchema = Static<
  typeof skillCustomRegexEntityType
>
export type SkillCustomEnumEntityTypeSchema = Static<
  typeof skillCustomEnumEntityType
>
export type SkillCustomLLMEntityTypeSchema = Static<
  typeof skillCustomLLMEntityType
>
export type SkillAnswerConfigSchema = Static<typeof answerTypes>
