import axios from 'axios'

const AUTOCOMPLETE_DELAY_MS = 80
const CLOSE_DELAY_MS = 120
const DROPDOWN_MARGIN_PX = 8
const MINIMUM_DROPDOWN_HEIGHT_PX = 196
const MAXIMUM_DROPDOWN_HEIGHT_PX = 280
const FILE_SYSTEM_TRIGGER = '@'
const FOLDER_TYPE = 'folder'
const DEFAULT_FILE_ICON_NAME = 'file-line'
const DEFAULT_FOLDER_ICON_NAME = 'folder-3-line'
const NAVIGATION_DIRECTIONS = {
  next: 1,
  previous: -1
}

function isWhitespace(character) {
  return character.trim() === ''
}

function findPathToken(input) {
  const selectionStart = input.selectionStart ?? input.value.length
  let tokenStart = selectionStart

  while (
    tokenStart > 0 &&
    !isWhitespace(input.value.charAt(tokenStart - 1))
  ) {
    tokenStart -= 1
  }

  if (input.value.charAt(tokenStart) !== FILE_SYSTEM_TRIGGER) {
    return null
  }

  return {
    start: tokenStart,
    end: selectionStart,
    value: input.value.slice(tokenStart, selectionStart)
  }
}

export default class FileSystemAutocomplete {
  constructor({ serverUrl, input = null, onValueChange = null }) {
    this.serverUrl = serverUrl
    this.input = null
    this.onValueChange = onValueChange
    this.dropdown = document.createElement('div')
    this.dropdown.className = 'file-system-autocomplete file-system-autocomplete--hidden'
    this.entries = []
    this.selectedEntryIndex = -1
    this.token = null
    this.isOpen = false
    this.requestCounter = 0
    this.autocompleteTimeout = null
    this.closeTimeout = null
    this.shouldScrollSelectedEntry = false

    this.handleInput = this.handleInput.bind(this)
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleFocus = this.handleFocus.bind(this)
    this.handleClick = this.handleClick.bind(this)
    this.handleBlur = this.handleBlur.bind(this)
    this.handleWindowChange = this.handleWindowChange.bind(this)

    document.body.appendChild(this.dropdown)

    if (input) {
      this.attach(input)
    }
  }

  attach(input) {
    if (this.input === input) {
      return
    }

    window.clearTimeout(this.closeTimeout)

    if (this.input) {
      this.removeInputListeners()
    }

    this.input = input
    this.input.addEventListener('input', this.handleInput)
    this.input.addEventListener('keydown', this.handleKeyDown)
    this.input.addEventListener('focus', this.handleFocus)
    this.input.addEventListener('click', this.handleClick)
    this.input.addEventListener('blur', this.handleBlur)
    window.addEventListener('resize', this.handleWindowChange)
    window.addEventListener('scroll', this.handleWindowChange, true)
  }

  removeInputListeners() {
    if (!this.input) {
      return
    }

    this.input.removeEventListener('input', this.handleInput)
    this.input.removeEventListener('keydown', this.handleKeyDown)
    this.input.removeEventListener('focus', this.handleFocus)
    this.input.removeEventListener('click', this.handleClick)
    this.input.removeEventListener('blur', this.handleBlur)
    window.removeEventListener('resize', this.handleWindowChange)
    window.removeEventListener('scroll', this.handleWindowChange, true)
    this.input = null
  }

  detach() {
    this.removeInputListeners()
    this.close()
  }

  handleInput() {
    window.clearTimeout(this.closeTimeout)
    this.queueAutocomplete()
  }

  handleFocus() {
    window.clearTimeout(this.closeTimeout)
    this.queueAutocomplete()
  }

  handleClick() {
    this.queueAutocomplete()
  }

  handleBlur() {
    this.queueClose()
  }

  queueClose() {
    window.clearTimeout(this.closeTimeout)
    this.closeTimeout = window.setTimeout(() => {
      this.close()
    }, CLOSE_DELAY_MS)
  }

  handleWindowChange() {
    if (this.isOpen) {
      this.positionDropdown()
    }
  }

  handleKeyDown(event) {
    if (!this.isOpen) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.close()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.moveSelection(NAVIGATION_DIRECTIONS.next)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.moveSelection(NAVIGATION_DIRECTIONS.previous)
      return
    }

    if (event.key === 'Tab' || event.key === 'Enter') {
      const selectedEntry = this.entries[this.selectedEntryIndex]

      if (selectedEntry) {
        event.preventDefault()
        event.stopImmediatePropagation()
        this.applyEntry(selectedEntry)
      }
    }
  }

  queueAutocomplete() {
    window.clearTimeout(this.autocompleteTimeout)
    this.autocompleteTimeout = window.setTimeout(() => {
      void this.fetchAutocomplete()
    }, AUTOCOMPLETE_DELAY_MS)
  }

  async fetchAutocomplete() {
    if (!this.input) {
      this.close()
      return
    }

    if (document.activeElement !== this.input) {
      this.queueClose()
      return
    }

    const token = findPathToken(this.input)

    if (!token) {
      this.close()
      return
    }

    const requestId = this.requestCounter + 1
    this.requestCounter = requestId
    this.token = token

    try {
      const response = await axios.post(
        `${this.serverUrl}/api/v1/file-system/list`,
        {
          value: token.value
        }
      )

      if (requestId !== this.requestCounter) {
        return
      }

      this.entries = response.data.entries || []
      this.selectedEntryIndex = this.entries.length > 0 ? 0 : -1
      this.render()
    } catch {
      if (requestId !== this.requestCounter) {
        return
      }

      this.entries = []
      this.selectedEntryIndex = -1
      this.render()
    }
  }

  render() {
    if (!this.input || !this.token) {
      this.close()
      return
    }

    this.dropdown.innerHTML = ''

    if (this.entries.length === 0) {
      const emptyElement = document.createElement('div')
      emptyElement.className = 'file-system-autocomplete__empty'
      emptyElement.textContent = 'No matching file system entry.'
      this.dropdown.appendChild(emptyElement)
    } else {
      this.entries.forEach((entry, index) => {
        const item = document.createElement('button')
        const icon = document.createElement('i')
        const label = document.createElement('span')

        item.type = 'button'
        item.className = `file-system-autocomplete__item${
          index === this.selectedEntryIndex
            ? ' file-system-autocomplete__item--selected'
            : ''
        }`
        icon.className = `ri-${
          entry.iconName ||
          (entry.type === FOLDER_TYPE
            ? DEFAULT_FOLDER_ICON_NAME
            : DEFAULT_FILE_ICON_NAME)
        }`
        label.className = 'file-system-autocomplete__label'
        label.textContent = entry.value

        item.addEventListener('mousedown', (event) => {
          event.preventDefault()
        })
        item.addEventListener('click', () => {
          this.applyEntry(entry)
        })

        item.appendChild(icon)
        item.appendChild(label)
        this.dropdown.appendChild(item)
      })
    }

    this.isOpen = true
    this.dropdown.classList.remove('file-system-autocomplete--hidden')
    this.positionDropdown()

    if (this.shouldScrollSelectedEntry) {
      this.shouldScrollSelectedEntry = false
      this.scrollSelectedEntryIntoView()
    }
  }

  positionDropdown() {
    const inputRect = this.input.getBoundingClientRect()
    const spaceBelow = window.innerHeight - inputRect.bottom
    const spaceAbove = inputRect.top
    const shouldOpenAbove =
      spaceBelow < MINIMUM_DROPDOWN_HEIGHT_PX && spaceAbove > spaceBelow
    const availableHeight =
      (shouldOpenAbove ? spaceAbove : spaceBelow) - DROPDOWN_MARGIN_PX * 2
    const maxHeight = Math.min(
      MAXIMUM_DROPDOWN_HEIGHT_PX,
      Math.max(MINIMUM_DROPDOWN_HEIGHT_PX, availableHeight)
    )

    this.dropdown.style.left = `${inputRect.left}px`
    this.dropdown.style.width = `${inputRect.width}px`
    this.dropdown.style.maxHeight = `${maxHeight}px`

    if (shouldOpenAbove) {
      this.dropdown.style.top = ''
      this.dropdown.style.bottom = `${
        window.innerHeight - inputRect.top + DROPDOWN_MARGIN_PX
      }px`
    } else {
      this.dropdown.style.top = `${inputRect.bottom + DROPDOWN_MARGIN_PX}px`
      this.dropdown.style.bottom = ''
    }
  }

  moveSelection(direction) {
    if (this.entries.length === 0) {
      return
    }

    this.selectedEntryIndex =
      (this.selectedEntryIndex + direction + this.entries.length) %
      this.entries.length
    this.shouldScrollSelectedEntry = true
    this.render()
  }

  scrollSelectedEntryIntoView() {
    const selectedEntryElement = this.dropdown.querySelector(
      '.file-system-autocomplete__item--selected'
    )

    if (!selectedEntryElement) {
      return
    }

    selectedEntryElement.scrollIntoView({
      block: 'nearest'
    })
  }

  applyEntry(entry) {
    if (!this.input || !this.token) {
      return
    }

    const completedValue = entry.absolutePath || entry.value
    const nextCharacter = this.input.value.charAt(this.token.end)
    const shouldAddTrailingWhitespace =
      nextCharacter === '' || !isWhitespace(nextCharacter)
    const insertedValue = `${completedValue}${
      shouldAddTrailingWhitespace ? ' ' : ''
    }`
    const nextValue = `${this.input.value.slice(0, this.token.start)}${
      insertedValue
    }${this.input.value.slice(this.token.end)}`
    const nextCursorPosition = this.token.start + insertedValue.length

    this.input.value = nextValue
    this.input.setSelectionRange(nextCursorPosition, nextCursorPosition)
    this.input.dispatchEvent(new Event('input', { bubbles: true }))

    if (this.onValueChange) {
      this.onValueChange(nextValue)
      window.requestAnimationFrame(() => {
        this.input?.setSelectionRange(nextCursorPosition, nextCursorPosition)
      })
    }

    this.close()
  }

  close() {
    this.isOpen = false
    this.entries = []
    this.selectedEntryIndex = -1
    this.token = null
    this.dropdown.classList.add('file-system-autocomplete--hidden')
  }
}
