import { createRef } from 'react'
import { createRoot } from 'react-dom/client'

import { requestBuiltInCommand } from './api'
import { BuiltInCommandsModal } from './modal'
import FileSystemAutocomplete from '../file-system-autocomplete'

const AUTOCOMPLETE_DELAY_MS = 90
const CLOSE_ANIMATION_DURATION_MS = 180
const ROOT_COMMAND_INPUT = '/'
const EDITABLE_ACTION_KEYS = new Set(['Backspace', 'Delete'])
const NAVIGATION_DIRECTIONS = {
  next: 1,
  previous: -1
}

function isEditableElement(element) {
  if (!element) {
    return false
  }

  const tagName = element.tagName?.toLowerCase()

  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    element.isContentEditable === true
  )
}

export default class BuiltInCommands {
  constructor({
    serverUrl,
    input,
    onSubmitToChat,
    getActiveSessionId,
    onCommandExecuted
  }) {
    this.serverUrl = serverUrl
    this.input = input
    this.onSubmitToChat = onSubmitToChat
    this.getActiveSessionId = getActiveSessionId
    this.onCommandExecuted = onCommandExecuted
    this.sessionId = null
    this.origin = 'shortcut'
    this.commandValue = ''
    this.selectedSuggestionIndex = -1
    this.suggestions = []
    this.recentSuggestions = []
    this.result = null
    this.loadingMessage = null
    this.pendingInput = null
    this.isOpen = false
    this.isClosing = false
    this.isLoading = false
    this.hasSubmitted = false
    this.autocompleteTimeout = null
    this.closeTimeout = null
    this.shouldFocusInput = false
    this.modalInputRef = createRef()
    this.fileSystemAutocomplete = new FileSystemAutocomplete({
      serverUrl,
      onValueChange: (value) => {
        this.handleCommandChange(value)
      }
    })
  }

  init() {
    this.mount()
    this.attachEvents()
    this.render()
  }

  mount() {
    this.container = document.createElement('div')
    document.body.appendChild(this.container)
    this.root = createRoot(this.container)
  }

  attachEvents() {
    document.addEventListener('keydown', (event) => {
      this.handleDocumentKeyDown(event)
    })

    this.input.addEventListener('input', () => {
      this.handleMainInput()
    })

    this.input.addEventListener('focus', () => {
      this.handleMainInput()
    })
  }

  render() {
    const focusedInputElement = this.modalInputRef.current
    const shouldRestoreCommandInputFocus =
      focusedInputElement && document.activeElement === focusedInputElement
    const selectionStart = shouldRestoreCommandInputFocus
      ? focusedInputElement.selectionStart
      : null
    const selectionEnd = shouldRestoreCommandInputFocus
      ? focusedInputElement.selectionEnd
      : null
    const { recentSelectedSuggestionIndex, suggestionSelectedSuggestionIndex } =
      this.getSelectedSuggestionIndices()

    this.root.render(
      <BuiltInCommandsModal
        isOpen={this.isOpen}
        isVisible={this.isOpen || this.isClosing}
        isLoading={this.isLoading}
        loadingMessage={this.loadingMessage}
        commandValue={this.commandValue}
        suggestions={this.suggestions}
        recentSuggestions={this.recentSuggestions}
        recentSelectedSuggestionIndex={recentSelectedSuggestionIndex}
        suggestionSelectedSuggestionIndex={suggestionSelectedSuggestionIndex}
        result={this.result}
        pendingInput={this.pendingInput}
        hasSubmitted={this.hasSubmitted}
        inputRef={this.modalInputRef}
        onCommandChange={(value) => {
          this.handleCommandChange(value)
        }}
        onMaskClick={() => {
          this.close()
        }}
        onSuggestionSelect={(suggestion) => {
          this.handleSuggestionSelect(suggestion)
        }}
        onReturn={() => {
          this.returnToSuggestions()
        }}
      />
    )

    if (this.shouldFocusInput) {
      this.shouldFocusInput = false

      window.requestAnimationFrame(() => {
        this.focusCommandInput()
      })
    } else if (shouldRestoreCommandInputFocus) {
      window.requestAnimationFrame(() => {
        this.restoreCommandInputFocus(selectionStart, selectionEnd)
      })
    }

    if (
      this.isOpen &&
      !this.hasSubmitted &&
      !this.result &&
      this.selectedSuggestionIndex >= 0
    ) {
      window.requestAnimationFrame(() => {
        this.scrollSelectedSuggestionIntoView()
      })
    }

    window.requestAnimationFrame(() => {
      this.attachFileSystemAutocomplete()
    })
  }

  attachFileSystemAutocomplete() {
    const inputElement = this.modalInputRef.current

    if (!inputElement) {
      return
    }

    this.fileSystemAutocomplete.attach(inputElement)
  }

  handleDocumentKeyDown(event) {
    if (this.isOpen) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.close()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.blurCommandInput()
        this.moveSelection(NAVIGATION_DIRECTIONS.next)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.blurCommandInput()
        this.moveSelection(NAVIGATION_DIRECTIONS.previous)
        return
      }

      if (event.key === 'Tab') {
        const suggestion =
          this.selectedSuggestionIndex >= 0
            ? this.getVisibleSuggestions()[this.selectedSuggestionIndex]
            : null

        if (suggestion) {
          event.preventDefault()
          this.applySuggestion(suggestion, {
            appendTrailingSpace: true
          })
        }

        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()

        if (this.selectedSuggestionIndex >= 0) {
          const suggestion =
            this.getVisibleSuggestions()[this.selectedSuggestionIndex]

          if (suggestion) {
            this.applySuggestion(suggestion)
            void this.submit()
            return
          }
        }

        this.submit()
        return
      }

      if (this.shouldHandleDetachedInputKey(event)) {
        event.preventDefault()
        this.handleDetachedInputKey(event)
        return
      }

      return
    }

    if (
      event.key !== '/' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return
    }

    const activeElement = document.activeElement

    if (
      activeElement === this.input ||
      (activeElement && isEditableElement(activeElement))
    ) {
      return
    }

    event.preventDefault()
    this.open({
      origin: 'shortcut',
      rawInput: '/'
    })
  }

  handleMainInput() {
    if (document.activeElement !== this.input) {
      return
    }

    const rawValue = this.input.value || ''

    if (!rawValue.startsWith('/')) {
      return
    }

    this.open({
      origin: 'input',
      rawInput: rawValue
    })
  }

  handleCommandChange(value) {
    this.commandValue = value
    this.hasSubmitted = false
    if (!this.pendingInput) {
      this.result = null
      this.loadingMessage = null
      this.queueAutocomplete()
    }
    this.render()
  }

  open({ origin, rawInput }) {
    window.clearTimeout(this.closeTimeout)

    if (this.isOpen) {
      this.origin = origin
      this.commandValue = this.normalizeCommandValue(rawInput)
      this.result = null
      this.loadingMessage = null
      this.pendingInput = null
      this.hasSubmitted = false
      this.shouldFocusInput = true
      this.input.value = ''
      this.queueAutocomplete()
      this.render()
      return
    }

    this.origin = origin
    this.sessionId = null
    this.commandValue = this.normalizeCommandValue(rawInput)
    this.suggestions = []
    this.result = null
    this.loadingMessage = null
    this.pendingInput = null
    this.selectedSuggestionIndex = -1
    this.hasSubmitted = false
    this.isOpen = true
    this.isClosing = false
    this.shouldFocusInput = true
    this.input.value = ''

    if (this.origin === 'input') {
      this.input.blur()
    }

    this.queueAutocomplete()
    this.render()
  }

  close() {
    if (!this.isOpen || this.isClosing) {
      return
    }

    this.isClosing = true
    this.isOpen = false
    this.fileSystemAutocomplete.close()
    this.render()

    this.closeTimeout = window.setTimeout(() => {
      this.resetState()
      this.render()
      this.focusMainInput()
    }, CLOSE_ANIMATION_DURATION_MS)
  }

  queueAutocomplete() {
    window.clearTimeout(this.autocompleteTimeout)
    this.isLoading = true

    this.autocompleteTimeout = window.setTimeout(() => {
      void this.fetchAutocomplete()
    }, AUTOCOMPLETE_DELAY_MS)
  }

  async fetchAutocomplete() {
    try {
      const data = await requestBuiltInCommand(this.serverUrl, {
        mode: 'autocomplete',
        input: this.buildCommandInput(),
        session_id: this.sessionId,
        conversation_session_id: this.getActiveSessionId?.()
      })

      if (!this.isOpen || this.hasSubmitted) {
        return
      }

      this.sessionId = data.session.id
      this.suggestions = data.suggestions || []
      this.recentSuggestions = data.recent_suggestions || []
      this.loadingMessage = data.session.loading_message || null
      this.pendingInput = data.session.pending_input || null
      this.selectedSuggestionIndex =
        this.getVisibleSuggestions().length > 0 ? 0 : -1
      this.isLoading = false
      this.render()
    } catch (error) {
      if (!this.isOpen || this.hasSubmitted) {
        return
      }

      this.isLoading = false
      this.result = {
        title: 'Command Error',
        tone: 'error',
        blocks: [
          {
            type: 'list',
            items: [
              {
                label: error.message || 'Failed to load built-in commands.',
                tone: 'error'
              }
            ]
          }
        ]
      }
      this.loadingMessage = null
      this.render()
    }
  }

  async submit() {
    const commandInput = this.buildCommandInput()

    if (commandInput === ROOT_COMMAND_INPUT) {
      return
    }

    window.clearTimeout(this.autocompleteTimeout)
    this.autocompleteTimeout = null

    await this.resolveLoadingMessageForSubmission(commandInput)

    this.isLoading = true
    this.hasSubmitted = true
    this.result = null
    this.commandValue = ''
    this.suggestions = []
    this.selectedSuggestionIndex = -1
    this.render()

    try {
      const data = await requestBuiltInCommand(this.serverUrl, {
        mode: 'execute',
        input: commandInput,
        session_id: this.sessionId,
        conversation_session_id: this.getActiveSessionId?.()
      })

      if (data.client_action?.type === 'submit_to_chat') {
        const wasSubmitted = this.onSubmitToChat?.(data.client_action)

        if (!wasSubmitted) {
          throw new Error('Failed to submit the built-in command to chat.')
        }

        this.isLoading = false
        this.close()
        return
      }

      this.sessionId = data.session.id
      this.isLoading = false
      this.result = data.result
      this.onCommandExecuted?.(commandInput, data)
      this.loadingMessage = data.session.loading_message || null
      this.recentSuggestions = data.recent_suggestions || []
      this.pendingInput = data.session.pending_input || null
      this.commandValue = ''
      this.render()
    } catch (error) {
      this.isLoading = false
      this.result = {
        title: 'Command Error',
        tone: 'error',
        blocks: [
          {
            type: 'list',
            items: [
              {
                label:
                  error.message || 'Failed to execute the built-in command.',
                tone: 'error'
              }
            ]
          }
        ]
      }
      this.loadingMessage = null
      this.render()
    }
  }

  async resolveLoadingMessageForSubmission(commandInput) {
    try {
      const data = await requestBuiltInCommand(this.serverUrl, {
        mode: 'autocomplete',
        input: commandInput,
        session_id: this.sessionId,
        conversation_session_id: this.getActiveSessionId?.()
      })

      this.sessionId = data.session.id
      this.loadingMessage = data.session.loading_message || null
    } catch {
      this.loadingMessage = null
    }
  }

  moveSelection(direction) {
    if (this.hasSubmitted || this.result) {
      return
    }

    const visibleSuggestions = this.getVisibleSuggestions()

    if (visibleSuggestions.length === 0) {
      return
    }

    if (this.selectedSuggestionIndex === -1) {
      this.selectedSuggestionIndex = 0
    } else {
      this.selectedSuggestionIndex =
        (this.selectedSuggestionIndex +
          direction +
          visibleSuggestions.length) %
        visibleSuggestions.length
    }

    this.render()
  }

  handleSuggestionSelect(suggestion) {
    const normalizedSuggestionValue = this.normalizeCommandValue(suggestion.value)

    if (normalizedSuggestionValue.trim() === this.commandValue.trim()) {
      void this.submit()
      return
    }

    this.applySuggestion(suggestion, {
      appendTrailingSpace: true
    })
  }

  applySuggestion(suggestion, options = {}) {
    this.commandValue = `${this.normalizeCommandValue(suggestion.value)}${
      options.appendTrailingSpace ? ' ' : ''
    }`
    this.loadingMessage = null
    this.queueAutocomplete()
    this.shouldFocusInput = true
    this.render()
  }

  returnToSuggestions() {
    this.sessionId = null
    this.hasSubmitted = false
    this.result = null
    this.loadingMessage = null
    this.pendingInput = null
    this.commandValue = ''
    this.suggestions = []
    this.selectedSuggestionIndex = -1
    this.shouldFocusInput = true
    this.queueAutocomplete()
    this.render()
  }

  focusCommandInput() {
    const inputElement = this.modalInputRef.current

    if (!inputElement) {
      return
    }

    inputElement.focus()

    if (typeof inputElement.setSelectionRange === 'function') {
      inputElement.setSelectionRange(
        inputElement.value.length,
        inputElement.value.length
      )
    }
  }

  restoreCommandInputFocus(selectionStart, selectionEnd) {
    const inputElement = this.modalInputRef.current

    if (!inputElement) {
      return
    }

    if (document.activeElement !== inputElement) {
      try {
        inputElement.focus({ preventScroll: true })
      } catch {
        inputElement.focus()
      }
    }

    if (
      typeof inputElement.setSelectionRange === 'function' &&
      selectionStart !== null &&
      selectionEnd !== null
    ) {
      inputElement.setSelectionRange(selectionStart, selectionEnd)
    }
  }

  blurCommandInput() {
    const inputElement = this.modalInputRef.current

    if (!inputElement || document.activeElement !== inputElement) {
      return
    }

    inputElement.blur()
  }

  focusMainInput() {
    if (!this.input) {
      return
    }

    window.requestAnimationFrame(() => {
      try {
        this.input.focus({ preventScroll: true })
      } catch {
        this.input.focus()
      }

      if (typeof this.input.setSelectionRange === 'function') {
        this.input.setSelectionRange(
          this.input.value.length,
          this.input.value.length
        )
      }
    })
  }

  scrollSelectedSuggestionIntoView() {
    const selectedSuggestionElement = this.container?.querySelector(
      '.aurora-list-item--selected'
    )

    if (!selectedSuggestionElement) {
      return
    }

    selectedSuggestionElement.scrollIntoView({
      block: 'nearest'
    })
  }

  shouldHandleDetachedInputKey(event) {
    const inputElement = this.modalInputRef.current

    if (!inputElement || document.activeElement === inputElement) {
      return false
    }

    return (
      event.key.length === 1 ||
      EDITABLE_ACTION_KEYS.has(event.key)
    )
  }

  handleDetachedInputKey(event) {
    if (event.key.length === 1) {
      this.commandValue += event.key
    } else if (event.key === 'Backspace') {
      this.commandValue = this.commandValue.slice(0, -1)
    } else if (event.key === 'Delete') {
      this.commandValue = ''
    }

    this.hasSubmitted = false
    this.result = null
    this.loadingMessage = null
    this.queueAutocomplete()
    this.shouldFocusInput = true
    this.render()
  }

  normalizeCommandValue(rawInput) {
    const normalizedValue = String(rawInput || '').trim()

    if (!normalizedValue.startsWith('/')) {
      return normalizedValue
    }

    return normalizedValue.slice(1)
  }

  buildCommandInput() {
    if (this.pendingInput) {
      return this.commandValue
    }

    return `/${this.commandValue}`.trim()
  }

  getVisibleSuggestions() {
    if (this.commandValue.trim() === '') {
      return [...this.recentSuggestions, ...this.suggestions]
    }

    return this.suggestions
  }

  getSelectedSuggestionIndices() {
    if (this.commandValue.trim() !== '') {
      return {
        recentSelectedSuggestionIndex: -1,
        suggestionSelectedSuggestionIndex: this.selectedSuggestionIndex
      }
    }

    const recentSuggestionsLength = this.recentSuggestions.length

    if (this.selectedSuggestionIndex < 0) {
      return {
        recentSelectedSuggestionIndex: -1,
        suggestionSelectedSuggestionIndex: -1
      }
    }

    if (this.selectedSuggestionIndex < recentSuggestionsLength) {
      return {
        recentSelectedSuggestionIndex: this.selectedSuggestionIndex,
        suggestionSelectedSuggestionIndex: -1
      }
    }

    return {
      recentSelectedSuggestionIndex: -1,
      suggestionSelectedSuggestionIndex:
        this.selectedSuggestionIndex - recentSuggestionsLength
    }
  }

  resetState() {
    window.clearTimeout(this.autocompleteTimeout)
    this.isClosing = false
    this.isLoading = false
    this.sessionId = null
    this.origin = 'shortcut'
    this.commandValue = ''
    this.suggestions = []
    this.result = null
    this.loadingMessage = null
    this.pendingInput = null
    this.selectedSuggestionIndex = -1
    this.hasSubmitted = false
    this.shouldFocusInput = false
    this.autocompleteTimeout = null
  }
}
