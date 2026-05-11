import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'

import { WidgetWrapper, Flexbox, Loader, Text } from '@aurora'

import renderAuroraComponent from './render-aurora-component'
import ToolUIHandler from './tool-ui-handler'

const WIDGETS_TO_FETCH = []
const WIDGETS_FETCH_CACHE = new Map()
const REPLACED_MESSAGES = new Set()
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24
const MAXIMUM_BUBBLES_IN_MEMORY = 62
const MAXIMUM_WIDGET_FETCH_CONCURRENCY = 4
const SECONDS_PER_MINUTE = 60

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default class Chatbot {
  constructor(socket, serverURL, sessionId = null) {
    this.socket = socket
    this.serverURL = serverURL
    this.sessionId = sessionId
    this.et = new EventTarget()
    this.feed = document.querySelector('#feed')
    this.typing = document.querySelector('#is-typing')
    this.noBubbleMessage = document.querySelector('#no-bubble')
    this.parsedBubbles = []
    this.reasoningBlocks = new Map()
    this.feedAutoScrollEnabled = true
    this.isProgrammaticFeedScroll = false
    this.widgetHydrationPromise = null

    // Initialize tool UI handler
    this.toolUIHandler = new ToolUIHandler(
      this.feed,
      this.scrollDown.bind(this),
      this.formatMessage.bind(this)
    )
  }

  async init() {
    await this.loadFeed()
    this.scrollDown()

    this.et.addEventListener('to-leon', (event) => {
      this.createBubble({
        who: 'me',
        string: event.detail.string,
        sentAt: event.detail.sentAt
      })
    })

    this.et.addEventListener('me-received', (event) => {
      this.createBubble({
        who: 'leon',
        string: event.detail
      })
    })

    // Add event delegation for clickable paths
    this.feed.addEventListener('click', (event) => {
      if (event.target.classList.contains('clickable-path')) {
        const path = event.target.getAttribute('data-path')
        if (path) {
          this.openPath(path)
        }
      }
    })

    this.feed.addEventListener(
      'scroll',
      () => {
        this.handleFeedScroll()
      },
      { passive: true }
    )
  }

  sendTo(who, string, sentAt = Date.now()) {
    if (who === 'leon') {
      this.et.dispatchEvent(
        new CustomEvent('to-leon', {
          detail: {
            string,
            sentAt
          }
        })
      )
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

  isElementNearBottom(element) {
    if (!element) {
      return true
    }

    const remainingScrollableDistance =
      element.scrollHeight - (element.scrollTop + element.clientHeight)

    return remainingScrollableDistance <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  }

  handleFeedScroll() {
    if (!this.feed || this.isProgrammaticFeedScroll) {
      return
    }

    this.feedAutoScrollEnabled = this.isElementNearBottom(this.feed)
  }

  scrollDown(options = {}) {
    if (!this.feed) {
      return
    }

    const { force = false } = options

    if (!force && !this.feedAutoScrollEnabled) {
      return
    }

    this.isProgrammaticFeedScroll = true
    this.feed.scrollTo(0, this.feed.scrollHeight)

    requestAnimationFrame(() => {
      this.isProgrammaticFeedScroll = false
      this.feedAutoScrollEnabled = this.isElementNearBottom(this.feed)
    })
  }

  scrollReasoningContentToBottom(reasoningBlock) {
    if (!reasoningBlock?.content || !reasoningBlock.isAutoScrollEnabled) {
      return
    }

    reasoningBlock.isProgrammaticScroll = true
    reasoningBlock.content.scrollTop = reasoningBlock.content.scrollHeight

    requestAnimationFrame(() => {
      reasoningBlock.isProgrammaticScroll = false
      reasoningBlock.isAutoScrollEnabled = this.isElementNearBottom(
        reasoningBlock.content
      )
    })
  }

  getWidgetPayload(formattedString) {
    if (
      typeof formattedString !== 'string' ||
      !formattedString.includes('"component":"WidgetWrapper"')
    ) {
      return null
    }

    try {
      return JSON.parse(formattedString)
    } catch {
      return null
    }
  }

  getPlanWidgetInsertionPoint(widgetPayload) {
    if (!widgetPayload || widgetPayload.widget !== 'PlanWidget') {
      return null
    }

    // Always append new plan widgets as new bubbles.
    // Widget updates are handled via replaceMessageId targeting the same
    // messageId, so insertion-point heuristics are unnecessary and can cause
    // visual reuse across turns.
    return null
  }

  isPlanWidgetData(data) {
    return Boolean(data && typeof data === 'object' && data.widget === 'PlanWidget')
  }

  isSystemWidgetData(data) {
    return Boolean(
      data &&
        typeof data === 'object' &&
        data.historyMode &&
        data.historyMode === 'system_widget'
    )
  }

  getTimelineItemWeight(item) {
    if (item.who === 'owner') {
      return 0
    }

    if (item.source === 'system_widget') {
      return 1
    }

    return 2
  }

  async hydrateFetchedWidgets() {
    if (this.widgetHydrationPromise) {
      return this.widgetHydrationPromise
    }

    const widgetContainers = [...WIDGETS_TO_FETCH].reverse()
    WIDGETS_TO_FETCH.length = 0

    if (widgetContainers.length === 0) {
      return Promise.resolve()
    }

    const hydrateWidgetContainer = async (widgetContainer) => {
      const hasWidgetBeenFetched = WIDGETS_FETCH_CACHE.has(
        widgetContainer.widgetId
      )

      if (hasWidgetBeenFetched) {
        const fetchedWidget = WIDGETS_FETCH_CACHE.get(widgetContainer.widgetId)
        widgetContainer.reactRootNode.render(fetchedWidget.reactNode)

        setTimeout(() => {
          this.scrollDown()
        }, 100)

        return
      }

      const data = await axios.get(
        `${this.serverURL}/api/v1/fetch-widget?skill_action=${widgetContainer.onFetch.actionName}&widget_id=${widgetContainer.widgetId}${this.sessionId ? `&session_id=${encodeURIComponent(this.sessionId)}` : ''}`
      )
      const fetchedWidget = data.data.widget
      const reactNode = fetchedWidget
        ? renderAuroraComponent(
            this.socket,
            fetchedWidget.componentTree,
            fetchedWidget.supportedEvents
          )
        : createElement(WidgetWrapper, {
            children: createElement(Flexbox, {
              alignItems: 'center',
              justifyContent: 'center',
              children: createElement(Text, {
                secondary: true,
                children: 'This widget has been deleted.'
              })
            })
          })

      widgetContainer.reactRootNode.render(reactNode)
      WIDGETS_FETCH_CACHE.set(widgetContainer.widgetId, {
        ...fetchedWidget,
        reactNode
      })
      setTimeout(() => {
        this.scrollDown()
      }, 100)
    }

    const workerCount = Math.min(
      MAXIMUM_WIDGET_FETCH_CONCURRENCY,
      widgetContainers.length
    )
    let currentIndex = 0

    this.widgetHydrationPromise = Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (currentIndex < widgetContainers.length) {
          const widgetContainer = widgetContainers[currentIndex]
          currentIndex += 1

          if (!widgetContainer) {
            continue
          }

          await hydrateWidgetContainer(widgetContainer)
        }
      })
    )
      .catch((error) => {
        console.error('Failed to hydrate fetched widgets:', error)
      })
      .finally(() => {
        this.widgetHydrationPromise = null
      })

    return this.widgetHydrationPromise
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId
  }

  resetFeed() {
    WIDGETS_TO_FETCH.length = 0
    this.feed.innerHTML = ''
    this.noBubbleMessage = document.createElement('p')
    this.noBubbleMessage.id = 'no-bubble'
    this.noBubbleMessage.className = 'hide'
    this.noBubbleMessage.textContent =
      'You can start to interact with me, don\'t be shy.'
    this.feed.appendChild(this.noBubbleMessage)
    this.parsedBubbles = []
    this.reasoningBlocks.clear()
    this.feedAutoScrollEnabled = true
  }

  async loadFeed() {
    WIDGETS_TO_FETCH.length = 0
    this.resetFeed()
    const sessionQuery = this.sessionId
      ? `&session_id=${encodeURIComponent(this.sessionId)}`
      : ''

    const [historyResponse, systemWidgetsResponse] = await Promise.all([
      axios.get(
        `${this.serverURL}/api/v1/conversation-history?supports_widgets=true${sessionQuery}`
      ),
      axios.get(
        `${this.serverURL}/api/v1/system-widgets?supports_widgets=true${sessionQuery}`
      )
    ])
    const history = Array.isArray(historyResponse.data?.history)
      ? historyResponse.data.history
      : []
    const systemWidgets = Array.isArray(systemWidgetsResponse.data?.widgets)
      ? systemWidgetsResponse.data.widgets
      : []

    const timelineItems = [...history, ...systemWidgets]
      .map((item, index) => ({
        ...item,
        sortIndex: index
      }))
      .sort((left, right) => {
        if (left.sentAt !== right.sentAt) {
          return left.sentAt - right.sentAt
        }

        const leftWeight = this.getTimelineItemWeight(left)
        const rightWeight = this.getTimelineItemWeight(right)

        if (leftWeight !== rightWeight) {
          return leftWeight - rightWeight
        }

        return left.sortIndex - right.sortIndex
      })

    this.parsedBubbles = history

    if (timelineItems.length === 0) {
      this.noBubbleMessage.classList.remove('hide')
      return
    }

    for (let i = 0; i < timelineItems.length; i += 1) {
      const bubble = timelineItems[i]

      if (
        bubble.originalString &&
        ToolUIHandler.isToolOutputMarker(bubble.originalString)
      ) {
        continue
      }

      this.createBubble({
        who: bubble.who === 'owner' ? 'me' : bubble.who,
        string: bubble.originalString ? bubble.originalString : bubble.string,
        metrics: bubble.llmMetrics || null,
        sentAt: bubble.sentAt,
        save: false,
        isCreatingFromLoadingFeed: true,
        messageId: bubble.messageId
      })
    }

    void this.hydrateFetchedWidgets()
  }

  createBubble(params) {
    const {
      who,
      string,
      metrics = null,
      save = true,
      bubbleId,
      isCreatingFromLoadingFeed = false,
      messageId,
      sentAt = null,
      beforeElement = null
    } = params
    const container = document.createElement('div')
    const bubble = document.createElement('p')

    if (!this.noBubbleMessage.classList.contains('hide')) {
      this.noBubbleMessage.classList.add('hide')
    }

    container.className = `bubble-container ${who}`
    bubble.className = 'bubble'

    if (messageId) {
      container.setAttribute('data-message-id', messageId)
    }

    // Store original string before formatting
    const originalString = string
    const formattedString = this.formatMessage(string)
    const widgetPayload = this.getWidgetPayload(formattedString)
    const autoPlanInsertionPoint = this.getPlanWidgetInsertionPoint(widgetPayload)
    const resolvedBeforeElement = beforeElement || autoPlanInsertionPoint

    bubble.innerHTML = formattedString

    if (bubbleId) {
      container.classList.add(bubbleId)
    }

    if (resolvedBeforeElement && resolvedBeforeElement.parentNode === this.feed) {
      this.feed.insertBefore(container, resolvedBeforeElement)
    } else {
      this.feed.appendChild(container)
    }
    container.appendChild(bubble)

    if (who === 'leon' && metrics) {
      container.appendChild(this.createMetricsElement(metrics, sentAt))
    } else if (who === 'me') {
      const timestampElement = this.createTimestampElement(sentAt)

      if (timestampElement) {
        container.appendChild(timestampElement)
      }
    }

    let widgetComponentTree = null
    let widgetSupportedEvents = null

    /**
     * Widget rendering
     */
    if (
      formattedString.includes &&
      formattedString.includes('"component":"WidgetWrapper"')
    ) {
      const parsedWidget = widgetPayload || JSON.parse(formattedString)
      container.setAttribute('data-widget-id', parsedWidget.id)

      /**
       * On widget fetching, render the loader
       */
      if (isCreatingFromLoadingFeed && parsedWidget.onFetch) {
        const root = createRoot(container)

        root.render(
          createElement(WidgetWrapper, {
            children: createElement(Flexbox, {
              alignItems: 'center',
              justifyContent: 'center',
              children: createElement(Loader)
            })
          })
        )

        WIDGETS_TO_FETCH.push({
          reactRootNode: root,
          widgetId: parsedWidget.id,
          onFetch: parsedWidget.onFetch
        })

        return container
      }

      widgetComponentTree = parsedWidget.componentTree
      widgetSupportedEvents = parsedWidget.supportedEvents

      /**
       * On widget creation
       */
      const root = createRoot(container)

      const reactNode = renderAuroraComponent(
        this.socket,
        widgetComponentTree,
        widgetSupportedEvents
      )

      root.render(reactNode)
    }

    if (save) {
      this.saveBubble(who, originalString, formattedString, messageId, metrics, sentAt)
    }

    return container
  }

  formatReasoningPhaseTitle(phase) {
    const normalizedPhase =
      typeof phase === 'string' && phase.trim()
        ? phase.replaceAll('_', ' ').toUpperCase()
        : 'EXECUTION'

    return `REASONING - ${normalizedPhase}`
  }

  createOrUpdateReasoningBlock(generationId, token, phase) {
    if (!generationId || !token) {
      return null
    }

    if (!this.noBubbleMessage.classList.contains('hide')) {
      this.noBubbleMessage.classList.add('hide')
    }

    let reasoningBlock = this.reasoningBlocks.get(generationId)

    if (!reasoningBlock) {
      const container = document.createElement('div')
      const block = document.createElement('div')
      const header = document.createElement('div')
      const icon = document.createElement('i')
      const title = document.createElement('span')
      const content = document.createElement('div')

      container.className = 'reasoning-block-container leon'
      container.setAttribute('data-reasoning-id', generationId)
      block.className = 'reasoning-block'
      header.className = 'reasoning-header'
      icon.className = 'ri-brain-ai-3-line reasoning-icon'
      title.className = 'reasoning-title'
      title.textContent = this.formatReasoningPhaseTitle(phase)
      content.className = 'reasoning-content'

      header.appendChild(icon)
      header.appendChild(title)
      block.appendChild(header)
      block.appendChild(content)
      container.appendChild(block)
      this.feed.appendChild(container)

      reasoningBlock = {
        container,
        content,
        text: '',
        isAutoScrollEnabled: true,
        isProgrammaticScroll: false
      }
      content.addEventListener(
        'scroll',
        () => {
          if (reasoningBlock.isProgrammaticScroll) {
            return
          }

          reasoningBlock.isAutoScrollEnabled = this.isElementNearBottom(content)
        },
        { passive: true }
      )
      this.reasoningBlocks.set(generationId, reasoningBlock)
    }

    reasoningBlock.text += token
    reasoningBlock.content.textContent = reasoningBlock.text
    this.scrollReasoningContentToBottom(reasoningBlock)

    return reasoningBlock.container
  }

  handleToolOutput(data) {
    const result = this.toolUIHandler.handleToolOutput(data)

    // Save in memory if it's a new group
    if (result && result.isNewGroup) {
      const { toolkitName, toolName, answer } = data
      const toolInfo = this.toolUIHandler.getToolGroupInfo(
        result.groupId,
        toolkitName,
        toolName,
        answer
      )

      this.saveBubble(
        'leon',
        toolInfo.originalString,
        toolInfo.formattedMessage,
        toolInfo.messageId
      )
    }
  }

  saveBubble(
    who,
    originalString,
    string,
    messageId,
    metrics = null,
    sentAt = null
  ) {
    if (!this.noBubbleMessage.classList.contains('hide')) {
      this.noBubbleMessage.classList.add('hide')
    }

    if (this.parsedBubbles.length === MAXIMUM_BUBBLES_IN_MEMORY) {
      this.parsedBubbles.shift()
    }

    // Store both original and formatted strings
    this.parsedBubbles.push({
      who,
      sentAt,
      string,
      originalString,
      messageId,
      llmMetrics: metrics
    })
    this.scrollDown()
  }

  formatMessage(message) {
    const isWidget =
      message.includes && message.includes('"component":"WidgetWrapper"')

    if (typeof message === 'string' && !isWidget) {
      message = escapeHTML(message)
      message = message.replace(/\n/g, '<br />')

      // Handle HTTP/HTTPS URLs with simple regex
      message = message.replace(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi, (match) => {
        return `<a href="${match}" target="_blank" rel="noopener noreferrer" class="clickable-url" title="Open URL in browser">${match}</a>`
      })

      // Handle file paths with delimiters for exact matching
      message = message.replace(
        /\[FILE_PATH\](.*?)\[\/FILE_PATH\]/g,
        (match, filePath) => {
          return `<span class="clickable-path" data-path="${filePath}" title="Open in file explorer">${filePath}</span>`
        }
      )
    }

    return message
  }

  formatMetricTimestamp(sentAt) {
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
      return ''
    }

    const date = new Date(sentAt)
    const now = new Date()

    if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
      return ''
    }

    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
    const formattedTime = timeFormatter.format(date)
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    )
    const startOfTargetDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
    const dayDifference = Math.round(
      (startOfToday.getTime() - startOfTargetDay.getTime()) / 86_400_000
    )

    if (dayDifference === 0) {
      return `Today, ${formattedTime}`
    }

    if (dayDifference === 1) {
      return `Yesterday, ${formattedTime}`
    }

    if (dayDifference > 1 && dayDifference < 7) {
      const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
        weekday: 'long'
      })

      return `${weekdayFormatter.format(date)}, ${formattedTime}`
    }

    const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    })

    return `${monthDayFormatter.format(date)}, ${formattedTime}`
  }

  formatFullMetricTimestamp(sentAt) {
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
      return ''
    }

    const date = new Date(sentAt)

    if (Number.isNaN(date.getTime())) {
      return ''
    }

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  formatTimestampMarkup(sentAt) {
    const formattedTimestamp = this.formatMetricTimestamp(sentAt)
    const fullFormattedTimestamp = this.formatFullMetricTimestamp(sentAt)

    if (!formattedTimestamp) {
      return ''
    }

    return `
      <span class="bubble-metric-item">
        <i class="ri-time-line" aria-hidden="true"></i>
        <span title="${fullFormattedTimestamp || formattedTimestamp}">${formattedTimestamp}</span>
      </span>
    `.trim()
  }

  formatTurnDuration(durationMs) {
    const durationSeconds = Number(durationMs || 0) / 1_000
    const roundedDurationSeconds = Math.max(0, Number(durationSeconds.toFixed(1)))

    if (roundedDurationSeconds < SECONDS_PER_MINUTE) {
      return `${roundedDurationSeconds.toFixed(1)}s`
    }

    const minutes = Math.floor(roundedDurationSeconds / SECONDS_PER_MINUTE)
    const seconds = roundedDurationSeconds % SECONDS_PER_MINUTE

    return `${minutes}m${seconds.toFixed(1)}s`
  }

  formatMetrics(metrics, sentAt = null) {
    if (!metrics) {
      return ''
    }

    const inputTokens = Number(metrics.inputTokens || 0)
    const outputTokens = Number(metrics.outputTokens || 0)
    const totalTokens = Number(metrics.totalTokens || inputTokens + outputTokens)
    const turnDuration = this.formatTurnDuration(metrics.durationMs)
    const tokensPerSecond = Number(
      metrics.tokensPerSecond || metrics.averagedPhaseTokensPerSecond || 0
    )
    const tokenFormatter = new Intl.NumberFormat()
    const timestampMarkup = this.formatTimestampMarkup(sentAt)

    return `
      <span class="bubble-metric-item">
        <i class="ri-copper-coin-line" aria-hidden="true"></i>
        <span>${tokenFormatter.format(totalTokens)} (i:${tokenFormatter.format(inputTokens)}/o:${tokenFormatter.format(outputTokens)}) tok</span>
      </span>
      <span class="bubble-metric-item">
        <i class="ri-timer-flash-line" aria-hidden="true"></i>
        <span>${turnDuration}</span>
      </span>
      <span class="bubble-metric-item">
        <i class="ri-flashlight-line" aria-hidden="true"></i>
        <span>${tokensPerSecond.toFixed(2)} t/s</span>
      </span>
      ${timestampMarkup}
    `.trim()
  }

  createMetricsElement(metrics, sentAt = null) {
    const metricsElement = document.createElement('div')

    metricsElement.className = 'bubble-metrics'
    metricsElement.innerHTML = this.formatMetrics(metrics, sentAt)

    return metricsElement
  }

  createTimestampElement(sentAt) {
    const timestampMarkup = this.formatTimestampMarkup(sentAt)

    if (!timestampMarkup) {
      return null
    }

    const timestampElement = document.createElement('div')

    timestampElement.className = 'bubble-metrics'
    timestampElement.innerHTML = timestampMarkup

    return timestampElement
  }

  updateBubbleMetrics(container, metrics, sentAt = null) {
    if (!container) {
      return
    }

    const existingMetricsElement = container.querySelector('.bubble-metrics')

    if (!metrics) {
      if (existingMetricsElement) {
        existingMetricsElement.remove()
      }

      return
    }

    if (existingMetricsElement) {
      existingMetricsElement.innerHTML = this.formatMetrics(metrics, sentAt)
      return
    }

    container.appendChild(this.createMetricsElement(metrics, sentAt))
  }

  getLatestReasoningContainer() {
    const reasoningContainers = this.feed.querySelectorAll(
      '.reasoning-block-container'
    )

    if (reasoningContainers.length === 0) {
      return null
    }

    return reasoningContainers[reasoningContainers.length - 1] || null
  }

  replaceMessage(replaceMessageId, newData) {
    const existingBubble = document.querySelector(
      `[data-message-id="${replaceMessageId}"]`
    )
    const isPlanWidget = this.isPlanWidgetData(newData)
    const nextSibling = existingBubble ? existingBubble.nextSibling : null

    if (existingBubble) {
      existingBubble.remove()

      const bubbleIndex = this.parsedBubbles.findIndex(
        (bubble) => bubble.messageId === replaceMessageId
      )
      if (bubbleIndex !== -1) {
        this.parsedBubbles.splice(bubbleIndex, 1)
      }
    }

    const isTextAnswerPayload = Boolean(
      newData &&
        typeof newData === 'object' &&
        typeof newData.answer === 'string' &&
        !newData.widget &&
        !newData.componentTree
    )
    const bubbleString = isTextAnswerPayload
      ? newData.answer
      : typeof newData === 'string'
        ? newData
        : JSON.stringify(newData)
    const metrics =
      isTextAnswerPayload && newData.llmMetrics ? newData.llmMetrics : null

    const shouldSaveMessage = !this.isSystemWidgetData(newData)
    const beforeElement = isPlanWidget ? null : nextSibling

    this.createBubble({
      who: 'leon',
      string: bubbleString,
      save: shouldSaveMessage,
      messageId: replaceMessageId,
      beforeElement,
      metrics,
      sentAt:
        newData && typeof newData === 'object' && typeof newData.sentAt === 'number'
          ? newData.sentAt
          : Date.now()
    })

    /**
     * Only scroll down on the first replacement of this message
     * to avoid repeating scrolling for every message replacement
     */
    if (!REPLACED_MESSAGES.has(replaceMessageId)) {
      REPLACED_MESSAGES.add(replaceMessageId)
      this.scrollDown()
    }
  }

  openPath(filePath) {
    // Send request to server to open the file path in system file explorer
    fetch(`${this.serverURL}/api/v1/open-path`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: filePath })
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          console.error('Failed to open path:', data.error)
        }
      })
      .catch((error) => {
        console.error('Error opening path:', error)
      })
  }
}
