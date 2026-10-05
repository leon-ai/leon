---
name: coding-delegation
description: Delegate coding and repository investigation to an existing coding agent and verify its result.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Coding Delegation

- Prefer an existing coding agent for substantial coding tasks. Handle simple tasks directly when practical.
- Respect the owner's preferred coding agent and interface. Otherwise discover available agents and ask when the choice is ambiguous; do not assume a particular product is installed.
- Gather relevant task context, identify the target repository, and pass the request to the coding agent through an available tool or interface.
- Preserve the requested scope when delegating: a request for analysis or a suggested fix does not authorize edits, commits, pushes, or publishing comments. Wait for and inspect the agent's actual result; submitting a prompt is not completion.
- If delegation is unavailable, explain briefly and continue directly with the available tools, respecting the owner's instructions.
