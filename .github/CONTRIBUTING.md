# Contributing

Thank you for wanting to help with Leon ❤️

There are people behind this project, and I want contributing to feel welcoming. You can bring code, ideas, feedback, design, documentation, or simply help someone get started. You don't need to know the whole project to have something useful to share.

We are preparing the first 2.0 alpha and its desktop application. The core and interface are still changing, and the public documentation mostly describes the previous version. Broader community onboarding will follow the alpha, but you can already [join Discord](https://discord.gg/MNQqqKg) and fill out the [Leon AI contributor interest form](https://forms.gle/6PCG2D5rYo1q8tKMA).

You can report bugs and suggest ideas directly through [GitHub issues](https://github.com/leon-ai/leon/issues). The interest form helps me organize contributors and find useful starting points.

Please follow our [code of conduct](./CODE_OF_CONDUCT.md) and respect each other's time and opinions.

## Before you start

- Check existing issues and pull requests so we can coordinate our work.
- Discuss substantial features, refactors, and architecture changes in an issue before implementing them. Agreeing on the direction first helps everyone spend their time well.
- Use Discord for questions and conversation. Keep the agreed scope, decisions, and progress in the related GitHub issue.
- Start with a small, focused contribution. A useful fix or a clear explanation can make a real difference.

AI and coding agents are welcome. Take the time to understand their output, review it, and verify that it works. You should be able to explain the decisions in your contribution and feel proud of what you submit.

## Where you can help

| Area | Starting point |
| --- | --- |
| Core, agent loop, context, and memory | [`server/src/`](../server/src/) |
| New web app | [`apps/web/`](../apps/web/) and its [contributor instructions](../apps/web/AGENTS.md) |
| Aurora components and visual answers | [`aurora/`](../aurora/) and the local previews below |
| Tools and integrations | [`tools/`](../tools/) |
| Native skills and agent skills | [`skills/native/`](../skills/native/) and [`skills/agent/`](../skills/agent/) |
| Bridge SDKs and shared runtime contracts | [`bridges/`](../bridges/) |
| Testing and reproducible bug reports | [`test/`](../test/) and [GitHub issues](https://github.com/leon-ai/leon/issues) |
| Documentation, translation, design, and showcases | Bring an idea to Discord or an issue so we can find the right place for it |

Read the relevant source and look for existing helpers, components, and utilities before adding new ones. Tools own application-specific behavior, skills guide workflows, and Core owns generic execution and orchestration.

The [repository instructions](../AGENTS.md) cover architecture, style, dependencies, and testing in more detail. The generated [Leon overview](../core/context/LEON.md) and [architecture overview](../core/context/ARCHITECTURE.md) can help you find your way around; check the source for the details.

## Development setup

- macOS, Linux, or Windows
- [Node.js](https://nodejs.org/) 24 or newer
- Git and [pnpm](https://pnpm.io/installation), using the version declared in [`package.json`](../package.json)

Fork the repository, then clone your fork's `develop` branch. Replace `YOUR_USERNAME` with your GitHub username.

```sh
git clone --branch develop https://github.com/YOUR_USERNAME/leon.git
cd leon
pnpm install
pnpm run check
git switch -c my-change
```

Follow the installation prompts. Setup prepares Leon's managed runtimes, dependencies, and applications.

Run the development server in one terminal.

```sh
pnpm dev:server
```

For live changes to the new web app, open a second terminal in the same checkout.

```sh
pnpm dev:web-app
```

- The web app development server is available at `http://localhost:5173` by default and proxies API requests to Leon.
- The built web app is served by Leon at `http://localhost:5366/web-app/` with the default server configuration.
- `pnpm dev:app` runs the legacy interface. Use it when working on that interface.
- Use a separate profile for development when you want to keep its settings, conversations, and memory apart from your everyday setup. Set `LEON_PROFILE` consistently for setup and the processes you run.

### Aurora previews

```sh
pnpm dev:aurora
```

Open `http://localhost:5174/aurora.html` by default to explore the components, widgets, feed, and generated UI examples with local sample data.

### Python development

The Python bridge and TCP speech services run from source using Leon's managed Python runtime. Installation prepares their environments with uv from the `pyproject.toml` files under [`bridges/python/src/`](../bridges/python/src/pyproject.toml) and [`tcp_server/src/`](../tcp_server/src/pyproject.toml).

Use `pnpm python-bridge` for the sample bridge invocation, or `pnpm start:tcp-server` to run the TCP server directly when working on those parts. After changing dependency manifests, rerun `pnpm install` to synchronize the environments.

Keep dependencies in the package that owns them. Use pnpm for JavaScript dependencies and the managed uv setup for Python. Preserve the repository's 36-hour dependency cooldown and pinned versions.

## Checks before a pull request

Always run lint and fix every warning or error. It also runs the TypeScript checks.

```sh
pnpm lint
```

The rules live in [`eslint.config.mjs`](../eslint.config.mjs). Run the existing checks relevant to your change.

| Change | Check |
| --- | --- |
| Core behavior and fast feedback | `pnpm test:unit` |
| Real workers, downloads, capture, and rendering | `pnpm test:integration` |
| Web app behavior | `pnpm test:web-app:e2e` |
| Aurora components and rendering | `pnpm test:aurora:e2e` |
| Controlled skills and actions | `pnpm test:controlled:e2e` |
| Agent behavior in real scenarios | `pnpm test:agent:scenario -- <selection>` |

- `pnpm test` runs unit, integration, and controlled e2e suites.
- Use `pnpm test:agent:scenario -- --list` to find scenario selections. Scenarios use the latest-used profile's active model; `LEON_PROFILE` selects a specific profile.
- Agent provider e2e checks must use `pnpm test:agent:e2e -- -t openai` unless other providers have been explicitly agreed with the maintainer.
- Real agent scenarios and provider e2e checks can make model calls. Use a dedicated profile and understand its configured provider before running them.
- Add meaningful coverage for observable behavior where there is a real gap. New Core mechanisms need real scenarios. Coordinate with the maintainer before adding tests for SDKs, tools, or skills, and run their affected existing tests.
- For bridge boundary changes, also verify the built import graph and isolated Core startup without bridge-only dependencies. Follow the [repository instructions](../AGENTS.md) for these checks.

## Send your pull request

- Target **`develop`**. The `master` branch contains the previous release.
- Link the issue or discussion and keep the change focused on the agreed scope.
- Explain the problem, what users will experience, and how you verified it. Mention anything you could not check.
- Include screenshots or a short recording for visible interface changes.
- Follow the existing architecture and coding style, preserve unrelated work, and keep profile data isolated.
- Keep generated context documents maintained through their generators rather than editing the generated copies.

Small contributions are welcome too. If this is your first pull request, tell us where you need a hand. We'll figure it out together.

## Commits

The commit message guideline is adapted from the [AngularJS Git Commit Guidelines](https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#-git-commit-guidelines).

Use `type(scope): description`, or `type: description` when no single scope fits. The description must be between 1 and 50 characters. An optional body follows the subject on separate lines. The commit hook validates the subject with [`scripts/commit-msg.js`](../scripts/commit-msg.js).

### Types

Types define which kind of changes you made to the project.

| Types    | Description                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------- |
| BREAKING | Changes including breaking changes.                                                                      |
| build    | New build version.                                                                                       |
| chore    | Changes to the build process or auxiliary tools such as changelog generation. No production code change. |
| ci       | Changes related to continuous integration only (GitHub Actions, CircleCI, etc.).                         |
| docs     | Documentation only changes.                                                                              |
| feat     | A new feature.                                                                                           |
| fix      | A bug fix.                                                                                               |
| perf     | A code change that improves performance.                                                                 |
| refactor | A code change that neither fixes a bug nor adds a feature.                                               |
| style    | Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc.). |
| test     | Adding missing or correcting existing tests.                                                             |

### Scopes

Scopes identify the subsystem that owns the behavior, not the directory containing the code. Choose the primary subsystem rather than listing every touched area. Omit the scope for genuinely cross-cutting changes; do not use catch-all scopes such as `server` or `core`.

Use the scope names listed below, including spaces in multiword names such as `messaging app` and `built-in command`. Application scopes use `app/<platform>`; currently only `app/web` is supported. Namespaced tool and skill suffixes retain the component's actual identifier, including hyphens and underscores.

| Scope | Responsibility |
| ----- | -------------- |
| agent | Agent loop, planning, completion and compaction. |
| context | Prompt assembly, context files and persona guidance. |
| memory | Memory storage, retrieval and consolidation. |
| sessions | Conversation persistence and lifecycle. |
| llm | Shared inference, routing, caching and usage accounting. |
| tools | Shared tool discovery, execution, retention and cancellation. |
| runtime | Startup, profiles and managed runtimes. |
| satellite | Remote-device connections and execution. |
| api | HTTP and Socket.IO interfaces. |
| voice | Speech input/output orchestration. |
| controlled | Deterministic skill/action execution. |
| app/web | Web client. |
| scripts | Repository automation, setup and release scripts. |
| aurora | Shared UI components. |
| messaging app | Messaging clients and integrations. |
| built-in command | Built-in commands. |
| hotword | Wake-word detection. |
| python tcp server | Python TCP service. |

Use these namespaces for changes confined to one component.

- `bridge/python` or `bridge/nodejs` covers the corresponding bridge and SDK.
- `tool/<name>` covers one tool, such as `tool/browser-use` or `tool/tool_executions`.
- `skill/<name>` covers one native or agent skill, such as `skill/timer_skill` or `skill/coding`.
- `provider/<name>` covers one provider integration. Accepted names are `llamacpp`, `sglang`, `openrouter`, `zai`, `deepseek`, `minimax`, `openai`, `anthropic`, `moonshotai`, `huggingface`, `cerebras`, `groq` and `celeris`.

Use `tools` for shared tool infrastructure and `tool/<name>` for an individual tool. Likewise, use `llm` for shared model infrastructure and `provider/<name>` for a provider-specific change.

### Examples

```sh
git commit -m "fix(context): narrow persona disclosure guidance"
git commit -m "fix(runtime): isolate profile startup state"
git commit -m "feat(tools): retain large execution results"
git commit -m "fix(provider/openai): preserve cache identity"
git commit -m "docs(skill/coding): clarify verification steps"
git commit -m "style(app/web): simplify chat layout"
git commit -m "refactor: share dependency-free runtime contracts"
```

## Support the project

You can also help by sharing what you build, writing a guide, helping someone on Discord, or [sponsoring Leon](http://sponsor.getleon.ai).

Thank you for giving this project some of your time. I'm looking forward to building together.
