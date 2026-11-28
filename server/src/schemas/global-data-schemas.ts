import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const globalEntitySchemaObject = Type.Strict(
  Type.Object(
    {
      options: Type.Record(
        Type.String(),
        Type.Object(
          {
            synonyms: Type.Array(Type.String(), {
              description: 'Alternative utterance terms that resolve to this canonical option.'
            }),
            data: Type.Optional(
              Type.Record(Type.String(), Type.Array(Type.String()), {
                description: 'Additional named lists of values associated with this option.'
              })
            )
          },
          { additionalProperties: false }
        ),
        { description: 'Recognizable options keyed by their canonical entity value.' }
      )
    },
    {
      description:
        'Global entities can hold data that can directly be reused in skills.'
    }
  )
)
export const globalResolverSchemaObject = Type.Strict(
  Type.Object({
    name: Type.String({ description: 'Name skills use to refer to this reusable resolver.' }),
    intents: Type.Record(
      Type.String(),
      Type.Object(
        {
          utterance_samples: Type.Array(Type.String(), {
            description: 'Example utterances that should resolve to this intent.'
          }),
          value: Type.Unknown({
            description: 'Value returned to the skill when this intent matches.'
          })
        },
        { additionalProperties: false }
      ),
      { description: 'Recognizable intents and their resolved values, keyed by intent name.' }
    )
  })
)
export const globalAnswersSchemaObject = Type.Strict(
  Type.Object({
    answers: Type.Record(
      Type.String(),
      Type.Union([
        Type.Record(Type.String(), Type.String()),
        Type.Array(Type.String())
      ]),
      { description: 'Reusable localized answers keyed by name. Each entry is a group of named replies or a list of reply variants.' }
    )
  })
)

export type GlobalEntitySchema = Static<typeof globalEntitySchemaObject>
export type GlobalResolverSchema = Static<typeof globalResolverSchemaObject>
export type GlobalAnswersSchema = Static<typeof globalAnswersSchemaObject>
