import { Status } from '@/components/status'
import { MenuItem } from '@/layout/sidebar/menu-item'
import { AppShortcutKey, APP_MODIFIER_LABEL, getAppShortcutAria, NEW_SESSION_REQUIRES_SHIFT } from '@/utils/keyboard-shortcuts'

import './menu.sass'

const NEW_SESSION_KEYS = [APP_MODIFIER_LABEL, ...(NEW_SESSION_REQUIRES_SHIFT ? ['Shift'] : []), AppShortcutKey.NewSession.toUpperCase()]
const NEW_SESSION_ARIA = getAppShortcutAria(AppShortcutKey.NewSession, NEW_SESSION_REQUIRES_SHIFT) +
  (NEW_SESSION_REQUIRES_SHIFT ? '' : ` ${getAppShortcutAria(AppShortcutKey.NewSession, true)}`)

interface MenuProps {
  collapsed?: boolean
  onSearchSessions?: () => void
  onSearchIntent?: () => void
}

function SoonStatus() {
  return <Status variant="secondary" label="Soon" />
}

export function Menu({
  collapsed = false,
  onSearchSessions,
  onSearchIntent
}: MenuProps) {
  return (
    <nav className="menu menu-fixed" aria-label="Main menu">
      <MenuItem iconName="edit-box" label="New session" to="/" shortcutKeys={NEW_SESSION_KEYS}
        ariaKeyShortcuts={NEW_SESSION_ARIA} collapsed={collapsed} />
      <MenuItem
        iconName="search"
        label="Search sessions"
        shortcutKeys={[APP_MODIFIER_LABEL, AppShortcutKey.SearchSessions.toUpperCase()]}
        ariaKeyShortcuts={getAppShortcutAria(AppShortcutKey.SearchSessions)}
        collapsed={collapsed}
        onIntent={onSearchIntent}
        {...(onSearchSessions === undefined ? {} : { onClick: onSearchSessions })}
      />
      <MenuItem
        iconName="inbox-2"
        label="Inbox"
        disabled
        status={SoonStatus}
        collapsed={collapsed}
      />
      <MenuItem
        iconName="archive-2"
        label="Files"
        disabled
        status={SoonStatus}
        collapsed={collapsed}
      />
    </nav>
  )
}
