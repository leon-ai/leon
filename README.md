<p align="center">
  <a href="https://getleon.ai"><img width="800" src="https://getleon.ai/img/hero-animation.gif" /></a>
</p>

<h1 align="center">
  <a href="https://getleon.ai"><img width="96" src="https://getleon.ai/img/logo.svg" alt="Leon"></a><br>
  Leon
</h1>

_<p align="center">Your open-source personal AI assistant.</p>_

<p align="center">
  <a href="https://discord.gg/MNQqqKg"><img src="https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white" /></a>
  <a href="https://github.com/leon-ai/leon/blob/develop/LICENSE.md"><img src="https://img.shields.io/badge/License-MIT-1c75db?style=for-the-badge" /></a>
</p>

<p align="center">
  I share Leon progress most regularly on <a href="https://x.com/grenlouis"><strong>X / @grenlouis</strong></a>
</p>

<p align="center">
  <a href="https://x.com/grenlouis">Follow progress on X / @grenlouis</a> ·
  <a href="https://getleon.ai">Website</a> ·
  <a href="https://leonai.substack.com/subscribe">Newsletter</a> ·
  <a href="http://roadmap.getleon.ai">Roadmap</a> ·
  <a href="https://blog.getleon.ai/the-story-behind-leon/">Story</a>
</p>

---

## ⚠️ Important Notice (as of 2026-03-29)

> [!IMPORTANT]
> Leon is currently focused on the **2.0 Developer Preview** on the `develop` branch.
>
> - The new documentation is **not ready yet**.
> - The current docs site and older guides mostly reflect the legacy architecture.
> - If you want the legacy, more stable pre-agentic version of Leon, use the `master` branch.
> - If you want to explore or contribute to Leon's new core, `develop` is the right place.

The most accurate high-level references for Leon's current state are:

- [`core/context/LEON.md`](./core/context/LEON.md)
- [`core/context/ARCHITECTURE.md`](./core/context/ARCHITECTURE.md)

## 👋 Introduction

**Leon** is **your open-source personal AI assistant** built around **tools, context, memory, and agentic execution**.

Leon is designed to stay practical, privacy-aware, and grounded in your real environment. It can operate locally, use dedicated tools instead of relying on free-form guessing, and complete tasks from start to finish across deterministic workflows and agent-style execution.

## 🧠 What Leon Is Today

Leon is no longer just a classic intent-classification assistant like it was for its first release in 2019.

Today, Leon is being built as a more capable assistant that can understand a goal, choose how to handle it, use tools, remember useful information, and recover when something goes wrong.

- Leon can run in different ways depending on the task: `smart` mode chooses for you, `controlled` mode follows deterministic native skills and actions, and `agent` mode can plan step by step.
- Leon supports native skills for controlled actions and agent skills for `SKILL.md`-backed workflows.
- Leon can use real tools to get work done instead of only replying with plain text.
- Leon can use context about your environment so answers stay grounded in what is actually happening on your machine and setup.
- Leon keeps layered memory so it can remember durable preferences, day-to-day context, and recent discussion context.
- Leon supports both local and remote AI providers, which helps balance privacy, control, and capability.
- Under the hood, Leon-native skills follow `Skills -> Actions -> Tools -> Functions (-> Binaries)`.

Leon also keeps a compact self-model and a bounded proactive pulse system so it can stay more consistent over time without flooding itself with unnecessary context.

## Why?

- **Privacy matters**: Leon can work with local models and local context instead of forcing everything through third-party services.
- **Grounded behavior matters**: Leon prefers explicit tools, context, and memory over vague model-only responses.
- **Extensibility matters**: skills, toolkits, bridges, and binaries make it possible to keep Leon modular.
- **Open source matters**: anyone can inspect the architecture, build on top of it, and help shape where it goes next.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 24.0.0
- Supported OSes: Linux, macOS, and Windows

Recommended: manage Node.js with [Volta](https://volta.sh/).

### Installation

```sh
# Clone the repository
git clone https://github.com/leon-ai/leon.git

# Go to the project root
cd leon

# Install pnpm
npm install --global pnpm@latest

# Install dependencies
pnpm install
```

### Run Leon

```sh
# Run Leon
pnpm start
```

### Check Your Setup

```sh
# Check the setup went well
pnpm run check
```

By default, Leon runs locally and the app is available on `http://localhost:5366`.

## 🏗️ Architecture Snapshot

At a high level, Leon currently consists of:

- `server/`: the main runtime, routing, memory, context management, HTTP API, and agent/controlled execution
- `app/`: the web application
- `aurora/`: UI components and preview environment
- `skills/`: built-in capabilities, split between `native/` skills and `agent/` skills
- `bridges/`: Node.js and Python bridges plus toolkit definitions and tool runtimes
- `tcp_server/`: Python services used by parts of the runtime stack
- `core/context/`: generated identity and architecture context documents that describe Leon's current behavior

This repository already includes skills and toolkits for areas such as search, productivity, system utilities, media workflows, coding assistance, memory-backed interactions, and voice/audio features.

## 📚 Documentation Status

The new docs for Leon 2.0 are not ready yet.

For now:

- treat this repository as the source of truth for the **2.0 Developer Preview**
- use [`core/context/LEON.md`](./core/context/LEON.md) for Leon's current identity and behavior
- use [`core/context/ARCHITECTURE.md`](./core/context/ARCHITECTURE.md) for the current architecture overview
- expect the public docs site to lag behind the new core until the updated documentation is published

## ❤️ Contributing

We are starting to progressively onboard contributors for the **2.0 Developer Preview**.

If you want to follow the project or express interest in joining that onboarding:

- [2.0 Developer Preview contributor form](https://forms.gle/6PCG2D5rYo1q8tKMA)
- [Roadmap](http://roadmap.getleon.ai)
- [Discord](https://discord.gg/MNQqqKg)
- [GitHub issues](https://github.com/leon-ai/leon/issues)

### Why is there a small amount of contributors?

Leon has been evolving for a long time, but the current 2.0 work is a major transition period.

For a long time, Leon was a smaller assistant project with a simpler architecture. Today, the core is being rebuilt into a much more capable system around tools, memory, context, and agent-style execution. That means a lot of things are still moving, and it makes contribution harder than it will be once the new docs and architecture settle down.

Another important reason is simply time: Leon is still developed largely during spare time. So progress can be uneven, and opening the project more broadly has to be balanced with keeping the direction coherent while the 2.0 Developer Preview is still taking shape.

## 📖 The Story Behind Leon

Leon started in 2017 and has been active since 2019. If you want the longer backstory, read [the story behind Leon](https://blog.getleon.ai/the-story-behind-leon/).

## 🔔 Stay Tuned

- [X / Twitter](https://x.com/grenlouis) is the main place where I share Leon progress updates
- [Newsletter](https://leonai.substack.com/subscribe)
- [Blog](https://blog.getleon.ai)
- [YouTube](https://www.youtube.com/channel/UCW6mk6j6nQUzFYY97r47emQ)

## 👨 Author

**Louis Grenard** ([@grenlouis](https://x.com/grenlouis))

## 👍 Sponsors

You can also contribute by [sponsoring Leon](http://sponsor.getleon.ai).

## Thanks

| ![OpenAI logo.](./.github/assets/thanks/openai-logo-light-mode.svg?v=2#gh-light-mode-only)![OpenAI logo.](./.github/assets/thanks/openai-logo-dark-mode.svg?v=2#gh-dark-mode-only) | ![JetBrains logo.](./.github/assets/thanks/jetbrains-mono-black.svg?v=2#gh-light-mode-only)![JetBrains logo.](./.github/assets/thanks/jetbrains-mono-white.svg?v=2#gh-dark-mode-only) | ![MacStadium logo.](./.github/assets/thanks/macstadium-logo-light-mode.svg?v=2#gh-light-mode-only)![MacStadium logo.](./.github/assets/thanks/macstadium-logo-dark-mode.svg?v=2#gh-dark-mode-only) |
| --- | --- | --- |
| [openai.com/form/codex-for-oss](https://openai.com/form/codex-for-oss/) | [jb.gg/OpenSource](https://jb.gg/OpenSource) | [macstadium.com/company/opensource](https://macstadium.com/company/opensource) |
