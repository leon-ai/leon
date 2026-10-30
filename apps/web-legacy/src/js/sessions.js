import axios from 'axios'

const DAY_MS = 24 * 60 * 60 * 1_000
const GROUP_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
})

function createElement(tagName, className, textContent = '') {
  const element = document.createElement(tagName)

  if (className) {
    element.className = className
  }

  if (textContent) {
    element.textContent = textContent
  }

  return element
}

function getDayKey(timestamp) {
  const date = new Date(timestamp)

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime()
}

function getGroupLabel(timestamp) {
  const now = Date.now()
  const todayKey = getDayKey(now)
  const yesterdayKey = todayKey - DAY_MS
  const itemKey = getDayKey(timestamp)

  if (itemKey === todayKey) {
    return 'Today'
  }

  if (itemKey === yesterdayKey) {
    return 'Yesterday'
  }

  return GROUP_DATE_FORMATTER.format(new Date(timestamp))
}

export default class SessionsPanel {
  constructor({
    serverUrl,
    socket,
    activeSessionId,
    initialPayload,
    onSelect
  }) {
    this.serverUrl = serverUrl
    this.socket = socket
    this.activeSessionId = activeSessionId
    this.sessions = initialPayload?.sessions || []
    this.supportedProviders = initialPayload?.supported_providers || []
    this.currentModelTarget = initialPayload?.current_model_target || ''
    this.onSelect = onSelect
    this.container = document.querySelector('#sessions-panel')
    this.list = document.querySelector('#sessions-list')
    this.newButton = document.querySelector('#new-session')
  }

  init() {
    this.newButton.addEventListener('click', () => {
      void this.createSession()
    })
    this.list.addEventListener('click', (event) => {
      void this.handleClick(event)
    })
    this.render()
  }

  getActiveSessionId() {
    return this.activeSessionId
  }

  async refresh() {
    const previousActiveSessionId = this.activeSessionId
    const response = await axios.get(`${this.serverUrl}/api/v1/sessions`)

    this.applyPayload(response.data)

    if (
      response.data.active_session_id &&
      response.data.active_session_id !== previousActiveSessionId
    ) {
      await this.onSelect?.(response.data.active_session_id)
    }
  }

  async createSession() {
    const response = await axios.post(`${this.serverUrl}/api/v1/sessions`)

    this.applyPayload(response.data)
    await this.selectSession(response.data.session.id)
  }

  async selectSession(sessionId) {
    this.activeSessionId = sessionId
    this.socket.emit('session-change', sessionId)
    await this.onSelect?.(sessionId)
    await axios.patch(`${this.serverUrl}/api/v1/sessions/${sessionId}`, {
      is_active: true
    })
    await this.refresh()
  }

  async updateSession(sessionId, payload) {
    const response = await axios.patch(
      `${this.serverUrl}/api/v1/sessions/${sessionId}`,
      payload
    )

    this.applyPayload(response.data)
  }

  async deleteSession(sessionId) {
    const wasActiveSession = this.activeSessionId === sessionId
    const response = await axios.delete(
      `${this.serverUrl}/api/v1/sessions/${sessionId}`
    )

    this.applyPayload(response.data)

    if (wasActiveSession) {
      await this.selectSession(response.data.active_session_id)
    }
  }

  async handleClick(event) {
    const button = event.target.closest('button')
    const item = event.target.closest('.session-item')

    if (!item) {
      return
    }

    const sessionId = item.getAttribute('data-session-id')

    if (!button) {
      await this.selectSession(sessionId)
      return
    }

    const action = button.getAttribute('data-action')

    if (action === 'rename') {
      const currentTitle = item.getAttribute('data-session-title') || ''
      const title = window.prompt('Session title', currentTitle)

      if (title && title.trim()) {
        await this.updateSession(sessionId, { title: title.trim() })
      }
    } else if (action === 'pin') {
      await this.updateSession(sessionId, {
        is_pinned: button.getAttribute('aria-pressed') !== 'true'
      })
    } else if (action === 'delete') {
      await this.deleteSession(sessionId)
    } else if (action === 'model') {
      await this.updateSessionModel(sessionId)
    }
  }

  async updateSessionModel(sessionId) {
    const provider = window.prompt(
      `Provider (${this.supportedProviders.join(', ')})`
    )

    if (!provider) {
      return
    }

    const model = window.prompt('Model')

    if (!model) {
      return
    }

    await this.updateSession(sessionId, {
      provider: provider.trim(),
      model: model.trim()
    })
  }

  applyPayload(payload) {
    this.sessions = payload.sessions || []
    this.supportedProviders = payload.supported_providers || []
    this.currentModelTarget = payload.current_model_target || ''
    this.activeSessionId = payload.active_session_id || this.activeSessionId
    this.render()
  }

  render() {
    this.list.innerHTML = ''

    const pinnedSessions = this.sessions.filter((session) => session.isPinned)
    const unpinnedSessions = this.sessions.filter((session) => !session.isPinned)

    if (pinnedSessions.length > 0) {
      this.renderGroup('Pinned', pinnedSessions)
    }

    const groupedSessions = new Map()

    for (const session of unpinnedSessions) {
      const timestamp = session.lastMessageAt || session.updatedAt
      const groupLabel = getGroupLabel(timestamp)
      const group = groupedSessions.get(groupLabel) || []

      group.push(session)
      groupedSessions.set(groupLabel, group)
    }

    for (const [label, sessions] of groupedSessions.entries()) {
      this.renderGroup(label, sessions)
    }
  }

  renderGroup(label, sessions) {
    const group = createElement('section', 'session-group')
    const heading = createElement('h2', 'session-group-title', label)

    group.appendChild(heading)

    for (const session of sessions) {
      group.appendChild(this.createSessionItem(session))
    }

    this.list.appendChild(group)
  }

  createSessionItem(session) {
    const item = createElement('article', 'session-item')
    const title = createElement('div', 'session-title', session.title)
    const meta = createElement(
      'div',
      'session-meta',
      session.modelTarget || this.currentModelTarget || 'Default model'
    )
    const actions = createElement('div', 'session-actions')

    item.setAttribute('data-session-id', session.id)
    item.setAttribute('data-session-title', session.title)

    if (session.id === this.activeSessionId) {
      item.classList.add('session-item--active')
    }

    actions.appendChild(
      this.createActionButton(
        'pin',
        session.isPinned ? 'ri-pushpin-fill' : 'ri-pushpin-line',
        session.isPinned
      )
    )
    actions.appendChild(this.createActionButton('rename', 'ri-edit-line'))
    actions.appendChild(this.createActionButton('model', 'ri-brain-line'))
    actions.appendChild(this.createActionButton('delete', 'ri-delete-bin-line'))

    item.appendChild(title)
    item.appendChild(meta)
    item.appendChild(actions)

    return item
  }

  createActionButton(action, iconClassName, isPressed = false) {
    const button = createElement('button', 'session-action')
    const icon = createElement('i', iconClassName)

    button.type = 'button'
    button.setAttribute('data-action', action)
    button.setAttribute('aria-label', action)
    button.setAttribute('aria-pressed', String(isPressed))
    button.appendChild(icon)

    return button
  }
}
