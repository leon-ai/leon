import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

/**
 * Aurora component props
 */

interface Text {
  text: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' // TODO: design tokens ("md" default)
  type?: 'primary' | 'secondary' // TODO: design tokens ("primary" default)
}
interface List {
  title: {
    text: string
    align?: 'left' | 'center' | 'right' // TODO: design tokens ("left" default)
  }
}
interface Container {
  direction?: 'row' | 'column' // TODO: design tokens ("row" default)
  align?: 'left' | 'center' | 'right' // TODO: design tokens
}
interface Image {
  path: string
  width?: string
  height?: string
}
interface Checkbox {
  checked: boolean
  label?: string
  disabled?: boolean
  hint?: string
  onChange?: () => void
}
interface Input {
  value: string
  placeholder?: string
  disabled?: boolean
  onChange?: () => void
}

export const run: ActionFunction = async function () {
  /**
   * Select music provider
   */

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

  /**
   * Todo list
   */
  const list = new List({
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

  /**
   * Random number
   */

  const text = new Text({
    text: '42',
    size: 'xxl'
  })

  await leon.answer({ widget: text })
}
