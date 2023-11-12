const MAXIMUM_HEIGHT_TO_SHOW_SEE_MORE = 340

export default class Chatbot {
  constructor() {
    this.et = new EventTarget()
    this.feed = document.querySelector('#feed')
    this.typing = document.querySelector('#is-typing')
    this.noBubbleMessage = document.querySelector('#no-bubble')
    this.bubbles = localStorage.getItem('bubbles')
    this.parsedBubbles = JSON.parse(this.bubbles)
  }

  async init() {
    await this.loadFeed()
    this.scrollDown()

    this.et.addEventListener('to-leon', (event) => {
      this.createBubble('me', event.detail)
    })

    this.et.addEventListener('me-received', (event) => {
      this.createBubble('leon', event.detail)
    })
  }

  sendTo(who, string) {
    if (who === 'leon') {
      this.et.dispatchEvent(new CustomEvent('to-leon', { detail: string }))
    }
  }

  receivedFrom(who, string) {
    if (who === 'leon') {
      this.et.dispatchEvent(new CustomEvent('me-received', { detail: string }))
    }
  }

  isTyping(who, value) {
    if (who === 'leon') {
      if (value) {
        this.enableTyping()
      } else if (value === false) {
        this.disableTyping()
      }
    }
  }

  enableTyping() {
    if (!this.typing.classList.contains('on')) {
      this.typing.classList.add('on')
    }
  }

  disableTyping() {
    if (this.typing.classList.contains('on')) {
      this.typing.classList.remove('on')
    }
  }

  scrollDown() {
    this.feed.scrollTo(0, this.feed.scrollHeight)
  }

  loadFeed() {
    /**
     * TODO: widget: load widget from local storage
     */
    return new Promise((resolve) => {
      if (this.parsedBubbles === null || this.parsedBubbles.length === 0) {
        this.noBubbleMessage.classList.remove('hide')
        localStorage.setItem('bubbles', JSON.stringify([]))
        this.parsedBubbles = []
        resolve()
      } else {
        for (let i = 0; i < this.parsedBubbles.length; i += 1) {
          const bubble = this.parsedBubbles[i]

          this.createBubble(bubble.who, bubble.string, false)

          if (i + 1 === this.parsedBubbles.length) {
            setTimeout(() => {
              resolve()
            }, 100)
          }
        }
      }
    })
  }

  createBubble(who, string, save = true) {
    const container = document.createElement('div')
    const bubble = document.createElement('p')

    container.className = `bubble-container ${who}`
    bubble.className = 'bubble'
    bubble.innerHTML = string

    this.feed.appendChild(container).appendChild(bubble)

    if (container.clientHeight > MAXIMUM_HEIGHT_TO_SHOW_SEE_MORE) {
      bubble.style.maxHeight = `${MAXIMUM_HEIGHT_TO_SHOW_SEE_MORE}px`
      const showMore = document.createElement('p')
      const showMoreText = 'Show more'

      showMore.className = 'show-more'
      showMore.innerHTML = showMoreText

      container.appendChild(showMore)

      showMore.addEventListener('click', () => {
        bubble.classList.toggle('show-all')
        showMore.innerHTML =
          showMore.innerHTML === showMoreText ? 'Show less' : showMoreText
      })
    }

    if (save) {
      this.saveBubble(who, string)
    }
  }

  saveBubble(who, string) {
    if (!this.noBubbleMessage.classList.contains('hide')) {
      this.noBubbleMessage.classList.add('hide')
    }

    if (this.parsedBubbles.length === 62) {
      this.parsedBubbles.shift()
    }

    this.parsedBubbles.push({ who, string })
    localStorage.setItem('bubbles', JSON.stringify(this.parsedBubbles))
    this.scrollDown()
  }
}
