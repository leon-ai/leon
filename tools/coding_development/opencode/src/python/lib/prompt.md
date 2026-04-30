{{SYSTEM_PROMPT_SECTION}}
{{REPO_SNAPSHOT}}
{{TOOLKIT_INFO}}

# Leon Skill Creation (Concise)

You are generating a Leon skill in **{{LANGUAGE}}**.

## Core Rules

- Use the **{{BRIDGE}}** bridge for all source files.
- Skills live directly under `skills/` (no subfolders).
- All source files use `{{FILE_EXTENSION}}`.
- Validate JSON files against `schemas/skill-schemas/*`.
- Write all required files to disk under the chosen `skills/<name>_skill` folder.

## Required Structure

```
skills/skill_name/
  skill.json
  locales/en.json
  src/
    settings.sample.json
    settings.json
    actions/
    widgets/ (optional)
```

## skill.json Rules

- `actions` required, `flow` optional.
- If `flow` exists, only the first action receives user parameters.
- Use `"skill_name:action_name"` for cross-skill flow steps.
- Set `author.name` to `Leon` unless explicitly specified.

## Settings Files

- `src/settings.sample.json` and `src/settings.json` must both exist and start identical.
- Use `{}` if no settings.

## Toolkits (Plan First)

- Choose relevant toolkits from above **before** writing code.
- Use existing tools instead of duplicating functionality.

## leon.answer Basics

{{LEON_ANSWER_BASIC_EXAMPLE}}

## Passing Data Between Actions

{{CONTEXT_DATA_EXAMPLE}}

## Settings Usage

{{SETTINGS_USAGE_EXAMPLE}}

## Widget Rules

- Do not use `Card` as the parent component. The `WidgetWrapper` is already applied by default.
- For icons, use only the icon name without the `ri-` prefix and `-line` suffix. The system automatically completes them to `ri-{icon-name}-line`. For example, use `snow` instead of `ri-snow-line`.

## Action Parameters

{{ACTION_PARAMS_EXAMPLE}}

{{REFERENCE_FILES_SECTION}}
