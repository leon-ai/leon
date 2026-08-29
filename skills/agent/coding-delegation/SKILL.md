---
name: coding-delegation
description: Delegate coding and repository investigation to an existing coding agent and verify its result.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Coding Delegation

- Always delegate coding tasks, including repository investigation, debugging, implementation, refactoring, tests, and code review, to an existing coding agent. Do not perform the coding work yourself through reasoning, shell/file tools, or an editor.
- Respect the owner's preferred coding agent and interface. Otherwise discover available agents and ask when the choice is ambiguous; do not assume a particular product is installed.
- You may gather the issue and task context, identify the target repository, coordinate the handoff through an available tool or interface, and summarize the coding agent's findings. Gather context for delegation, not to conduct the repository investigation yourself.
- Preserve the requested scope when delegating: a request for analysis or a suggested fix does not authorize edits, commits, pushes, or publishing comments. Wait for and inspect the agent's actual result; submitting a prompt is not completion.
- If no coding agent is available or ready, explain the blocker and help the owner with setup or required permission. Never silently take over the coding task or invent a fix when delegation fails.
