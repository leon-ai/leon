import { Widget, type WidgetOptions, type WidgetEventMethod } from '@sdk/widget'
import { type WidgetComponent } from '@sdk/widget-component'
import {
  Button,
  Flexbox,
  Form,
  List,
  ListHeader,
  ListItem,
  Checkbox,
  Link
} from '@sdk/aurora'

interface Params {
  value1: string
  value2: string
}

export class PlaygroundTestWidget extends Widget<Params> {
  constructor(options: WidgetOptions<Params>) {
    super(options)
  }

  public render(): WidgetComponent {
    const buttons = ['Spotify', 'Apple Music', 'YouTube Music'].map(
      (provider) => {
        return new ListItem({
          children: new Button({
            children: provider,
            onClick: (): WidgetEventMethod => {
              return this.sendUtterance('choose_provider', {
                data: {
                  provider
                }
              })
            }
          })
        })
      }
    )

    return new Flexbox({
      gap: 'md',
      flexDirection: 'column',
      children: [
        new Link({
          href: 'https://getleon.ai',
          children: 'Test link'
        }),
        new List({
          children: [
            new ListHeader({
              children: 'Shopping List'
            }),
            new Form({
              onSubmit: (data: Record<string, unknown>): unknown => {
                return this.runSkillAction('submit_shopping_list', data)
              },
              children: [
                new ListItem({
                  children: new Checkbox({
                    name: 'ingredients[]',
                    value: 'milk',
                    label: 'Milk',
                    checked: true
                  })
                }),
                new ListItem({
                  children: new Checkbox({
                    name: 'ingredients[]',
                    value: 'eggs',
                    label: 'Eggs',
                    checked: false
                  })
                }),
                new ListItem({
                  children: new Checkbox({
                    name: 'ingredients[]',
                    value: 'bread',
                    label: 'Bread',
                    checked: true
                  })
                }),
                new Button({
                  children: 'Submit',
                  type: 'submit'
                })
              ]
            })
          ]
        }),
        new List({
          children: [
            new ListHeader({
              children: this.content('select_music_provider', {
                adj: 'awesome',
                extra: 'here'
              })
            }),
            ...buttons
          ]
        })
      ]
    })
  }
}
