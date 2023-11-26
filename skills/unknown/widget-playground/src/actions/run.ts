import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
// TODO: import widgets @sdk/aurora
// import { Button, Card } from '@sdk/aurora'

import Widget from '../widgets/playground-test'
// import tsxTemplate from '../widgets/playground-test'

export const run: ActionFunction = async function () {
  /**
   * Forecast
   */

  /*const forecast = new Container(
    [
      new Text({
        text: 'Paris',
        size: 'xl'
      }),
      new Text({
        text: 'Thursday, 1 June',
        type: 'secondary'
      }),
      new Image({
        path: 'thumderstorms.svg'
      }),
      new Text({
        text: '18°',
        size: 'xxl'
      }),
      new Text({
        text: 'Thumderstorms',
        weight: 600 // TODO: not sure
      }),
      new Card({
        width: '100%',
        content: new Container([
          new Container(
            [
              new Image({
                path: 'sun.svg',
                width: 28,
                height: 28
              }),
              new Text({
                text: '1',
                size: 'sm'
              }),
              new Text({
                text: 'UV Index',
                size: 'sm',
                type: 'secondary'
              })
            ],
            {
              direction: 'column'
            }
          ),
          new Container(
            [
              new Image({
                path: 'wind.svg',
                width: 28,
                height: 28
              }),
              new Text({
                text: '10 m/s',
                size: 'sm'
              }),
              new Text({
                text: 'Wind',
                size: 'sm',
                type: 'secondary'
              })
            ],
            {
              direction: 'column'
            }
          ),
          new Container(
            [
              new Image({
                path: 'humidity.svg',
                width: 28,
                height: 28
              }),
              new Text({
                text: '98%',
                size: 'sm'
              }),
              new Text({
                text: 'Humidity',
                size: 'sm',
                type: 'secondary'
              })
            ],
            {
              direction: 'column'
            }
          )
        ])
      }),
      new TabGroup({
        // TabGroup will automatically manage the tab selection state
        tabs: [
          new Tab({
            title: 'Today',
            selected: true,
            content: new ScrollContainer([
              new Card({
                width: 60,
                content: new Container([
                  new Text({
                    text: '10:00',
                    size: 'sm',
                    type: 'secondary'
                  }),
                  new Image({
                    path: 'thumderstorms.svg',
                    width: 28,
                    height: 28
                  }),
                  new Text({
                    text: '15°',
                    size: 'lg',
                    weight: 600
                  })
                ])
              }) // TODO: continue ...
            ])
          }),
          new Tab({
            title: 'Tomorrow'
          }),
          new Tab({
            title: 'Next 7 days'
          })
        ]
      })
    ],
    {
      direction: 'column',
      align: 'center'
    }
  )

  /!**
   * Select music provider
   *!/

  const musicProviderList = new List({
    title: {
      text: 'Select your music provider',
      align: 'center'
    },
    items: [
      {
        content: new Container(
          [
            new Image({ path: 'spotify.svg', width: '', height: '' }) // TODO: props
          ],
          {
            align: 'center'
          }
        ),
        onPress: async () => {
          // TODO: next step
        }
      }
    ]
  })

  await leon.answer({ widget: musicProviderList })

  /!**
   * Todo list
   *!/
  const todoList = new List({
    title: {
      text: 'Shopping List',
      align: 'left'
    },
    items: [
      {
        content: new Container([
          new Checkbox({
            isChecked: true,
            onChange: () => {
              // TODO: toggle todo
            }
          }),
          new Input({
            value: 'Milk',
            onChange: () => {
              // TODO: open modal/dialog to edit current todo
            }
          })
        ])
      }
    ]
  })

  await leon.answer({ widget: todoList })
*/
  /**
   * Random number
   */

  /*const text = new Text({
    text: '42',
    size: 'xxl'
  })*/

  // const widget = createElement('Card', null, createElement('Button', null, 'Click me'))

  // Problem with this solution: can't pass dynamic value to the widget
  const widgetPath = path.resolve(__dirname, '../widgets/playground-test.tsx')
  const fileContent = await fs.promises.readFile(widgetPath, 'utf-8')

  const regex = /return\s*\(\s*([\s\S]*?)\s*\)/
  const match = fileContent.match(regex)
  let widgetContent = null
  if (match) {
    const [content] = match

    widgetContent = content.slice(8, -1)
  } else {
    // TODO: error in skill not respecting guideline
  }

  /**
   * TODO: non-JSX trial
   */

  const widget = new Widget({
    value1: 'Hello',
    value2: 'World'
  })

  console.log('widget', widget.render())

  // TODO: from SDK, auto call render()
  // await leon.answer({ widget })
  await leon.answer({ widget: widget.render() })

  /**
   * TODO: think of parsing JSX at the server side instead
   * No need to develop a parser for every future client
   */
  // await leon.answer({ widget: widgetContent })
}
