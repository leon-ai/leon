<p align="center">
  <a href="https://getleon.ai"><img width="800" src="https://getleon.ai/img/hero-animation.gif" alt="Leon personal AI assistant" /></a>
</p>

<h1 align="center">
  <a href="https://getleon.ai"><img width="96" src="https://getleon.ai/img/logo.svg" alt="Leon"></a><br>
  Leon
</h1>

<p align="center"><em>Your open-source personal AI assistant.</em></p>

<p align="center">
  🇬🇧 <a href="./README.md">English</a> ·
  🇨🇳 <a href="./README.zh-CN.md">简体中文</a> ·
  🇫🇷 <a href="./README.fr.md">Français</a>
</p>

<p align="center">
  <a href="https://discord.gg/MNQqqKg"><img src="https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white" alt="Join Leon on Discord" /></a>
  <a href="https://github.com/leon-ai/leon/blob/develop/LICENSE.md"><img src="https://img.shields.io/badge/License-MIT-1c75db?style=for-the-badge" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://x.com/grenlouis">Follow progress on X / @grenlouis</a> ·
  <a href="https://getleon.ai">Website</a> ·
  <a href="https://leonai.substack.com/subscribe">Newsletter</a> ·
  <a href="http://roadmap.getleon.ai">Roadmap</a> ·
  <a href="https://blog.getleon.ai/the-story-behind-leon/">Story</a>
</p>

---

> [!IMPORTANT]
> We are working toward the first **Leon 2.0 alpha**, with a desktop application.
> It is not released yet. The `develop` branch is where this work happens, and
> things are still changing. The new documentation is not ready either; the
> public docs and older guides mostly describe the previous version.
>
> You can already try the **unfinished new web app** locally at
> [`http://localhost:5366/web-app/`](http://localhost:5366/web-app/) after setting
> up Leon. More on that [below](#try-the-preview).

## A few words before 2.0

Hi, I'm Louis 👋

I started working on Leon in 2017 and released the first open-source version in 2019. I've been building it ever since.

The idea is still the same. A personal AI assistant that gets to know you, remembers what matters to you, and helps you do things in your everyday life.

**Humans at the center.** I want Leon to feel warm, cozy, and made with care. A place where you can create and take things at your own pace. There is more about [our philosophy](#philosophy) below, but first, here's how to try it.

## Try the preview

If you are curious and comfortable running a project from source, you can explore the current work now.

The desktop application is planned for the first 2.0 alpha. Until then, you can get an early look through the new web app. **It is not ready yet**, but it will give you a feel for where Leon is going.

### Set up Leon

- macOS, Linux, or Windows
- [Node.js](https://nodejs.org/) >= 24

```sh
# Clone the repository
git clone https://github.com/leon-ai/leon.git

# Go to the project root
cd leon

# Install pnpm
npm install --global pnpm@latest

# Install dependencies
pnpm install

# Run Leon
pnpm start
```

- Follow the setup prompts during `pnpm install`.
- Open **[http://localhost:5366/web-app/](http://localhost:5366/web-app/)** for the new web app. The legacy interface is still at `/`.
- Run `pnpm run check` to check your setup.
- Use the [`master` branch](https://github.com/leon-ai/leon/tree/master) for the previous, pre-agentic version.

## A little look inside

There is already plenty you can do with Leon. Try it with something you actually need help with and get a feel for it yourself.

Aurora is Leon's component library, crafted to bring interactive charts, forms, and visual answers into your conversations.

Vibes brings a little of the world outside into the app, with ambient scenes that follow the season, time of day, and weather.

A few previews from the work in progress, using sample conversations and setup screens. Click a screenshot for a closer look.

| The new web app and Vibes | Task planning and execution |
| --- | --- |
| <a href="./.github/assets/previews/web-app-vibes-light.png#gh-light-mode-only"><img src="./.github/assets/previews/web-app-vibes-light.png#gh-light-mode-only" width="400" alt="Full Leon web app with a rainy evening Vibes scene"></a><a href="./.github/assets/previews/web-app-vibes-dark.png#gh-dark-mode-only"><img src="./.github/assets/previews/web-app-vibes-dark.png#gh-dark-mode-only" width="400" alt="Full Leon web app with a rainy evening Vibes scene"></a> | <a href="./.github/assets/previews/task-planning-light.png#gh-light-mode-only"><img src="./.github/assets/previews/task-planning-light.png#gh-light-mode-only" width="400" alt="Full Leon web app showing an execution plan and tool output"></a><a href="./.github/assets/previews/task-planning-dark.png#gh-dark-mode-only"><img src="./.github/assets/previews/task-planning-dark.png#gh-dark-mode-only" width="400" alt="Full Leon web app showing an execution plan and tool output"></a> |

| Generative UI with trend charts | Generative UI with a bar chart |
| --- | --- |
| <a href="./.github/assets/previews/generative-trends-light.png#gh-light-mode-only"><img src="./.github/assets/previews/generative-trends-light.png#gh-light-mode-only" width="400" alt="Full Leon web app showing monthly and regional sales trend charts"></a><a href="./.github/assets/previews/generative-trends-dark.png#gh-dark-mode-only"><img src="./.github/assets/previews/generative-trends-dark.png#gh-dark-mode-only" width="400" alt="Full Leon web app showing monthly and regional sales trend charts"></a> | <a href="./.github/assets/previews/generative-bars-light.png#gh-light-mode-only"><img src="./.github/assets/previews/generative-bars-light.png#gh-light-mode-only" width="400" alt="Full Leon web app showing an interactive quarterly sales bar chart"></a><a href="./.github/assets/previews/generative-bars-dark.png#gh-dark-mode-only"><img src="./.github/assets/previews/generative-bars-dark.png#gh-dark-mode-only" width="400" alt="Full Leon web app showing an interactive quarterly sales bar chart"></a> |

| Connecting your tools | A little help with coding |
| --- | --- |
| <a href="./.github/assets/previews/tool-connection-light.png#gh-light-mode-only"><img src="./.github/assets/previews/tool-connection-light.png#gh-light-mode-only" width="400" alt="Full Leon web app showing Spotify connection setup"></a><a href="./.github/assets/previews/tool-connection-dark.png#gh-dark-mode-only"><img src="./.github/assets/previews/tool-connection-dark.png#gh-dark-mode-only" width="400" alt="Full Leon web app showing Spotify connection setup"></a> | <a href="./.github/assets/previews/coding-light.png#gh-light-mode-only"><img src="./.github/assets/previews/coding-light.png#gh-light-mode-only" width="400" alt="Full Leon web app showing TypeScript code and its output"></a><a href="./.github/assets/previews/coding-dark.png#gh-dark-mode-only"><img src="./.github/assets/previews/coding-dark.png#gh-dark-mode-only" width="400" alt="Full Leon web app showing TypeScript code and its output"></a> |

## Built for personal AI

A good model matters. So does everything around it. Leon has its own continuous agent loop, tool execution in isolated workers, progressive context management, and multi-layer memory. Here are a few of the choices behind it.

- **Load what helps with the current task.** Context and tool guidance arrive progressively, down to the function Leon needs. Large tool outputs stay in artifacts, and older exchanges are compacted when needed to keep the working context focused.
- **Give tools a proper home.** Tools declare their functions, settings, dependencies, and binaries. Their setup and execution follow defined code paths, so Leon can reuse a prepared capability the next time it needs it.
- **Keep predictable workflows available.** Native skills follow explicit actions. Agent skills guide the agent loop through more flexible tasks. Both use the same tool system.
- **Remember selectively.** Leon keeps temporary context, persistent facts and preferences, daily summaries, and recent discussion memory, isolated per profile. It retrieves relevant records when needed and can check original conversations for exact details.
- **Act, observe, and recover.** The agent loop uses tool results to decide what to do next, checks outcomes, and can recover from failures. Independent tool calls can run concurrently in isolated workers.

### Understand the current project

While the new documentation is being written, these generated context files are useful starting points. Check the relevant source for the details.

- [`core/context/LEON.md`](./core/context/LEON.md) describes Leon's identity, behavior, and capabilities.
- [`core/context/ARCHITECTURE.md`](./core/context/ARCHITECTURE.md) explains how the runtime, memory, tools, skills, and clients fit together.

## Personal AI, measured in practice

We are building Leon to push the state of the art in personal AI. In our published comparisons, Leon leads the overall scores on selected WildClawBench and PinchBench tasks.

Explore the results across different dimensions, along with the methods and limitations, at **[benchmarks.getleon.ai](https://benchmarks.getleon.ai/)**.

## Philosophy

I love building personal AI. I've spent years on it, and I still have so many things I want to try. At the same time, I want us to enjoy the process. To understand what we build. To have a life outside our screens too.

There is already enough noise around AI. You should be able to open Leon, feel at home, and take things at your own pace. I want 2.0 to feel warm, cozy, and made with care.

- **Human craft still matters.** We use AI to help us build, learn, and improve the quality of our work. We also take the time to understand it, make decisions, and check the result. I want us to feel proud of what we put into Leon. Even with AI and coding agents helping us, I want us to keep having those little "yes, I did it!" moments.

- **Personal AI should belong to you.** An assistant that knows you well will hold things that matter to you. That's a responsibility. Leon is open source, can run on your own machine, and supports local and remote models. You choose the models and services you connect it to.

- **Open source is about people too.** Sharing code is part of it. So is helping someone get started, listening to feedback, explaining a decision, and learning from each other. That's the kind of project I want Leon to be.

- **We have time to do things with care.** I want Leon to help you make room for your own ideas, your creativity, and the people around you. The same goes for how we build it. A thoughtful improvement, a good conversation, a useful fix. These things count.

I wrote more about this in [Before Leon AI 2.0, I want to say this](https://blog.getleon.ai/before-leon-ai-2-0-i-want-to-say-this/).

## Let's build the next chapter together

If you have been following Leon for years, thank you for sticking around. If you just found the project, welcome. I'm glad you're here.

For a long time, I kept contributions limited because I was rewriting Leon and making frequent breaking changes. That's why the contributor count is still small. I wanted to get the foundations into a better place before asking people to invest their time.

**More than 100 people have already expressed interest in actively contributing to Leon AI.** That means a lot to me.

After the first 2.0 alpha release, we'll bring this community together and work on improving Leon. We'll share ideas, have community calls, build useful things, and help each other along the way. I want people to feel comfortable asking questions and sharing work they care about.

A place where you know the people behind the usernames. Where we respect each other's time and opinions. Where it's nice to hang out, even when we're just figuring things out.

You can already **[join our Discord](https://discord.gg/MNQqqKg)** to meet us and follow what's happening.

And if you would like to take part in building Leon, fill out the **[Leon AI contributor interest form](https://forms.gle/6PCG2D5rYo1q8tKMA)**. It helps me get to know you and organize the next steps while we prepare the alpha.

You can help with code, testing, documentation, design, translation, videos, or welcoming others. You don't need to be a developer to have something valuable to bring.

For now, the core and interface are still moving quite a bit. I'm organizing contributions with that in mind, so we can give people a useful place to start and respect the time they offer.

Really looking forward to seeing what we make together.

## 给中国朋友们的一点问候

大家好 👋 我是 Louis，一个住在深圳的法国人。很开心能通过 Leon 认识你们。欢迎来聊聊、分享想法，或者一起做点有意思的东西。希望这里也能让你们感到自在，就像和朋友在一起一样。

## Follow along

I share progress most regularly on **[X / @grenlouis](https://x.com/grenlouis)**. You can also follow along through the links below.

- [Newsletter](https://leonai.substack.com/subscribe)
- [Blog](https://blog.getleon.ai)
- [Roadmap](http://roadmap.getleon.ai)
- [GitHub issues](https://github.com/leon-ai/leon/issues)
- [YouTube](https://www.youtube.com/channel/UCW6mk6j6nQUzFYY97r47emQ)

For the longer backstory, read [the story behind Leon](https://blog.getleon.ai/the-story-behind-leon/).

## Author

**Louis Grenard** ([@grenlouis](https://x.com/grenlouis))

## Support Leon

If you'd like to support the time and care that go into this project, you can [sponsor Leon](http://sponsor.getleon.ai).

Leon is shared under the [MIT license](./LICENSE.md).

## Thanks

| ![OpenAI logo.](./.github/assets/thanks/openai-logo-light-mode.svg?v=2#gh-light-mode-only)![OpenAI logo.](./.github/assets/thanks/openai-logo-dark-mode.svg?v=2#gh-dark-mode-only) | ![JetBrains logo.](./.github/assets/thanks/jetbrains-mono-black.svg?v=2#gh-light-mode-only)![JetBrains logo.](./.github/assets/thanks/jetbrains-mono-white.svg?v=2#gh-dark-mode-only) | ![MacStadium logo.](./.github/assets/thanks/macstadium-logo-light-mode.svg?v=2#gh-light-mode-only)![MacStadium logo.](./.github/assets/thanks/macstadium-logo-dark-mode.svg?v=2#gh-dark-mode-only) |
| --- | --- | --- |
| [openai.com/form/codex-for-oss](https://openai.com/form/codex-for-oss/) | [jb.gg/OpenSource](https://jb.gg/OpenSource) | [macstadium.com/company/opensource](https://macstadium.com/company/opensource) |
