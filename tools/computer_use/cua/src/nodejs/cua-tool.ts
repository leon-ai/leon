import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { CuaRuntime } from './lib/cua-runtime'
import { CuaDesktopSetup } from './lib/cua/cua-desktop-setup'
import { createCuaDriverAdapter } from './lib/cua/cua-driver-adapter'

const GNOME_RESOURCE = 'gnome_wayland_0_25_0'

/**
 * Owns desktop setup, native sessions and Cua actions inside the standard tool runtime.
 */
export default class CuaTool extends Tool {
  public readonly runtimeLifetime = ToolRuntimeLifetime.Persistent
  public get toolName(): string { return 'cua' }
  public get toolkit(): string { return 'computer_use' }
  public get description(): string { return 'Observe and operate graphical desktop applications with Cua.' }

  private readonly desktopSetup = new CuaDesktopSetup(() => this.getResourcePath(GNOME_RESOURCE))
  private readonly runtime = new CuaRuntime((input) => createCuaDriverAdapter(input, this.desktopSetup))

  public constructor() {
    super()
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName)
  }

  /**
   * Preserve normal SDK calls and bridge-supplied additional named parameters.
   */
  private async invoke(action: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    const context = this.executionContext
    const result = await this.runtime.execute({
      toolkitId: this.toolkit, toolId: this.toolName, functionName: action,
      parameters: context?.functionName === action && Object.keys(context.parameters).length
        ? context.parameters : Object.fromEntries(Object.entries(parameters).filter(([, value]) => value != null)),
      profileName: context?.profileName ?? LEON_PROFILE_NAME,
      conversationSessionId: context?.conversationSessionId ?? process.env['LEON_SESSION_ID'] ?? null,
      ...(context?.signal ? { signal: context.signal } : {}),
      getSettings: () => {
        this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName, {}, true)
        return this.settings
      },
      onProgress: (progress) => this.log(progress.message)
    })
    this.attachModelFiles(result.modelFiles ?? [])
    return { ...result.output, success: result.success,
      ...(result.success ? {} : { error: result.message }) }
  }

  /**
   * Hide native overlays and release retained sessions on worker shutdown.
   */
  public async dispose(): Promise<void> { await this.runtime.dispose() }

  /**
   * Execute list apps through the retained Cua runtime.
   */
  public async list_apps(query?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('list_apps', { query })
  }

  /**
   * Execute list windows through the retained Cua runtime.
   */
  public async list_windows(on_screen_only?: unknown, pid?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('list_windows', { on_screen_only, pid })
  }

  /**
   * Execute health report through the retained Cua runtime.
   */
  public async health_report(include?: unknown, skip?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('health_report', { include, skip })
  }

  /**
   * Execute get window state through the retained Cua runtime.
   */
  public async get_window_state(include_screenshot?: unknown, max_depth?: unknown, max_elements?: unknown, pid?: unknown, query?: unknown, window_id?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('get_window_state', { include_screenshot, max_depth, max_elements, pid, query, window_id, settle_ms })
  }

  /**
   * Execute zoom through the retained Cua runtime.
   */
  public async zoom(pid?: unknown, window_id?: unknown, x1?: unknown, x2?: unknown, y1?: unknown, y2?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('zoom', { pid, window_id, x1, x2, y1, y2 })
  }

  /**
   * Execute verify state through the retained Cua runtime.
   */
  public async verify_state(expect?: unknown, include_screenshot?: unknown, pid?: unknown, stable_samples?: unknown, timeout_ms?: unknown, window_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('verify_state', { expect, include_screenshot, pid, stable_samples, timeout_ms, window_id })
  }

  /**
   * Execute get desktop state through the retained Cua runtime.
   */
  public async get_desktop_state(settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('get_desktop_state', { settle_ms })
  }

  /**
   * Execute move cursor through the retained Cua runtime.
   */
  public async move_cursor(target?: unknown, x?: unknown, y?: unknown, capture_after?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('move_cursor', { target, x, y, capture_after, settle_ms })
  }

  /**
   * Execute launch app through the retained Cua runtime.
   */
  public async launch_app(additional_arguments?: unknown, bundle_id?: unknown, launch_path?: unknown, name?: unknown, urls?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('launch_app', { additional_arguments, bundle_id, launch_path, name, urls })
  }

  /**
   * Execute bring to front through the retained Cua runtime.
   */
  public async bring_to_front(pid?: unknown, window_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('bring_to_front', { pid, window_id })
  }

  /**
   * Execute invoke menu through the retained Cua runtime.
   */
  public async invoke_menu(path?: unknown, pid?: unknown, window_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('invoke_menu', { path, pid, window_id })
  }

  /**
   * Execute click through the retained Cua runtime.
   */
  public async click(capture_after?: unknown, button?: unknown, count?: unknown, cursor_id?: unknown, delivery_mode?: unknown, element_index?: unknown, element_token?: unknown, modifier?: unknown, pid?: unknown, scope?: unknown, snapshot_id?: unknown, target?: unknown, window_id?: unknown, x?: unknown, y?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('click', { capture_after, button, count, cursor_id, delivery_mode, element_index, element_token, modifier, pid, scope, snapshot_id, target, window_id, x, y, settle_ms })
  }

  /**
   * Execute drag through the retained Cua runtime.
   */
  public async drag(capture_after?: unknown, button?: unknown, cursor_id?: unknown, delivery_mode?: unknown, duration_ms?: unknown, from_x?: unknown, from_y?: unknown, modifier?: unknown, pid?: unknown, scope?: unknown, steps?: unknown, target?: unknown, to_x?: unknown, to_y?: unknown, window_id?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('drag', { capture_after, button, cursor_id, delivery_mode, duration_ms, from_x, from_y, modifier, pid, scope, steps, target, to_x, to_y, window_id, settle_ms })
  }

  /**
   * Execute scroll through the retained Cua runtime.
   */
  public async scroll(capture_after?: unknown, amount?: unknown, by?: unknown, cursor_id?: unknown, delivery_mode?: unknown, direction?: unknown, element_index?: unknown, element_token?: unknown, pid?: unknown, scope?: unknown, snapshot_id?: unknown, target?: unknown, window_id?: unknown, x?: unknown, y?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('scroll', { capture_after, amount, by, cursor_id, delivery_mode, direction, element_index, element_token, pid, scope, snapshot_id, target, window_id, x, y, settle_ms })
  }

  /**
   * Execute type text through the retained Cua runtime.
   */
  public async type_text(capture_after?: unknown, delivery_mode?: unknown, element_index?: unknown, element_token?: unknown, pid?: unknown, scope?: unknown, snapshot_id?: unknown, target?: unknown, text?: unknown, window_id?: unknown, x?: unknown, y?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('type_text', { capture_after, delivery_mode, element_index, element_token, pid, scope, snapshot_id, target, text, window_id, x, y, settle_ms })
  }

  /**
   * Execute press key through the retained Cua runtime.
   */
  public async press_key(capture_after?: unknown, delivery_mode?: unknown, element_index?: unknown, element_token?: unknown, key?: unknown, modifiers?: unknown, pid?: unknown, scope?: unknown, snapshot_id?: unknown, target?: unknown, window_id?: unknown, x?: unknown, y?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('press_key', { capture_after, delivery_mode, element_index, element_token, key, modifiers, pid, scope, snapshot_id, target, window_id, x, y, settle_ms })
  }

  /**
   * Execute hotkey through the retained Cua runtime.
   */
  public async hotkey(capture_after?: unknown, delivery_mode?: unknown, element_index?: unknown, element_token?: unknown, keys?: unknown, pid?: unknown, scope?: unknown, snapshot_id?: unknown, target?: unknown, window_id?: unknown, x?: unknown, y?: unknown, settle_ms?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('hotkey', { capture_after, delivery_mode, element_index, element_token, keys, pid, scope, snapshot_id, target, window_id, x, y, settle_ms })
  }

  /**
   * Execute perform actions through the retained Cua runtime.
   */
  public async perform_actions(capture_after?: unknown, steps?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('perform_actions', { capture_after, steps })
  }

  /**
   * Execute set value through the retained Cua runtime.
   */
  public async set_value(element_index?: unknown, element_token?: unknown, pid?: unknown, snapshot_id?: unknown, value?: unknown, window_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('set_value', { element_index, element_token, pid, snapshot_id, value, window_id })
  }

  /**
   * Execute clipboard read through the retained Cua runtime.
   */
  public async clipboard_read(include_text?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('clipboard_read', { include_text })
  }

  /**
   * Execute clipboard write through the retained Cua runtime.
   */
  public async clipboard_write(file_path?: unknown, image_path?: unknown, text?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('clipboard_write', { file_path, image_path, text })
  }

  /**
   * Execute browser prepare through the retained Cua runtime.
   */
  public async browser_prepare(allow_launch?: unknown, pid?: unknown, profile?: unknown, strategy?: unknown, window_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_prepare', { allow_launch, pid, profile, strategy, window_id })
  }

  /**
   * Execute get browser state through the retained Cua runtime.
   */
  public async get_browser_state(continuation?: unknown, include_screenshot?: unknown, pid?: unknown, query?: unknown, scope_ref?: unknown, snapshot_format?: unknown, tab_id?: unknown, target_id?: unknown, window_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('get_browser_state', { continuation, include_screenshot, pid, query, scope_ref, snapshot_format, tab_id, target_id, window_id })
  }

  /**
   * Execute browser navigate through the retained Cua runtime.
   */
  public async browser_navigate(tab_id?: unknown, target_id?: unknown, url?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_navigate', { tab_id, target_id, url })
  }

  /**
   * Execute browser click through the retained Cua runtime.
   */
  public async browser_click(input_route?: unknown, ref?: unknown, tab_id?: unknown, target_id?: unknown, x?: unknown, y?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_click', { input_route, ref, tab_id, target_id, x, y })
  }

  /**
   * Execute browser type through the retained Cua runtime.
   */
  public async browser_type(mode?: unknown, ref?: unknown, replace?: unknown, tab_id?: unknown, target_id?: unknown, text?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_type', { mode, ref, replace, tab_id, target_id, text })
  }

  /**
   * Execute browser pointer through the retained Cua runtime.
   */
  public async browser_pointer(action?: unknown, delta_x?: unknown, delta_y?: unknown, destination_ref?: unknown, input_route?: unknown, ref?: unknown, tab_id?: unknown, target_id?: unknown, to_x?: unknown, to_y?: unknown, x?: unknown, y?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_pointer', { action, delta_x, delta_y, destination_ref, input_route, ref, tab_id, target_id, to_x, to_y, x, y })
  }

  /**
   * Execute browser dialog through the retained Cua runtime.
   */
  public async browser_dialog(action?: unknown, delivery_mode?: unknown, dialog_id?: unknown, prompt_text?: unknown, tab_id?: unknown, target_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_dialog', { action, delivery_mode, dialog_id, prompt_text, tab_id, target_id })
  }

  /**
   * Execute browser set input files through the retained Cua runtime.
   */
  public async browser_set_input_files(files?: unknown, ref?: unknown, tab_id?: unknown, target_id?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('browser_set_input_files', { files, ref, tab_id, target_id })
  }

  /**
   * Execute start recording through the retained Cua runtime.
   */
  public async start_recording(record_video?: unknown): Promise<Record<string, unknown>> {
    return this.invoke('start_recording', { record_video })
  }

  /**
   * Execute stop recording through the retained Cua runtime.
   */
  public async stop_recording(): Promise<Record<string, unknown>> {
    return this.invoke('stop_recording', {  })
  }

}
