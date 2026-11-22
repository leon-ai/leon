# Telemetry

Leon shares anonymous usage statistics solely to improve its agent loop. The numbers help us see how much Leon is used and where it can be faster, more reliable, or more efficient. Usage sharing is **on by default**. Turn it off in **Settings → Privacy and security** or set `telemetry_enabled: false` in your profile's `config.yml` and restart Leon.

**Your messages and any personal information are never included in telemetry reports.** Telemetry excludes prompts, replies, attachments, file paths, credentials, tool inputs and outputs, raw errors, and private model names. The collector does not log your IP address.

Leon generates anonymous installation and profile codes locally so we can count installations, profiles, and repeat usage. The codes contain no names or original IDs.

| Data shared | What it includes |
| --- | --- |
| Installation activity | Setup date, time to first answer, whether Leon is running, and timestamps used to track usage over time. |
| Agent turns | Counts of answers, clarifications, cancellations, failures, and recoveries from failed model calls. |
| Speed | Time spent on turns, tools, and model calls, including time to first model output. |
| Model and tool usage | Public model and provider names, call counts, and input, output, and cached token counts. |
| Context usage | How much of the context window Leon used. |
| Build and reliability | Leon version, public build commit when available, operating system, CPU architecture, and broad failure categories. |
| Timezone | The timezone used by Leon or its server, such as `Europe/Paris`. |
