# Light-theme Vibes proof prompts

These proofs were generated with the built-in image generation tool. Each
existing dark scene was used as an edit target and strict composition reference.

## Production light collection

The five approved `winter/clear` pilot phases are the first-generation pilot
outputs. The other 219 `*.light.webp` assets use their previous light version
as the edit target and their matching dark scene only as a reference for natural
edge blending. The placeholders below are replaced from each scene path and
solar phase:

```text
Use case: lighting-weather
Asset type: Leon AI light-theme full-screen Vibe background
Input images: Image 1 is the edit target, the existing light-theme {season}/{weather}/{phase} scene. Image 2 is a supporting reference for composition and natural edge blending only; do not copy its dark palette.
Primary request: Edit Image 1 so its wall, desk, and peripheral room materials naturally converge to pure white at the canvas perimeter, matching a #FFFFFF web-app background without needing any CSS edge mask. Preserve the {season} {weather} {phase description}.
Style/medium: Preserve the existing polished, subtly pixel-art illustration style exactly; only a very slight pixel-art character, not coarse pixels.
Composition: Preserve the exact composition, perspective, object silhouettes, object positions, sizes, window geometry, and crop.
Composition/framing: Preserve the complete 1672:941 scene. Keep the lamp and plant on the left, keyboard centered at the bottom, mug on the right, and window/landscape on the right in precisely the same locations.
Lighting/mood: Keep strong local definition and believable time-of-day lighting around the focal objects and landscape. Create a broad, gentle, organic inverse-vignette: detail and color remain in the useful central scene, while the wall and desk themselves progressively become near-white and finally pure white at every outer boundary. The transition must be materially wide and imperceptible, analogous to how Image 2's dark wall and desk naturally settle into black at its perimeter.
Constraints: Change only the peripheral tonal composition needed for natural white-background blending. Keep the outdoor landscape vivid, legible, and appropriately colored; keep the lamp, plant, keyboard, mug, window frame, steam, shadows, highlights, and weather details. The outermost pixels on all four sides must visually match pure white. Opaque background, no transparency. No text, logos, watermark, borders, frames, or added objects.
Avoid: a uniform white wash over the whole image; faded or low-contrast focal objects; a visible circular/rectangular gradient; grey, beige, or blue bands reaching the canvas edge; blurred details; photorealism; composition drift.
```

Generated PNGs are converted to WebP with the `picture` preset, quality 92,
and compression level 6. Production assets are normalized to 1672 × 941 when
the image model returns an off-by-one canvas.

The `-v2.png` files were the initial approved-direction revisions. They were
generated from their corresponding first proof with this single targeted
refinement:

```text
Use case: style-transfer
Asset type: Leon AI Web 2.0 full-viewport light-theme background proof revision
Input image: Image 1 is the edit target.
Primary request: Make this image only very slightly more visibly pixel-art styled, matching the modestly coarser handcrafted pixel treatment of the dark-theme reference family.
Style/medium: Keep the existing retro pixel-art rendering, but increase the pixel character by a very small amount through subtly larger coherent pixel clusters, slightly crisper stepped edges, and marginally less fine-grained smoothing.
Constraints: This is a single targeted style refinement. Preserve the image's exact 1672:941 canvas, camera, crop, composition, perspective, object positions and silhouettes, window opening and frame geometry, outdoor view, season, weather, time of day, light-theme materials, colors, brightness, shadows, and mood. No text, no logos, no watermark, no new or removed objects.
Avoid: strong pixelation, blocky low-resolution appearance, mosaic effects, blur, sharpening halos, palette shifts, lighting changes, composition drift, altered window shape, photorealism.
```

The `-v3.png` files replace the integrated assets. Each v2 light scene was the
edit target, and its matching dark scene was used only as a reference for how
the artwork's boundary tones merge naturally into the theme background.

```text
Use case: precise-object-edit
Asset type: Leon AI Web 2.0 full-viewport light-theme background
Input images: Image 1 is the edit target. Image 2 is a supporting reference only for how the artwork's outer tones naturally merge with its theme background; do not copy its dark palette.
Primary request: Adjust only the light artwork's material values and tonal range so it naturally blends into a pure white web-app background the way the dark reference naturally blends into black. Make the light wall, pale desk, and all visible canvas-boundary tones substantially closer to clean neutral white or very pale warm white. The outer perimeter should naturally approach near-white as part of the illustrated lighting and materials, with no visible rectangular beige boundary when placed on #FFF.
Style/medium: Preserve the current subtly coarse handcrafted pixel-art treatment exactly.
Lighting/mood: Keep the existing season, weather, solar phase, and mood. Retain gentle depth and readable objects through restrained warm-gray shadows, but avoid an overall beige cast.
Constraints: Preserve the exact 1672:941 canvas, camera, crop, composition, perspective, every object's position and silhouette, window opening and frame geometry, outdoor view, weather, time of day, pixel density, and stepped edges. The blending must be contained in the opaque image pixels themselves; no transparency. No text, logos, watermark, new objects, or removed objects.
Avoid: visible gradient overlay, obvious vignette, border, frame around the whole canvas, washed-out central subjects, pure flat-white featureless rendering, dark palette, beige canvas edges, composition drift, altered window shape, photorealism.
```

The `autumn-rain-blue-hour-v4-edge-blend.png` proof explored a stronger,
image-authored boundary treatment. It is retained as iteration history, but it
is not integrated because the final production treatment uses a broader,
material-driven blend:

```text
Precise pixel-art image edit for a web-app background asset.

Input Image 1 is the exact source and composition to preserve. Keep the canvas at exactly 1672 × 941 pixels. Preserve the camera, crop, scale, geometry, window view, rainy blue-hour weather, lamp, plant, keyboard, cup, desk, and existing restrained pixel-art style.

Change only how the artwork meets the left and right canvas boundaries:
- The first and last 24 pixel columns must visually converge to pure white (#FFFFFF), opaque, with no transparency.
- From those exact white boundary columns, blend naturally over roughly the outer 10% of each side into the existing scene.
- The transition must be baked into the artwork through lighting, exposure, and increasingly subtle pixel-art texture. It must not look like a CSS gradient, fog band, border, vignette, rectangular overlay, or blur.
- No vertical seam or perceptible rectangular edge may remain when the image is centered on a pure white page.
- Preserve the central 80% essentially unchanged and do not globally wash out the scene.
- Keep crisp, lightly pixelated contours and avoid photorealistic smoothing.
- Output must be a fully opaque raster image with no text, UI, border, or frame added.
```

The `autumn-rain-blue-hour-v5-narrow-edge-blend.png` proof explored a narrower
version of the same treatment. It is also retained only as iteration history:

```text
Use case: precise-object-edit
Asset type: Leon AI Web 2.0 full-viewport light-theme pixel-art background validation asset
Input image: Image 1 is the edit target and must remain unchanged except at the extreme horizontal canvas edges.
Primary request: Replace the previous broad edge bloom with a much narrower, stronger image-authored blend into a pure white (#FFFFFF) web-app background.
Composition/framing: Keep the exact 1672 × 941 canvas, camera, crop, scale, perspective, and position of every object.
Style/medium: Preserve the restrained handcrafted pixel-art style, crisp stepped contours, pixel density, textures, palette, lighting, rain, and blue-hour window view.
Edge treatment:
- Modify only the outermost 64 pixels on the left and outermost 64 pixels on the right.
- The first and last 8 pixel columns should be clean opaque near-white matching #FFFFFF.
- Complete the entire transition from near-white to the original artwork within the following 40–56 pixels.
- Use a compact, stronger, naturally eased exposure transition. It must be visually seamless against white but must not extend beyond 64 pixels.
- Pixels from x=64 through x=1607 must visually match the input image. In particular, do not brighten, haze, fade, or bloom across the window, landscape, wall, lamp, desk, or other central content.
Constraints: Fully opaque raster; no transparency. Preserve all objects, silhouettes, window geometry, weather registration, colors, and lighting. No text, UI, logo, border, or new objects.
Avoid: broad white bloom, fog, haze, washed-out window, long gradient, vignette, blur, rectangular overlay, composition drift, photorealistic smoothing, changes beyond the outer 64 pixels.
```

## Summer / clear / noon

- Input: `public/img/vibes/scenes/fr/my-hometown/main-view/summer/clear/noon.webp`
- Output: `summer-clear-noon.png`

```text
Use case: precise-object-edit
Asset type: Leon AI Web 2.0 full-viewport light-theme background proof
Input image: Image 1 is the edit target and the strict composition/style reference.
Primary request: Re-author this exact dark workspace as a purpose-designed light-theme workspace for summer, clear weather, noon.
Scene/backdrop: Keep the same room and the exact same hometown mountain-and-town view outside the window under clear summer noon conditions.
Style/medium: Preserve the exact handcrafted retro pixel-art aesthetic, pixel density, edge treatment, texture scale, and production polish.
Composition/framing: Preserve the exact 1672:941 landscape framing, camera, perspective, crop, negative space, and positions/silhouettes of the desk, keyboard, lamp, plant, mug, wall, and window. The window opening and frame geometry must not move because a live weather layer is registered to it.
Lighting/mood: Bright, calm, airy daylight suitable behind a light UI. Use soft natural daylight with gentle warm-neutral shadows; retain depth without gloomy black areas.
Color palette: Warm off-white or light greige wall, pale natural oak desk, light neutral keyboard, warm ivory or light stone lamp and mug, natural terracotta pot, restrained green plant. Keep the outdoor colors seasonally accurate.
Materials/textures: Maintain tactile wood grain, painted metal, ceramic, leaves, and pixel-art surface detail.
Constraints: Change only the interior material palette and the physically corresponding light/shadows. Keep every object, outline, proportion, viewpoint, window geometry, outdoor landmark layout, and pixel-art style unchanged. No text, no logos, no watermark, no new or removed objects.
Avoid: white haze, washed-out opacity, photorealism, smooth vector rendering, flat sterile white, dark-theme black wall, composition drift, altered window shape.
```

## Autumn / rain / blue hour

- Input: `public/img/vibes/scenes/fr/my-hometown/main-view/autumn/rain/blue-hour.webp`
- Output: `autumn-rain-blue-hour.png`

```text
Use case: precise-object-edit
Asset type: Leon AI Web 2.0 full-viewport light-theme background proof
Input image: Image 1 is the edit target and the strict composition/style reference.
Primary request: Re-author this exact dark workspace as a purpose-designed light-theme workspace for autumn rain at blue hour.
Scene/backdrop: Keep the same room and exact hometown mountain-and-town view outside, with autumn foliage, rain, wet surfaces, and blue-hour sky exactly as represented.
Style/medium: Preserve the exact handcrafted retro pixel-art aesthetic, pixel density, edge treatment, texture scale, and production polish.
Composition/framing: Preserve the exact 1672:941 landscape framing, camera, perspective, crop, negative space, and positions/silhouettes of desk, keyboard, lamp, plant, mug, wall, and window. The window opening and frame geometry must not move because a live weather layer is registered to it.
Lighting/mood: A bright but cozy light-theme interior during rainy blue hour. Pale materials remain clearly visible; warm desk-lamp light gently balances the cool rainy window without turning the room dark.
Color palette: Warm off-white or light greige wall, pale natural oak desk, light neutral keyboard, warm ivory or light stone lamp and mug, natural terracotta pot, green plant; cool blue-gray and muted autumn colors outside.
Materials/textures: Maintain tactile wood grain, painted metal, ceramic, leaves, rain, and pixel-art surface detail.
Constraints: Change only the interior material palette and physically corresponding interior light/shadows. Keep every object, outline, proportion, viewpoint, window geometry, locality, weather, solar phase, and pixel-art style unchanged. No text, no logos, no watermark, no new or removed objects.
Avoid: white haze, washed-out opacity, photorealism, smooth vector rendering, flat sterile white, black wall, losing the rain or blue-hour mood, composition drift, altered window shape.
```

## Winter / snow / night

- Input: `public/img/vibes/scenes/fr/my-hometown/main-view/winter/snow/night.webp`
- Output: `winter-snow-night.png`

```text
Use case: precise-object-edit
Asset type: Leon AI Web 2.0 full-viewport light-theme background proof
Input image: Image 1 is the edit target and the strict composition/style reference.
Primary request: Re-author this exact dark workspace as a purpose-designed light-theme workspace for a snowy winter night.
Scene/backdrop: Keep the same room and exact hometown mountain-and-town view outside at winter night, including snow cover, snowfall, town lights, and night sky.
Style/medium: Preserve the exact handcrafted retro pixel-art aesthetic, pixel density, edge treatment, texture scale, and production polish.
Composition/framing: Preserve the exact 1672:941 landscape framing, camera, perspective, crop, negative space, and positions/silhouettes of desk, keyboard, lamp, plant, mug, wall, and window. The window opening and frame geometry must not move because a live weather layer is registered to it.
Lighting/mood: Cozy light-theme interior at night. Pale materials stay legible, with a warm desk-lamp pool and soft cool moon/window fill; atmospheric and nocturnal without collapsing into a black room.
Color palette: Warm light greige wall, pale natural oak desk, light neutral keyboard, warm ivory or light stone lamp and mug, terracotta pot, subdued green plant; cool navy-blue snowy outdoors with small warm town lights.
Materials/textures: Maintain tactile wood grain, painted metal, ceramic, leaves, snow, and pixel-art surface detail.
Constraints: Change only the interior material palette and physically corresponding interior light/shadows. Keep every object, outline, proportion, viewpoint, window geometry, locality, snow/night state, and pixel-art style unchanged. No text, no logos, no watermark, no new or removed objects.
Avoid: white haze, washed-out opacity, photorealism, smooth vector rendering, sterile all-white look, black wall, losing the night contrast, composition drift, altered window shape.
```
