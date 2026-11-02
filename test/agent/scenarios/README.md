# Real agent scenarios

Run all scenarios, one category, one mechanism, or one case:

```sh
pnpm test:agent:scenario
pnpm test:agent:scenario -- agent-loop-scenarios
pnpm test:agent:scenario -- experience-scenarios
pnpm test:agent:scenario -- memory-scenarios/experience-scenarios/recovery
```

List everything or inspect a selection without starting inference:

```sh
pnpm test:agent:scenario -- --list
pnpm test:agent:scenario -- experience-scenarios --list
```

Selection follows the folder hierarchy. Short mechanism and case names work when
unique; ambiguous names require their relative path. Helpers are not scenarios.
The six categories are `agent-loop-scenarios`, `tool-runtime-scenarios`,
`context-scenarios`, `memory-scenarios`, `runtime-scenarios`, and
`capability-scenarios`.

Scenarios use the latest-used profile's active model; set `LEON_PROFILE` to select
another profile. Model calls use its configured account. Each case runs in a
disposable Leon home with isolated sessions, memory, settings and workspaces.
Evidence logs are retained under `tmp/agent-scenarios/`. The provider matrix stays
separate under `test/agent/e2e/`.

Local file, coding, SQL, document, chart and sharing workflows execute real tools.
Browser interaction uses a disposable headless Chromium profile and a local form.
Weather and search observations use controlled external-service fixtures where
declared by the case. The desktop cases exercise permission denial and recording
cleanup through device fixtures; Satellite uses an in-process device transport.
Those cases do not verify a live device driver or successful tutorial rendering.

Each mechanism has representative observable checks. Add distinct cases within
its folder as coverage grows; a folder's presence does not imply every behavior
of that subsystem has been tested.
