# OpenScreen recording

Local capture, editable cursor motion, appearance controls and MP4/GIF export using [OpenScreen](https://getopenscreen.com), an [MIT-licensed project](https://github.com/getopenscreen/openscreen). This is Leon's integration, not an upstream OpenScreen product. No AI provider or account is needed: Leon uses the app's recording and document APIs directly.

## Setup

Enable this tool in your profile. Its retained editing session runs through the app's `mcp` command without opening the editor. A graphical desktop is required on the device being recorded.

An explicit `executable_path`, standard macOS/Windows installations and PATH are checked first. Otherwise the SDK provisions the pinned, checksum-verified asset in `tool.json`: a full macOS ARM64/x64 application bundle or Linux x64 AppImage. Extraction preserves resources, modes and framework links, and publishes only a complete installation. macOS ZIP extraction requires system `unzip`; Linux AppImages need host AppImage/FUSE support. Windows and unsupported architectures require an existing installation. Provisioning never approves OS permissions or changes security policy.

Grant Screen Recording and, for physical click telemetry, Accessibility on macOS. Microphone and camera permissions are needed only when those inputs are requested. On Wayland, pass `systemPicker: true` and have the owner select a source in the desktop portal. Verify capture on each target OS rather than inferring runtime support from the declared download.

The app's user-data directory is inside the profile's tool directory, separated by conversation. Projects, raw media, cursor tracks and preferences do not share the owner's desktop-app state or another conversation's project list. At most four app sessions are retained. Idle sessions may close; saved project IDs remain usable in their conversation, while active captures and pointer registration cannot resume after worker loss.

## Appearance defaults

The profile's OpenScreen `settings.json` accepts an `editor` object:

```json
{
  "executable_path": "",
  "editor": {
    "wallpaper": "",
    "padding": 24,
    "borderRadius": 16,
    "shadowIntensity": 0.35,
    "backgroundBlur": 0,
    "motionBlurAmount": 0.2
  }
}
```

An empty `wallpaper` chooses automatically from the bundled wallpapers advertised by the running app. Set a CSS colour, gradient, bundled path, or embedded PNG/JPEG data URL for a specific background. Arbitrary file paths and web URLs are rejected by OpenScreen. `borderRadius` uses upstream pixels at 1080p. The app validates the supplied settings and their ranges.

Defaults apply once when a new project is recorded or imported. Exports preserve project edits. Use `info(projectId)` to read current `settings`, available wallpapers/formats and `settingsContext.inactive`, then `setEditorSettings(projectId, settings)` to change only selected fields. Other upstream settings, including cursor smoothing, motion, frames and camera layout, can also be placed in the profile's `editor` object.

## Recording and editing

1. `sources()` lists display indices, window titles and input-device labels. Select exactly one source. A window title must be unique because upstream selects by substring. On Wayland, source selection takes place in the portal.
2. `start(options)` waits for actual capture and returns a conversation-owned session ID and capture-start timestamp. Default duration is 120 seconds, maximum 3600. Microphone, system audio and camera stay off unless enabled. Optional device names require the corresponding input to be enabled.
3. Demonstrate the workflow with existing browser/computer tools, then `stop(sessionId)`. Duration expiry and worker shutdown also stop capture. `status(sessionId)` reports the saved result or failure.
4. Stop returns a conversation-owned `projectId`, source video path, actual `autoZooms` count and, for linked browser takes, an `optimization` report. `info(projectId)` reads its document, zooms and trims. `createProject(videoPath, title)` imports existing footage into an editable project.
5. `preview(projectId, atSeconds)` supplies composed frames at editor-ruler seconds, including the background, cursor, zooms and captions. Inspect the action moments before delivery.
6. `exportRecording(projectId, outputDirectory, options)` claims a new absolute directory with an existing parent and attaches a successful nonempty export. MP4 defaults to source resolution and 60 fps to preserve small UI text. Set `quality: "good"` for 1080p or `"medium"` for 720p when a smaller export is needed; these presets control resolution, and OpenScreen controls the encoder bitrate. For GIF, omit `quality` and `fps`; use `gifFps`, `gifSize` and `gifLoop`. The result reports actual zoom counts and warns when automatic focus has no regions. `autoZoom: false` preserves existing zooms; it does not remove them.

The source `videoPath` returned by stop is raw footage. Project backgrounds, editable cursors and zooms appear only after rendering. For further timeline editing, import the composed OpenScreen export into FilmCraft or another editor and preserve its dimensions unless resizing is requested.

Project IDs belong to their originating conversation. Capture handles cannot be inspected or stopped by another conversation. Failed or canceled exports remain incomplete and are never attached as finished videos. Cancellation closes the owned app process; saved projects survive, but its in-memory checkpoints and pointer-registration clock do not.

## Browser-generated cursor and zoom

For a browser demonstration, pass `browserTabId` with the exact browser `windowTitle`, or with `systemPicker: true` on Wayland. Tell the owner which browser window to select in the portal. If `stop(sessionId)` returns `browserWindowVerificationRequired`, use `preview(projectId, atSeconds)` to check that the full browser window and demonstrated controls are visible. Then call `stop(sessionId, true)` to link the browser events. If the take shows a different window or a whole display, record a new take of the intended window.

Browser Use journals the timestamp and normalized outer-window position of delivered clicks and scrolls. Positions use native browser window bounds and the reported page zoom. OpenScreen imports only the linked tab's events delivered during the take and plans smooth cursor motion and zooms through its own `setPointerTrack` API. Preview the composed take to verify that the cursor and zoom align with the demonstrated controls.

Keep the demonstration in the linked tab. A new tab requires its own take or an explicitly combined observed pointer track. External scripts can call `setPointerTrack(projectId, events)` with their observed epoch-millisecond timestamps and normalized recorded-window coordinates. The same retained OpenScreen session must have recorded the take. Never reconstruct missing clicks from assumed control positions or approximate model/tool-call timings.

Automatic zooms follow clicks, not a semantic reading of the screen. Closely grouped clicks can share a region; early clicks and the stopping click may remain wide. Scroll positions do not count as clicks. Always inspect the actual zoom regions and rendered frames.

## Automatic idle trimming

Linked browser takes are optimized at stop. Analysis reuses the FFmpeg and FFprobe tools' managed executables, provisioned through the SDK when needed. Leon removes the silent, still opening while retaining a lead-in before the first input or zoom entrance, and shortens longer silent, still spans throughout the take. Add this `trimming` object alongside `editor` in the profile's OpenScreen settings:

```json
{
  "trimming": {
    "enabled": true,
    "leadInSeconds": 0.75,
    "minimumIdleSeconds": 4,
    "keepIdleSeconds": 2,
    "noiseDb": -60,
    "analysisWidth": 640
  }
}
```

`minimumIdleSeconds` is the minimum still span eligible for shortening; `keepIdleSeconds` retains context split between its beginning and end. The opening uses `leadInSeconds` instead. `analysisWidth` and `noiseDb` control only the downscaled frame comparison. More negative noise thresholds are stricter. Audio must also be silent below -60 dB; audible speech and sound are retained.

Delivered input timestamps, the original cursor track, complete zoom/pan transitions and authored visual regions protect meaningful activity, including typing that a small analysis frame might miss. Input timing does not store typed text or key contents. Automatic trimming skips webcam takes, imported audio, multiple clips and speed-edited timelines. Missing evidence or failed analysis leaves the take available and reports why optimization could not run.

Duration expiry and worker shutdown save evidence for a later active call. If `status` reports `optimization.status: "pending"`, call `stop` again or `optimizeRecording(projectId)` before exporting. The latter also retries analysis after a failure; repeated runs do not duplicate existing cuts. Set `enabled: false` to preserve the full take automatically.

Cuts are native project edits with a checkpoint, not a separately encoded video. The original recording stays unchanged; the usual final export renders the cuts, background, cursor and zooms together. Trimming adds no extra encoding pass or resolution reduction. The final H.264 export still uses OpenScreen's normal compression. Preview and document times remain on the editor's original ruler; the exported playback skips trimmed spans.

## Speech and legacy files

`captions(projectId)` transcribes recorded speech on-device, then enables captions. First use downloads OpenScreen's Whisper model. Export afterwards to burn captions into the video. Silent recordings have no speech to transcribe.

`pack(projectPath, outputDirectory)` retains upstream's portable-folder command for legacy CLI `.openscreen` files, copying their video, webcam and cursor sidecar. Upstream does not pack the editor documents created by retained sessions, and does not collect imported audio. Keep a retained project's app data and referenced media together for future edits.
