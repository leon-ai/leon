import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

import { globalResolverSchemaObject } from '@/schemas/global-data-schemas'
import { SkillBridges } from '@/core/brain/types'

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
  Type.Literal('entity')
]
const answerTypes = Type.Union([
  Type.String(),
  Type.Object({
    speech: Type.String(),
    text: Type.String()
  })
])
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
const skillCustomEntityTypes = [
  Type.Array(skillCustomTrimEntityType),
  Type.Array(skillCustomRegexEntityType),
  Type.Array(skillCustomEnumEntityType)
]

export const domainSchemaObject = Type.Strict(
  Type.Object({
    name: Type.String({ minLength: 1, description: 'The name of the domain.' })
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
          loop: Type.Optional(
            Type.Object(
              {
                expected_item: Type.Object(
                  {
                    type: Type.Union(skillDataTypes),
                    name: Type.String()
                  },
                  { description: 'An item can be a entity or a resolver.' }
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
export type SkillAnswerConfigSchema = Static<typeof answerTypes>
