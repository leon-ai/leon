---
theme: default
title: __TITLE__
layout: cover
colorSchema: dark
aspectRatio: 16/9
canvasWidth: 1280
transition: fade
fonts:
  provider: none
  sans: DejaVu Sans
  mono: DejaVu Sans Mono
monaco: false
twoslash: false
mdc: true
mcp: false
---

<div class="eyebrow"><lucide-presentation /> A story worth sharing</div>

# {{ $slidev.configs.title }}

Replace this introduction with the outcome your audience cares about.

<div class="signature">Prepared with Leon</div>

<!-- Introduce the audience, the problem and the desired outcome. -->

---
layout: section
---

<div class="eyebrow">01 / The opportunity</div>

# Start with the problem

One clear idea, supported by a concrete example.

---

<div class="eyebrow">How it works</div>

# Follow the evidence

<div class="cards">
  <div class="card"><lucide-search /><h3>Understand</h3><p>Ground the task in relevant evidence.</p></div>
  <div class="card"><lucide-workflow /><h3>Act</h3><p>Use the right tools to produce the result.</p></div>
  <div class="card"><lucide-circle-check /><h3>Verify</h3><p>Inspect the outcome before delivery.</p></div>
</div>

<div class="handoff" :class="{ 'is-active': $slidev.nav.currentSlideNo === 3 }" role="img" aria-label="Evidence moves from understanding through action to verification"><span class="handoff-packet"></span></div>

<!-- The moving packet represents the evidence handed between stages. All stages remain visible while explaining the flow. -->

---
layout: two-cols
---

<div class="eyebrow">Evidence and impact</div>

# Make it concrete

Explain a real example in a few short sentences. Use grounded data and clearly label illustrative values.

::right::

<div class="spotlight">
  <lucide-chart-no-axes-combined />
  <h2>Show the outcome</h2>
  <p>Replace this illustrative result with grounded evidence.</p>
  <pre v-pre><code>const result = {
  status: 'verified'
}</code></pre>
</div>

---
layout: section
---

<div class="eyebrow">Next steps</div>

# Leave one clear takeaway

Tell the audience what to remember or do next.
