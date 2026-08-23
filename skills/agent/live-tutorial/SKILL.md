---
name: live-tutorial
description: Create an annotated MP4 tutorial from real screenshots of a workflow on the owner's computer. Use only when the owner explicitly asks for a tutorial video, not merely when they ask to watch an action happen live.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.3"
---

# Live Tutorial

Create a short annotated MP4 from a workflow Leon actually completes in the owner's application and workspace. It is an instructional slideshow, not a continuous screen recording or a reconstruction of steps Leon did not perform.

## Outcome

Return one playable MP4 with 3–6 meaningful steps. Each step should show:

- the interface before the action;
- a numbered, concise instruction;
- a rectangle around the target and an arrow pointing to it;
- enough surrounding context to recognize the location.

Keep the original captures with the tutorial artifacts. Add annotations with deterministic local rendering; never recreate the interface with a generative image model.

Every frame must be evidence from the demonstrated journey. Do not reuse one screenshot to illustrate different states, invent missing steps, or claim success when the requested result was not reached.

## Workflow

1. Identify the target application, task, and successful result. Ask only if one is genuinely ambiguous.
2. Call `computer_use.cua.start_recording` with `record_video: false` and retain its `output_dir`.
3. Complete the real task as a sequence of consequential owner-facing actions. Retain the initial observation, then after each selected action observe once to verify its result and ground the next action. That post-action observation becomes the next step's pre-action capture; do not capture the same state twice.
4. Retry or stop when an action cannot be visually verified. Do not turn an unchanged capture, an unperformed instruction, or a guessed future state into a tutorial step.
5. Once the requested result is visible, stop interacting and render immediately. Always call `stop_recording`, including after a failure. Completing the original tutorial request includes assembling the MP4; do not ask for separate confirmation to finish it.
6. Annotate each successful action's own pre-action screenshot and assemble the frames into an MP4 inside the retained `output_dir`. Reuse that exact path rather than reconstructing it from profile or session identifiers. If a render continues in a later turn, use only artifacts from the current `LEON_PROFILE` and `LEON_SESSION_ID`; never scan other profiles or substitute a pre-existing video.
7. Make the encoded frame dimensions even by padding at most one pixel on each axis. For FFmpeg, use `pad=ceil(iw/2)*2:ceil(ih/2)*2`; do not resize the tutorial or alter annotation coordinates for encoder compatibility.
8. Verify that the MP4 is non-empty and readable before reporting success. Return the MP4 only if the requested workflow was completed; otherwise explain where the demonstration stopped and preserve the verified captures.

Do not create frames for discovery, focus changes, polling, retries, recording setup, or verification. Do not create a contact sheet or open intermediate images unless visual review is genuinely necessary.

## Coordinate Accuracy

Cua action coordinates use the preceding observation's declared `coordinate_space`. When it is `attached_model_image`, the action space is `screenshot_width` × `screenshot_height`, while the saved PNG normally uses `source_screenshot_width` × `source_screenshot_height`. Never confuse these fields or guess a DPI multiplier.

For the exact pre-action screenshot being annotated:

1. Map the action point into the raw recording image:
   - `raw_x = round(action_x * (raw_width - 1) / (action_space_width - 1))`
   - `raw_y = round(action_y * (raw_height - 1) / (action_space_height - 1))`
2. If the screenshot is resized or placed beside an instruction panel, map it once more:
   - `output_x = image_left + raw_x * displayed_width / raw_width`
   - `output_y = image_top + raw_y * displayed_height / raw_height`

Read the raw dimensions from that exact saved image. Use the observation's `screenshot_width` and `screenshot_height` as the action-space dimensions when its coordinates are attached to the model image. The instruction panel changes only `image_left`, `image_top`, and the displayed size; it does not justify another coordinate multiplier. If the exact dimensions are unavailable, omit the marker instead of drawing a misleading one.

The arrow endpoint must be the mapped action point. Draw a rectangle only from the target's visible or accessibility bounds, and ensure the mapped point lies inside it. If reliable bounds are unavailable, use a small marker centered on the mapped point instead of inventing a rectangle elsewhere.

## Safety

Do not demonstrate destructive, financial, publishing, account-security, or irreversible actions without explicit approval. Never bypass CAPTCHA, reauthentication, security challenges, rate limits, or browser safeguards. If an action cannot be grounded reliably, stop and ask instead of guessing.
