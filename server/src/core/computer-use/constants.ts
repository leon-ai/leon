export const COMPUTER_USE_PROVIDER_ID = 'computer_use'
export const COMPUTER_USE_ARTIFACT_DIRECTORY = 'computer-use'
export const COMPUTER_USE_TEXT_PREVIEW_MAX_CHARS = 8_000
export const COMPUTER_USE_MODEL_IMAGE_LIMIT = 1
export const COMPUTER_USE_MODEL_IMAGE_PIXEL_BUDGET = 800_000
export const COMPUTER_USE_APP_RESULT_LIMIT = 24
export const COMPUTER_USE_APP_WINDOW_LIMIT = 3
export const COMPUTER_USE_APP_QUERY_PARAMETER = 'query'
export const COMPUTER_USE_WINDOW_RESULT_LIMIT = 24
export const COMPUTER_USE_BROWSER_REF_LIMIT = 120
export const COMPUTER_USE_VISUAL_STATE_LIMIT = 512
export const COMPUTER_USE_BROWSER_QUERY_RETRY_DELAYS_MS = [500, 1_000] as const
export const CUA_TELEMETRY_ENABLED_ENV = 'CUA_TELEMETRY_ENABLED'
export const CUA_X11_UINPUT_SAFETY_ENV = 'KDE_FULL_SESSION'
export const COMPUTER_USE_REMOTE_DRIVER_URL_ENV =
  'LEON_COMPUTER_USE_REMOTE_URL'
export const COMPUTER_USE_REMOTE_DRIVER_TOKEN_ENV = 'LEON_PROFILE_TOKEN'
export const COMPUTER_USE_REMOTE_DRIVER_TIMEOUT_MS = 90_000
export const COMPUTER_USE_REMOTE_MODEL_FILES_FIELD = 'cybopal_model_files'
export const COMPUTER_USE_INTERACTION_MODE_SETTING = 'interaction_mode'
export const COMPUTER_USE_PREFERRED_APPS_SETTING = 'preferred_apps'
export const CUA_FOREGROUND_DELIVERY_MODE = 'foreground'
export const COMPUTER_USE_CAPTURE_AFTER_PARAMETER = 'capture_after'

export const COMPUTER_USE_ACTION_NAMES = [
  'list_apps',
  'list_windows',
  'get_window_state',
  'verify_state',
  'get_desktop_state',
  'launch_app',
  'bring_to_front',
  'invoke_menu',
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'clipboard_read',
  'clipboard_write',
  'browser_prepare',
  'get_browser_state',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_pointer',
  'browser_dialog',
  'browser_set_input_files',
  'start_recording',
  'stop_recording'
] as const

export const COMPUTER_USE_ACTIONS = new Set<string>(
  COMPUTER_USE_ACTION_NAMES
)

export const COMPUTER_USE_REMOTE_SESSION_AWARE_ACTIONS = new Set<string>([
  'get_window_state',
  'verify_state',
  'get_desktop_state',
  'invoke_menu',
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'clipboard_read',
  'clipboard_write',
  'browser_prepare',
  'get_browser_state',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_pointer',
  'browser_dialog',
  'browser_set_input_files'
])

export const COMPUTER_USE_CAPTURE_ACTIONS = new Set([
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key',
  'hotkey'
])

export const COMPUTER_USE_COORDINATE_FIELDS: Record<
  string,
  readonly string[]
> = {
  click: ['x', 'y'],
  drag: ['from_x', 'from_y', 'to_x', 'to_y'],
  scroll: ['x', 'y'],
  type_text: ['x', 'y'],
  press_key: ['x', 'y'],
  hotkey: ['x', 'y']
}

export const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}
