---
name: live-tutorial
description: Create an annotated MP4 tutorial from a workflow demonstrated in the owner's actual application. Use when asked for a tutorial video, not merely to watch an action live.
compatibility: Leon runtime with managed Node.js, bundled ffmpeg-static, and an active profile and session.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.2.5"
---

# Live Tutorial

Demonstrate the requested workflow, then return a verified MP4 made from its real screenshots.

Use PNG paths returned in each observation's `artifacts` array. The recording `output_dir` is the destination for the video, not the location of those screenshots; do not search it for frames. The renderer is ready to run with the manifest below: no source inspection, image-processing code, or dependency setup is needed.

Do not read tool-output logs, screenshot sidecars, or artifact directories: the live tool results already provide the recording directory, screenshot paths, and current target tokens. Each new window observation invalidates earlier tokens, so make one observation with any needed query and screenshot, then act immediately from that same result. Use the shell tool only for the final renderer command.

1. Select the target application and one clear route. If its current view already shows the result, navigate to a neutral view before recording. Do not inspect or switch to a pre-existing result tab or window.
2. Start `computer_use.cua.start_recording` with `record_video: false`; retain `output_dir`.
3. Demonstrate the route using the shortest deterministic, accessibility-backed actions; use `computer_use.cua.invoke_menu` for native application menus, never shell automation. Capture each meaningful action's target BEFORE acting, then verify that action with the next observation. Do not skip intermediate screens, substitute a shortcut for a click shown in the video, or describe an action that was not performed.
4. Always stop recording. Select 2–6 distinct captures from the successful route, normally one per action plus the result; omit setup, failed attempts, retries, and polling. The final result must have been caused by the preceding tutorial actions. Use a short instruction for each action and a confirmation caption for the result.
5. Write the manifest below with the file tool, then run the bundled renderer through the shell tool. Do not inspect or rewrite the renderer unless it reports an error.
6. Check the renderer's `resolvedTargets` against the intended controls and the source observations. Correct any mismatch before returning `fileMarker` verbatim. The returned `previewPaths` identify the rendered step frames. If unfinished, explain the obstacle.

## Render

```bash
"$NODE" "$LEON_CODEBASE_PATH/skills/agent/live-tutorial/scripts/render-tutorial.mjs" --manifest "/exact/path/to/tutorial.json"
```

Leon supplies `NODE` and `LEON_CODEBASE_PATH`. Do not set a working directory or construct executable paths. No system Node, Python, or FFmpeg installation is needed.

On PowerShell, use `& $env:NODE "$env:LEON_CODEBASE_PATH/skills/agent/live-tutorial/scripts/render-tutorial.mjs" --manifest "/exact/path/to/tutorial.json"`.

Manifest:

```json
{
  "outputDir": "<output_dir from start_recording>",
  "steps": [
    {"screenshotPath": "<pre-action PNG path>", "targetToken": "<element_token from this exact capture>", "instruction": "Open the relevant setting."},
    {"screenshotPath": "<result PNG path>", "instruction": "Read the displayed value."}
  ]
}
```

Use exact current-session paths and captions of at most 240 characters. Prefer `targetToken`: the renderer reads capture-bound geometry from the PNG's companion JSON and draws the control outline, arrow, and step number automatically.

Use `point: {x, y, coordinateWidth, coordinateHeight}` only when the capture has no accessible target geometry, such as a desktop or native popup observation. Copy the exact x/y and coordinate dimensions from the successful action performed on that capture; do not estimate a new annotation point. Never copy a point from another capture or mix window and desktop coordinates. The final result frame must have no point annotation; omit its marker or use a verified `targetToken` when highlighting a result is genuinely useful.

A tutorial request authorizes demonstrating navigation, not choosing an unspecified setting value or completing a destructive, financial, publishing, or security-sensitive action. Stop before committing such changes unless the owner explicitly authorized them.
