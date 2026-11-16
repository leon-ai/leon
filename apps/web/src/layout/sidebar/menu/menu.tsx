import { useEffect, useState } from 'react'

import { MenuItem } from '@/layout/sidebar/menu-item'

import './menu.sass'

const DEFAULT_MODIFIER_KEY = 'Ctrl'
const MACOS_PLATFORM_KEYWORD = 'mac'
const NAVIGATOR_USER_AGENT_DATA_KEY = 'userAgentData'
const MACOS_MODIFIER_KEY = {
  iconName: 'command',
  label: 'Command'
}

interface NavigatorUserAgentData {
  platform: string
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: NavigatorUserAgentData
}

function getPlatform(): string | undefined {
  if (NAVIGATOR_USER_AGENT_DATA_KEY in navigator) {
    return (navigator as NavigatorWithUserAgentData).userAgentData?.platform
  }

  return undefined
}

interface MenuProps {
  collapsed?: boolean
  onSearchSessions?: () => void
  onSearchIntent?: () => void
}

export function Menu({
  collapsed = false,
  onSearchSessions,
  onSearchIntent
}: MenuProps) {
  const [modifierKey, setModifierKey] = useState<string | typeof MACOS_MODIFIER_KEY>(
    MACOS_MODIFIER_KEY
  )

  useEffect(() => {
    const platform = getPlatform()

    if (
      platform !== undefined &&
      !platform.toLowerCase().includes(MACOS_PLATFORM_KEYWORD)
    ) {
      setModifierKey(DEFAULT_MODIFIER_KEY)
    }
  }, [])

  return (
    <nav className="menu menu-fixed" aria-label="Main menu">
      <MenuItem iconName="edit-box" label="New session" to="/" shortcutKeys={[modifierKey, 'Shift', 'O']} collapsed={collapsed} />
      <MenuItem
        iconName="search"
        label="Search sessions"
        shortcutKeys={[modifierKey, 'K']}
        collapsed={collapsed}
        onIntent={onSearchIntent}
        {...(onSearchSessions === undefined ? {} : { onClick: onSearchSessions })}
      />
      <MenuItem iconName="inbox-2" label="Inbox" collapsed={collapsed} />
    </nav>
  )
}
