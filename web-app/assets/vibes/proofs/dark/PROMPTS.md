# Dark-theme Vibes edge-blend proof prompt

The `autumn-clear-afternoon-v2-edge-blend.png` proof validates the same
image-authored boundary treatment against the dark theme. The original WebP is
preserved as `autumn-clear-afternoon-original.webp`.

```text
Precise pixel-art image edit for a web-app background asset.

Input Image 1 is the exact source and composition to preserve. Keep the canvas at exactly 1672 × 941 pixels. Preserve the camera, crop, scale, geometry, sunny autumn afternoon window view, lamp, plant, keyboard, cup, desk, and existing restrained pixel-art style.

Change only how the artwork meets the left and right canvas boundaries:
- The first and last 24 pixel columns must visually converge to pure black (#000000), opaque, with no transparency.
- From those exact black boundary columns, blend naturally over roughly the outer 10% of each side into the existing scene.
- The transition must be baked into the artwork through lighting, shadow, and increasingly subtle pixel-art texture. It must not look like a CSS gradient, black band, border, vignette, rectangular overlay, or blur.
- No vertical seam or perceptible rectangular edge may remain when the image is centered on a pure black page.
- Preserve the central 80% essentially unchanged and do not globally darken the scene.
- Keep crisp, lightly pixelated contours and avoid photorealistic smoothing.
- Output must be a fully opaque raster image with no text, UI, border, or frame added.
```
