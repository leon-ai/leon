import {
  Button,
  Flexbox,
  Icon,
  Input,
  List,
  ListHeader,
  ListItem,
  Loader,
  ScrollContainer,
  Text
} from '@aurora'

import { BuiltInCommandResultRenderer } from './result-renderer'

const SLASH_COMMAND_ICON_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M9.78839 21H7.66003L14.2115 3H16.3398L9.78839 21Z" />
  </svg>
)

function parseRemixIcon(rawIconName, rawIconType) {
  const fallbackIcon = {
    iconName: 'terminal-box',
    type: 'line'
  }
  const normalizedIconName = String(rawIconName || '').trim()
  const normalizedIconType = ['line', 'fill', 'notype'].includes(rawIconType)
    ? rawIconType
    : null

  if (!normalizedIconName) {
    return fallbackIcon
  }

  const iconWithoutPrefix = normalizedIconName.replace(/^ri-/, '')

  if (iconWithoutPrefix.endsWith('-line')) {
    return {
      iconName: iconWithoutPrefix.slice(0, -5),
      type: 'line'
    }
  }

  if (iconWithoutPrefix.endsWith('-fill')) {
    return {
      iconName: iconWithoutPrefix.slice(0, -5),
      type: 'fill'
    }
  }

  return {
    iconName: iconWithoutPrefix,
    type: normalizedIconType || 'notype'
  }
}

function SuggestionList({
  headerTitle,
  suggestions,
  selectedSuggestionIndex,
  onSuggestionSelect
}) {
  return (
    <List>
      <ListHeader>{headerTitle}</ListHeader>
      {suggestions.map((suggestion, index) => {
        const parsedIcon = parseRemixIcon(
          suggestion.icon_name,
          suggestion.icon_type
        )

        return (
          <ListItem
            key={`suggestion-${suggestion.value}-${index}`}
            name="built-in-command-suggestion"
            value={suggestion.value}
            selected={index === selectedSuggestionIndex}
            onClick={() => {
              onSuggestionSelect(suggestion)
            }}
          >
            <Flexbox flexDirection="row" alignItems="center" gap="md">
              <Icon
                iconName={parsedIcon.iconName}
                type={parsedIcon.type}
                size="md"
                bgShape="square"
                color="blue"
                bgColor="transparent-blue"
              />
              <div className="built-in-commands-modal__suggestion-copy">
                <Text fontWeight="semi-bold">{suggestion.usage}</Text>
                <Text secondary>{suggestion.description}</Text>
              </div>
            </Flexbox>
          </ListItem>
        )
      })}
    </List>
  )
}

function LoadingState({ loadingMessage }) {
  return (
    <List>
      <ListHeader>Working</ListHeader>
      <ListItem>
        <Flexbox flexDirection="row" alignItems="center" gap="sm">
          <Loader size="sm" />
          <Text>{loadingMessage || 'Working on it...'}</Text>
        </Flexbox>
      </ListItem>
    </List>
  )
}

function EmptyState() {
  return (
    <List>
      <ListHeader>Suggestions</ListHeader>
      <ListItem>
        <Text secondary>No matching built-in command.</Text>
      </ListItem>
    </List>
  )
}

export function BuiltInCommandsModal({
  isOpen,
  isVisible,
  isLoading,
  loadingMessage,
  commandValue,
  suggestions,
  recentSuggestions,
  recentSelectedSuggestionIndex,
  suggestionSelectedSuggestionIndex,
  result,
  pendingInput,
  hasSubmitted,
  inputRef,
  onCommandChange,
  onMaskClick,
  onSuggestionSelect,
  onReturn
}) {
  const isCommandInputEmpty = commandValue.trim() === ''
  const pendingInputIcon = pendingInput?.icon_name
    ? parseRemixIcon(pendingInput.icon_name, pendingInput.icon_type)
    : null

  return (
    <div
      className={`built-in-commands-modal ${
        isOpen
          ? 'built-in-commands-modal--open'
          : isVisible
            ? ''
            : 'built-in-commands-modal--hidden'
      }`}
      aria-hidden={!isVisible}
    >
      <div className="built-in-commands-modal__mask" onClick={onMaskClick} />
      <div
        className="built-in-commands-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Built-in commands"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="built-in-commands-modal__section built-in-commands-modal__section--top">
          <Flexbox flexDirection="row" alignItems="center" gap="md">
            {hasSubmitted && result ? (
              <div className="built-in-commands-modal__return-button">
                <Button
                  light
                  iconName="arrow-left-double"
                  iconSize="lg"
                  onClick={() => {
                    onReturn()
                  }}
                />
              </div>
            ) : null}
            <div className="built-in-commands-modal__input-field">
              <Input
                name="built-in-commands"
                type={pendingInput?.type || 'text'}
                placeholder={
                  pendingInput?.placeholder || 'Type a built-in command'
                }
                maxLength={2_048}
                iconName={pendingInputIcon?.iconName}
                iconType={pendingInputIcon ? pendingInputIcon.type : undefined}
                iconSVG={pendingInput ? undefined : SLASH_COMMAND_ICON_SVG}
                iconSize="lg"
                value={commandValue}
                autofocus={isOpen}
                inputRef={inputRef}
                onChange={onCommandChange}
              />
            </div>
          </Flexbox>
        </div>
        <div className="built-in-commands-modal__section built-in-commands-modal__section--middle">
          <div className="built-in-commands-modal__scroll-area">
            <ScrollContainer orientation="vertical" height="100%">
              {isLoading ? (
                <LoadingState loadingMessage={loadingMessage} />
              ) : result ? (
                <BuiltInCommandResultRenderer result={result} />
              ) : suggestions.length > 0 ? (
                <Flexbox gap="md">
                  {isCommandInputEmpty && recentSuggestions.length > 0 ? (
                    <SuggestionList
                      headerTitle="Recently Used Commands"
                      suggestions={recentSuggestions}
                      selectedSuggestionIndex={recentSelectedSuggestionIndex}
                      onSuggestionSelect={onSuggestionSelect}
                    />
                  ) : null}
                  <SuggestionList
                    headerTitle={
                      isCommandInputEmpty ? 'All Commands' : 'Suggested Commands'
                    }
                    suggestions={suggestions}
                    selectedSuggestionIndex={suggestionSelectedSuggestionIndex}
                    onSuggestionSelect={onSuggestionSelect}
                  />
                </Flexbox>
              ) : (
                <EmptyState />
              )}
            </ScrollContainer>
          </div>
        </div>
        <div className="built-in-commands-modal__section built-in-commands-modal__section--bottom">
          <Flexbox flexDirection="row" gap="md">
            <Text fontSize="xs" secondary>
              <kbd>↑</kbd> <kbd>↓</kbd> navigate
            </Text>
            <Text fontSize="xs" secondary>
              <kbd>tab</kbd> complete
            </Text>
            <Text fontSize="xs" secondary>
              <kbd>enter</kbd> submit
            </Text>
            <Text fontSize="xs" secondary>
              <kbd>esc</kbd> close
            </Text>
          </Flexbox>
        </div>
      </div>
    </div>
  )
}
