---
name: skill-creator
description: Create or modify Leon skills by designing the workflow, editing the repository, and validating the result.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Skill Creator

Use this skill when the owner asks Leon to create, update, replace, or repair a Leon skill.

## Scope

Create and modify Leon skills in this repository:

- Native skills live under `skills/native/{name}_skill`.
- Agent skills live under `skills/agent/{name}/SKILL.md`.
- Profile-specific skills live under the active profile only when the owner explicitly asks for a personal/profile skill.

Prefer an Agent Skill when the request is a workflow, research process, coding process, or repeatable procedure that can be expressed as `SKILL.md` instructions. Prefer a native skill only when Leon needs deterministic controlled-mode routing, locales, widgets, action code, or reusable runtime behavior.

## Workflow

1. Clarify only when the skill goal, target type, or required external service is ambiguous.
2. Inspect existing nearby skills before creating files.
3. Inspect the built-in tools under `tools/` and prefer reusing them from skill actions before creating new tool logic.
4. If no built-in tool fits, consider whether a new tool should be created with the `tool-creator` Agent Skill rather than embedding tool-like logic inside the skill.
5. Choose the smallest viable skill shape:
   - Agent Skill: one `SKILL.md`, plus scripts only when they provide real reusable value.
   - Native skill: `skill.json`, locales, settings sample, and action code.
6. For native skills, follow existing `skills/native/*_skill` patterns and use the existing bridge style for TypeScript or Python.
7. For Agent Skills, include frontmatter with a lowercase hyphenated `name` and a concise `description`.
8. Keep implementation scoped to the new or modified skill and directly required routing changes.
9. Run `pnpm run lint` after edits and fix every warning or error.
10. Summarize changed files and suggest one valid commit message.

## Pi

When a coding-agent run is useful, use the `coding_development.pi.runCodingTask` tool from the target repository root. Keep Pi prompts concrete and bounded:

- State the exact files or directories it may edit.
- Include Leon conventions from `AGENTS.md`.
- Ask it to run validation, but verify important results yourself after it returns.

Use Pi for delegated coding-agent work.

## Native Skill Checklist

For native skills, verify:

- `skill.json` has the right schema path, name, bridge, version, description, author, and actions.
- Required parameters are declared only when the action truly needs them.
- Locale keys match action output keys.
- `settings.sample.json` exists, even when empty.
- Action code uses existing SDK helpers and tools before adding new logic.
- No generated artifacts, temporary files, or unrelated metadata are committed.

## Agent Skill Checklist

For Agent Skills, verify:

- `SKILL.md` starts with valid frontmatter.
- The `name` is lowercase kebab-case and matches the directory.
- The description is specific enough for automatic selection.
- The workflow is actionable and does not read like product marketing.
- Any scripts are executable through a portable runtime and documented in the skill.

## Output

Report the result concisely:

- Skill created or modified.
- Important files changed.
- Validation run.
- Suggested commit message.
