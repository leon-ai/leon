/**
 * Tool UI Handler
 * Manages the display and interaction of tool output in shell-like containers
 */
export default class ToolUIHandler {
  constructor(feedElement, scrollDownCallback, formatMessageCallback) {
    this.feed = feedElement
    this.scrollDown = scrollDownCallback
    this.formatMessage = formatMessageCallback
    this.toolGroups = new Map() // Track tool group containers
  }

  /**
   * Handle tool output messages with shell-like UI
   */
  handleToolOutput(data) {
    const {
      toolkitName,
      toolName,
      toolGroupId,
      answer,
      replaceMessageId,
      key
    } = data

    // Check if we need to replace an existing message
    if (replaceMessageId) {
      this.replaceToolMessage(replaceMessageId, data)
      return
    }

    // Extract answer key from the key (take part after last dot)
    const answerKey = key ? key.split('.').pop() : 'unknown'

    // Create a fallback group ID if none provided
    const groupId = toolGroupId || `${toolkitName}_${toolName}_${Date.now()}`

    // Get or create tool group container
    let toolGroupContainer = this.toolGroups.get(groupId)

    if (!toolGroupContainer) {
      toolGroupContainer = this.createToolGroupContainer(
        groupId,
        toolkitName,
        toolName,
        answerKey
      )
      this.toolGroups.set(groupId, toolGroupContainer)
    }

    // Add the tool message to the shell output
    this.addToolMessage(toolGroupContainer, answer)

    // Auto-scroll to bottom
    this.scrollDown()

    return {
      groupId,
      isNewGroup: toolGroupContainer.isNew
    }
  }

  /**
   * Create a new tool group container
   */
  createToolGroupContainer(groupId, toolkitName, toolName, answerKey) {
    // Create new tool group container
    const groupContainer = document.createElement('div')
    groupContainer.className = 'tool-group-container'
    groupContainer.setAttribute('data-tool-group-id', groupId)

    // Create tool header (expandable)
    const toolHeader = document.createElement('div')
    toolHeader.className = 'tool-header'
    toolHeader.innerHTML = `
      <i class="ri-terminal-line tool-icon"></i>
      <span class="tool-name">${toolkitName} toolkit → ${toolName} → ${answerKey}</span>
      <i class="ri-arrow-down-s-line expand-icon"></i>
    `

    // Create tool content area
    const toolContent = document.createElement('div')
    toolContent.className = 'tool-content'

    // Create shell output area
    const shellOutput = document.createElement('div')
    shellOutput.className = 'shell-output'

    toolContent.appendChild(shellOutput)
    groupContainer.appendChild(toolHeader)
    groupContainer.appendChild(toolContent)

    // Add expand/collapse functionality
    this.addExpandCollapseHandler(toolHeader, toolContent)

    // Initially expanded
    // toolContent.classList.add('expanded')
    // toolHeader.querySelector('.expand-icon').classList.add('rotated')

    this.feed.appendChild(groupContainer)

    return {
      container: groupContainer,
      toolHeader: toolHeader,
      toolContent: toolContent,
      shellOutput: shellOutput,
      isNew: true
    }
  }

  /**
   * Add expand/collapse functionality to tool header
   */
  addExpandCollapseHandler(toolHeader, toolContent) {
    toolHeader.addEventListener('click', () => {
      const isExpanded = toolContent.classList.contains('expanded')
      const expandIcon = toolHeader.querySelector('.expand-icon')

      if (isExpanded) {
        toolContent.classList.remove('expanded')
        expandIcon.classList.remove('rotated')
      } else {
        toolContent.classList.add('expanded')
        expandIcon.classList.add('rotated')
      }
    })
  }

  /**
   * Add a tool message to the shell output
   */
  addToolMessage(toolGroupContainer, message) {
    const messageElement = document.createElement('div')
    messageElement.className = 'shell-message'

    // Format the message
    const formattedMessage = this.formatMessage(message)
    messageElement.innerHTML = `<span class="shell-prompt">></span> ${formattedMessage}`

    toolGroupContainer.shellOutput.appendChild(messageElement)

    // Mark as no longer new after first message
    if (toolGroupContainer.isNew) {
      toolGroupContainer.isNew = false
    }
  }

  /**
   * Replace a tool message (for progress updates, etc.)
   */
  replaceToolMessage(replaceMessageId, newData) {
    // Find existing tool message by ID
    const existingMessage = document.querySelector(
      `[data-message-id="${replaceMessageId}"]`
    )

    if (existingMessage && existingMessage.closest('.tool-group-container')) {
      // If it's within a tool container, update just that message
      const formattedMessage = this.formatMessage(newData.answer)
      existingMessage.innerHTML = `<span class="shell-prompt">></span> ${formattedMessage}`
    } else {
      // Fallback: create new tool output
      this.handleToolOutput(newData)
    }
  }

  /**
   * Get tool group info for saving to localStorage
   */
  getToolGroupInfo(groupId, toolkitName, toolName, message) {
    return {
      originalString: `[TOOL_OUTPUT:${groupId}] ${toolkitName} → ${toolName}`,
      messageId: `tool-${groupId}`,
      formattedMessage: this.formatMessage(message)
    }
  }

  /**
   * Check if a message is a tool output marker
   */
  static isToolOutputMarker(messageString) {
    return messageString && messageString.startsWith('[TOOL_OUTPUT:')
  }

  /**
   * Clear all tool groups (useful for cleanup)
   */
  clearToolGroups() {
    this.toolGroups.clear()
  }

  /**
   * Get the number of active tool groups
   */
  getToolGroupCount() {
    return this.toolGroups.size
  }

  /**
   * Get a specific tool group by ID
   */
  getToolGroup(groupId) {
    return this.toolGroups.get(groupId)
  }

  /**
   * Remove a tool group
   */
  removeToolGroup(groupId) {
    const toolGroup = this.toolGroups.get(groupId)
    if (toolGroup) {
      toolGroup.container.remove()
      this.toolGroups.delete(groupId)
    }
  }
}
