import { createConsola } from 'consola'

export const setupConsola = createConsola({
  fancy: true,
  formatOptions: {
    date: false
  }
})

function dim(text) {
  return `\x1b[2m${text}\x1b[0m`
}

function green(text) {
  return `\x1b[32m${text}\x1b[0m`
}

function underline(text) {
  return `\x1b[4m${text}\x1b[24m`
}

/**
 * Setup-only presentation helpers built on top of consola.
 */
export class SetupUI {
  static section(title) {
    setupConsola.box(title)
  }

  static aside(text) {
    setupConsola.log(dim(`› ${text}`))
  }

  static info(text) {
    setupConsola.info(text)
  }

  static success(text) {
    setupConsola.success(text)
  }

  static successHighlight(text) {
    console.log(green(`✔ ${text}`))
  }

  static warning(text) {
    setupConsola.warn(text)
  }

  static questionIntro(count) {
    const quickQuestionLabel =
      count === 1 ? '1 quick question' : `${count} quick questions`

    this.info(
      `I just have ${quickQuestionLabel} so I can set things up the way you want.`
    )
  }

  static questionSummary(preferences) {
    this.success(`Local AI: ${preferences.setupLocalAI ? 'Yes' : 'No'}`)
    // this.success(`Voice: ${preferences.setupVoice ? 'Yes' : 'No'}`)
  }

  static recap(items) {
    setupConsola.box(items.join('\n'))
  }

  static bullet(text) {
    console.log(`● ${text}`)
  }

  static underlined(text) {
    return underline(text)
  }
}
