/**
 * Tool UI Handler
 * Renders tool executions as expandable activity cards.
 */
export default class ToolUIHandler {
  constructor(feedElement, scrollDownCallback, formatMessageCallback) {
    this.feed = feedElement
    this.scrollDown = scrollDownCallback
    this.formatMessage = formatMessageCallback
    this.toolGroups = new Map()
  }

  /**
   * Handle tool output messages with interactive activity cards.
   */
  handleToolOutput(data) {
    if (data.activityType === 'agent_skill') {
      return this.handleAgentSkillActivity(data)
    }

    const {
      toolkitName,
      toolName,
      toolGroupId,
      answer,
      replaceMessageId,
      key
    } = data

    if (replaceMessageId) {
      this.replaceToolMessage(replaceMessageId, data)
      return
    }

    const answerKey = key ? key.split('.').pop() : 'unknown'
    const groupId = toolGroupId || `${toolkitName}_${toolName}_${Date.now()}`
    const mode =
      data.toolDisplayMode === 'activity_card' ? 'activity_card' : 'legacy'

    let toolGroupContainer = this.toolGroups.get(groupId)

    if (!toolGroupContainer) {
      toolGroupContainer = this.createToolGroupContainer({
        groupId,
        toolkitName,
        toolName,
        answerKey,
        mode,
        data
      })
      this.toolGroups.set(groupId, toolGroupContainer)
    }

    if (toolGroupContainer.mode === 'activity_card') {
      this.updateActivityCard(toolGroupContainer, data, answerKey)
    } else {
      this.addLegacyToolMessage(toolGroupContainer, answer)
    }

    this.scrollDown()

    return {
      groupId,
      isNewGroup: toolGroupContainer.isNew
    }
  }

  handleAgentSkillActivity(data) {
    const agentSkill = data.agentSkill || {}
    const skillId = agentSkill.id || agentSkill.name || 'agent-skill'
    const groupId = data.toolGroupId || `agent_skill_${skillId}_${Date.now()}`

    let activityContainer = this.toolGroups.get(groupId)

    if (!activityContainer) {
      activityContainer = this.createAgentSkillActivityCard({
        groupId,
        agentSkill
      })
      this.toolGroups.set(groupId, activityContainer)
    }

    this.updateAgentSkillActivityCard(activityContainer, data)
    this.scrollDown()

    return {
      groupId,
      isNewGroup: activityContainer.isNew
    }
  }

  createToolGroupContainer(params) {
    return params.mode === 'activity_card'
      ? this.createActivityCardContainer(params)
      : this.createLegacyToolGroupContainer(params)
  }

  getRemixIconClass(iconName) {
    const fallbackIconName = 'ri-magic-line'
    if (typeof iconName !== 'string') {
      return fallbackIconName
    }

    const trimmedIconName = iconName.trim()
    if (!trimmedIconName || trimmedIconName.includes(' ')) {
      return fallbackIconName
    }

    return trimmedIconName.startsWith('ri-')
      ? trimmedIconName
      : `ri-${trimmedIconName}`
  }

  getToolActivityIconClass(data) {
    return this.getRemixIconClass(data.toolIconName || data.toolkitIconName)
  }

  /**
   * Create the legacy shell-like tool group container.
   */
  createLegacyToolGroupContainer({
    groupId,
    toolkitName,
    toolName,
    answerKey
  }) {
    const groupContainer = document.createElement('div')
    groupContainer.className = 'tool-group-container'
    groupContainer.setAttribute('data-tool-group-id', groupId)

    const toolHeader = document.createElement('button')
    toolHeader.className = 'tool-header'
    toolHeader.setAttribute('type', 'button')
    toolHeader.innerHTML = `
      <i class="ri-terminal-line tool-icon"></i>
      <span class="tool-name">${toolkitName} toolkit → ${toolName} → ${answerKey}</span>
      <i class="ri-arrow-down-s-line expand-icon"></i>
    `

    const toolContent = document.createElement('div')
    toolContent.className = 'tool-content'

    const shellOutput = document.createElement('div')
    shellOutput.className = 'shell-output'

    toolContent.appendChild(shellOutput)
    groupContainer.appendChild(toolHeader)
    groupContainer.appendChild(toolContent)

    this.addExpandCollapseHandler(toolHeader, toolContent)
    this.feed.appendChild(groupContainer)

    return {
      mode: 'legacy',
      container: groupContainer,
      toolHeader,
      toolContent,
      shellOutput,
      isNew: true
    }
  }

  createActivityCardContainer({
    groupId,
    toolkitName,
    toolName,
    answerKey,
    data
  }) {
    const groupContainer = document.createElement('div')
    groupContainer.className = 'tool-group-container tool-activity-card'
    groupContainer.setAttribute('data-tool-group-id', groupId)

    const toolHeader = document.createElement('button')
    toolHeader.className = 'tool-header tool-activity-header'
    toolHeader.setAttribute('type', 'button')

    const heading = document.createElement('div')
    heading.className = 'tool-activity-heading'

    const icon = document.createElement('i')
    icon.className = `${this.getToolActivityIconClass(data)} tool-icon`

    const titleBlock = document.createElement('div')
    titleBlock.className = 'tool-activity-title-block'

    const title = document.createElement('span')
    title.className = 'tool-title'
    title.textContent = data.stepLabel || this.humanizeFunctionName(answerKey)

    const subtitle = document.createElement('span')
    subtitle.className = 'tool-subtitle'
    subtitle.textContent = `${toolkitName} toolkit • ${toolName}`

    titleBlock.appendChild(title)
    titleBlock.appendChild(subtitle)
    heading.appendChild(icon)
    heading.appendChild(titleBlock)

    const meta = document.createElement('div')
    meta.className = 'tool-activity-meta'

    const statusChip = document.createElement('span')
    statusChip.className = 'tool-status-chip running'
    statusChip.textContent = 'Running'

    const expandIcon = document.createElement('i')
    expandIcon.className = 'ri-arrow-down-s-line expand-icon'

    meta.appendChild(statusChip)
    meta.appendChild(expandIcon)
    toolHeader.appendChild(heading)
    toolHeader.appendChild(meta)

    const toolContent = document.createElement('div')
    toolContent.className = 'tool-content'

    const summary = document.createElement('div')
    summary.className = 'tool-activity-summary'
    summary.textContent = 'Preparing tool activity...'

    const sections = document.createElement('div')
    sections.className = 'tool-activity-sections'

    const inputPanel = this.createActivityPanel(
      'Input',
      'Parameters sent to the function'
    )
    const outputPanel = this.createActivityPanel(
      'Result',
      'What the function returned'
    )

    sections.appendChild(inputPanel.panel)
    sections.appendChild(outputPanel.panel)

    const rawDetails = document.createElement('details')
    rawDetails.className = 'tool-raw-details'

    const rawSummary = document.createElement('summary')
    rawSummary.textContent = 'Raw data'

    const rawContent = document.createElement('div')
    rawContent.className = 'tool-raw-content'

    rawDetails.appendChild(rawSummary)
    rawDetails.appendChild(rawContent)

    toolContent.appendChild(summary)
    toolContent.appendChild(sections)
    toolContent.appendChild(rawDetails)
    groupContainer.appendChild(toolHeader)
    groupContainer.appendChild(toolContent)

    this.addExpandCollapseHandler(toolHeader, toolContent)
    this.feed.appendChild(groupContainer)

    return {
      mode: 'activity_card',
      container: groupContainer,
      toolHeader,
      toolContent,
      summary,
      title,
      subtitle,
      statusChip,
      inputBody: inputPanel.body,
      outputBody: outputPanel.body,
      rawContent,
      rawDetails,
      rawInput: null,
      rawOutput: null,
      preparationLog: [],
      isNew: true
    }
  }

  createAgentSkillActivityCard({ groupId, agentSkill }) {
    const groupContainer = document.createElement('div')
    groupContainer.className =
      'tool-group-container tool-activity-card agent-skill-activity-card'
    groupContainer.setAttribute('data-tool-group-id', groupId)

    const skillName = agentSkill.name || agentSkill.id || 'Agent Skill'
    const skillPath = agentSkill.skillPath || 'SKILL.md'

    const toolHeader = document.createElement('button')
    toolHeader.className = 'tool-header tool-activity-header'
    toolHeader.setAttribute('type', 'button')

    const heading = document.createElement('div')
    heading.className = 'tool-activity-heading'

    const icon = document.createElement('i')
    icon.className = 'ri-book-ai-line tool-icon'

    const titleBlock = document.createElement('div')
    titleBlock.className = 'tool-activity-title-block'

    const title = document.createElement('span')
    title.className = 'tool-title'
    title.textContent = `Agent Skill: ${skillName}`

    const subtitle = document.createElement('span')
    subtitle.className = 'tool-subtitle'
    subtitle.textContent = skillPath
    subtitle.setAttribute('title', skillPath)

    titleBlock.appendChild(title)
    titleBlock.appendChild(subtitle)
    heading.appendChild(icon)
    heading.appendChild(titleBlock)

    const meta = document.createElement('div')
    meta.className = 'tool-activity-meta'

    const statusChip = document.createElement('span')
    statusChip.className = 'tool-status-chip selected'
    statusChip.textContent = 'In use'

    const expandIcon = document.createElement('i')
    expandIcon.className = 'ri-arrow-down-s-line expand-icon'

    meta.appendChild(statusChip)
    meta.appendChild(expandIcon)
    toolHeader.appendChild(heading)
    toolHeader.appendChild(meta)

    const toolContent = document.createElement('div')
    toolContent.className = 'tool-content'

    const summary = document.createElement('div')
    summary.className = 'tool-activity-summary'
    summary.textContent = 'Following SKILL.md instructions for this step.'

    const sections = document.createElement('div')
    sections.className = 'tool-activity-sections single'

    const skillPanel = this.createActivityPanel(
      'Skill',
      'Agent Skill context for this step'
    )
    sections.appendChild(skillPanel.panel)

    toolContent.appendChild(summary)
    toolContent.appendChild(sections)
    groupContainer.appendChild(toolHeader)
    groupContainer.appendChild(toolContent)

    this.addExpandCollapseHandler(toolHeader, toolContent)
    this.feed.appendChild(groupContainer)

    return {
      mode: 'agent_skill',
      container: groupContainer,
      title,
      subtitle,
      statusChip,
      skillBody: skillPanel.body,
      isNew: true
    }
  }

  /**
   * Create a titled content panel used by the activity card sections.
   */
  createActivityPanel(title, description) {
    const panel = document.createElement('section')
    panel.className = 'tool-activity-panel'

    const heading = document.createElement('div')
    heading.className = 'tool-panel-heading'

    const titleElement = document.createElement('span')
    titleElement.className = 'tool-panel-title'
    titleElement.textContent = title

    const descriptionElement = document.createElement('span')
    descriptionElement.className = 'tool-panel-description'
    descriptionElement.textContent = description

    const body = document.createElement('div')
    body.className = 'tool-panel-body'

    heading.appendChild(titleElement)
    heading.appendChild(descriptionElement)
    panel.appendChild(heading)
    panel.appendChild(body)

    return {
      panel,
      body
    }
  }

  /**
   * Add expand/collapse functionality to tool header.
   */
  addExpandCollapseHandler(toolHeader, toolContent) {
    toolHeader.addEventListener('click', () => {
      const isExpanded = toolContent.classList.contains('expanded')
      const expandIcon = toolHeader.querySelector('.expand-icon')

      if (isExpanded) {
        toolContent.classList.remove('expanded')
        expandIcon?.classList.remove('rotated')
      } else {
        toolContent.classList.add('expanded')
        expandIcon?.classList.add('rotated')
      }
    })
  }

  /**
   * Update the activity card with the latest input/output state.
   */
  updateActivityCard(toolGroupContainer, data, answerKey) {
    const title =
      data.stepLabel ||
      this.humanizeFunctionName(data.functionName || answerKey)
    toolGroupContainer.title.textContent = title

    if (data.functionName) {
      const functionLabel = this.humanizeFunctionName(data.functionName)
      toolGroupContainer.subtitle.textContent =
        `${data.toolkitName} toolkit • ${data.toolName} • ${functionLabel}`
    }

    if (data.toolPhase === 'input') {
      toolGroupContainer.summary.textContent =
        data.stepLabel || data.functionName
          ? `Preparing ${title.toLowerCase()}...`
          : 'Preparing tool activity...'
      this.setStatusChip(toolGroupContainer.statusChip, 'running')

      const parsedInput = this.parseToolInput(data.toolInput)
      toolGroupContainer.rawInput = parsedInput ?? data.toolInput ?? null
      this.renderValuePreview(
        toolGroupContainer.inputBody,
        parsedInput ?? data.toolInput,
        'No input'
      )

      if (!toolGroupContainer.rawOutput) {
        this.renderPlaceholder(
          toolGroupContainer.outputBody,
          'Waiting for function output...'
        )
      }
    }

    if (data.toolPhase === 'preparation') {
      const progressMessage = data.message || data.answer || ''
      this.setStatusChip(toolGroupContainer.statusChip, 'running')

      if (progressMessage) {
        toolGroupContainer.summary.textContent = progressMessage
        toolGroupContainer.preparationLog.push(progressMessage)
        this.renderPreparationLog(
          toolGroupContainer.outputBody,
          toolGroupContainer.preparationLog
        )
        toolGroupContainer.rawOutput = {
          preparation: toolGroupContainer.preparationLog
        }
      }
    }

    if (data.toolPhase === 'output') {
      const isError = data.status === 'error'
      toolGroupContainer.summary.textContent =
        data.message ||
        (isError ? 'The function failed.' : 'The function completed.')
      this.setStatusChip(
        toolGroupContainer.statusChip,
        isError ? 'error' : 'success'
      )

      const outputPayload = {
        message: data.message,
        output: data.output
      }
      toolGroupContainer.rawOutput = outputPayload
      this.renderOutputPreview(toolGroupContainer.outputBody, data)
    }

    this.renderRawData(toolGroupContainer)

    if (toolGroupContainer.isNew) {
      toolGroupContainer.isNew = false
    }
  }

  updateAgentSkillActivityCard(activityContainer, data) {
    const agentSkill = data.agentSkill || {}
    const skillName = agentSkill.name || agentSkill.id || 'Agent Skill'
    const skillPath = agentSkill.skillPath || ''

    activityContainer.title.textContent = `Agent Skill: ${skillName}`
    activityContainer.subtitle.textContent = skillPath || 'SKILL.md'
    activityContainer.subtitle.setAttribute(
      'title',
      skillPath || 'SKILL.md'
    )
    this.setStatusChip(activityContainer.statusChip, 'selected')
    this.renderValuePreview(
      activityContainer.skillBody,
      {
        name: skillName,
        description: agentSkill.description || '',
        root_path: agentSkill.rootPath || '',
        skill_path: skillPath
      },
      'No Agent Skill metadata'
    )

    if (activityContainer.isNew) {
      activityContainer.isNew = false
    }
  }

  /**
   * Add a tool message to the legacy shell output.
   */
  addLegacyToolMessage(toolGroupContainer, message) {
    const messageElement = document.createElement('div')
    messageElement.className = 'shell-message'

    const formattedMessage = this.formatMessage(message)
    messageElement.innerHTML = `<span class="shell-prompt">></span> ${formattedMessage}`

    toolGroupContainer.shellOutput.appendChild(messageElement)

    if (toolGroupContainer.isNew) {
      toolGroupContainer.isNew = false
    }
  }

  /**
   * Render the output preview block.
   */
  renderOutputPreview(container, data) {
    container.innerHTML = ''

    if (data.message) {
      const summary = document.createElement('div')
      summary.className = 'tool-output-summary'
      summary.innerHTML = this.formatMessage(data.message)
      container.appendChild(summary)
    }

    if (
      typeof data.output === 'undefined' ||
      data.output === null ||
      (typeof data.output === 'object' &&
        !Array.isArray(data.output) &&
        Object.keys(data.output).length === 0)
    ) {
      if (!data.message) {
        this.renderPlaceholder(container, 'No output')
      }
      return
    }

    const preview = this.buildValueNode(data.output)
    container.appendChild(preview)
  }

  /**
   * Render preparation progress before the final tool output is available.
   */
  renderPreparationLog(container, messages) {
    container.innerHTML = ''

    if (!messages.length) {
      this.renderPlaceholder(container, 'Waiting for function output...')
      return
    }

    const list = document.createElement('ul')
    list.className = 'tool-value-list'

    messages.forEach((message) => {
      const item = document.createElement('li')
      item.textContent = message
      list.appendChild(item)
    })

    container.appendChild(list)
  }

  /**
   * Render a value preview block.
   */
  renderValuePreview(container, value, emptyLabel) {
    container.innerHTML = ''

    if (
      value === null ||
      typeof value === 'undefined' ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0)
    ) {
      this.renderPlaceholder(container, emptyLabel)
      return
    }

    container.appendChild(this.buildValueNode(value))
  }

  /**
   * Render an empty state placeholder.
   */
  renderPlaceholder(container, text) {
    container.innerHTML = ''
    const placeholder = document.createElement('div')
    placeholder.className = 'tool-empty-state'
    placeholder.textContent = text
    container.appendChild(placeholder)
  }

  /**
   * Build the most appropriate preview node for a value.
   */
  buildValueNode(value) {
    if (Array.isArray(value)) {
      return this.buildArrayNode(value)
    }

    if (value && typeof value === 'object') {
      return this.buildObjectNode(value)
    }

    return this.buildScalarNode(value)
  }

  /**
   * Build a list preview for array values.
   */
  buildArrayNode(value) {
    const list = document.createElement('ul')
    list.className = 'tool-value-list'

    value.slice(0, 8).forEach((item) => {
      const itemElement = document.createElement('li')
      itemElement.appendChild(this.buildScalarNode(this.stringifyCompact(item)))
      list.appendChild(itemElement)
    })

    if (value.length > 8) {
      const more = document.createElement('li')
      more.className = 'tool-empty-state'
      more.textContent = `+${value.length - 8} more item(s)`
      list.appendChild(more)
    }

    return list
  }

  /**
   * Build a key/value preview for object values.
   */
  buildObjectNode(value) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'tool-empty-state'
      empty.textContent = 'No data'
      return empty
    }

    const wrapper = document.createElement('div')
    wrapper.className = 'tool-kv-list'

    entries.slice(0, 8).forEach(([key, itemValue]) => {
      const row = document.createElement('div')
      row.className = 'tool-kv-row'

      const keyElement = document.createElement('span')
      keyElement.className = 'tool-kv-key'
      keyElement.textContent = this.humanizeFunctionName(key)

      const valueElement = document.createElement('div')
      valueElement.className = 'tool-kv-value'
      valueElement.appendChild(
        this.buildScalarNode(this.stringifyCompact(itemValue))
      )

      row.appendChild(keyElement)
      row.appendChild(valueElement)
      wrapper.appendChild(row)
    })

    if (entries.length > 8) {
      const more = document.createElement('div')
      more.className = 'tool-empty-state'
      more.textContent = `+${entries.length - 8} more field(s)`
      wrapper.appendChild(more)
    }

    return wrapper
  }

  /**
   * Build a formatted scalar value preview.
   */
  buildScalarNode(value) {
    const wrapper = document.createElement('div')
    wrapper.className = 'tool-rich-text'
    wrapper.innerHTML = this.formatMessage(
      typeof value === 'string' ? value : String(value ?? '')
    )
    return wrapper
  }

  /**
   * Render raw input/output payloads behind a disclosure block.
   */
  renderRawData(toolGroupContainer) {
    const payload = {}

    if (toolGroupContainer.rawInput !== null) {
      payload['input'] = toolGroupContainer.rawInput
    }

    if (toolGroupContainer.rawOutput !== null) {
      payload['result'] = toolGroupContainer.rawOutput
    }

    if (Object.keys(payload).length === 0) {
      toolGroupContainer.rawDetails.removeAttribute('open')
      toolGroupContainer.rawContent.innerHTML = ''
      return
    }

    toolGroupContainer.rawContent.innerHTML = this.formatMessage(
      JSON.stringify(payload, null, 2)
    )
  }

  /**
   * Parse tool input JSON when possible.
   */
  parseToolInput(toolInput) {
    if (typeof toolInput !== 'string' || !toolInput.trim()) {
      return null
    }

    try {
      return JSON.parse(toolInput)
    } catch {
      return toolInput
    }
  }

  /**
   * Update the status chip for the activity card.
   */
  setStatusChip(chip, status) {
    chip.classList.remove('running', 'success', 'error', 'selected')

    if (status === 'error') {
      chip.classList.add('error')
      chip.textContent = 'Failed'
      return
    }

    if (status === 'success') {
      chip.classList.add('success')
      chip.textContent = 'Done'
      return
    }

    if (status === 'selected') {
      chip.classList.add('selected')
      chip.textContent = 'In use'
      return
    }

    chip.classList.add('running')
    chip.textContent = 'Running'
  }

  /**
   * Humanize function and field names for display.
   */
  humanizeFunctionName(value) {
    return String(value || 'unknown')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\w/, (char) => char.toUpperCase())
  }

  /**
   * Produce a compact preview string for nested values.
   */
  stringifyCompact(value) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) {
        return '(empty)'
      }

      return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
    }

    if (value === null || typeof value === 'undefined') {
      return '(empty)'
    }

    if (typeof value === 'object') {
      try {
        const serialized = JSON.stringify(value)
        return serialized.length > 180
          ? `${serialized.slice(0, 177)}...`
          : serialized
      } catch {
        return String(value)
      }
    }

    return String(value)
  }

  /**
   * Replace a tool message (for progress updates, etc.).
   */
  replaceToolMessage(replaceMessageId, newData) {
    const existingMessage = document.querySelector(
      `[data-message-id="${replaceMessageId}"]`
    )

    if (existingMessage && existingMessage.closest('.tool-group-container')) {
      const formattedMessage = this.formatMessage(newData.answer)
      existingMessage.innerHTML = `<span class="shell-prompt">></span> ${formattedMessage}`
    } else {
      this.handleToolOutput(newData)
    }
  }

  /**
   * Get tool group info for saving to localStorage.
   */
  getToolGroupInfo(groupId, toolkitName, toolName, message) {
    return {
      originalString: `[TOOL_OUTPUT:${groupId}] ${toolkitName} → ${toolName}`,
      messageId: `tool-${groupId}`,
      formattedMessage: this.formatMessage(message)
    }
  }

  /**
   * Check if a message is a tool output marker.
   */
  static isToolOutputMarker(messageString) {
    return messageString && messageString.startsWith('[TOOL_OUTPUT:')
  }

  /**
   * Clear all tool groups.
   */
  clearToolGroups() {
    this.toolGroups.clear()
  }

  /**
   * Get the number of active tool groups.
   */
  getToolGroupCount() {
    return this.toolGroups.size
  }

  /**
   * Get a specific tool group by ID.
   */
  getToolGroup(groupId) {
    return this.toolGroups.get(groupId)
  }

  /**
   * Remove a tool group.
   */
  removeToolGroup(groupId) {
    const toolGroup = this.toolGroups.get(groupId)
    if (toolGroup) {
      toolGroup.container.remove()
      this.toolGroups.delete(groupId)
    }
  }
}
