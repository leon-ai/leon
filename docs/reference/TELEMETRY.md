# Telemetry

Leon shares anonymous usage statistics solely to improve its agent loop. The numbers help us see how much Leon is used and where it can be faster, more reliable, or more efficient. Usage sharing is **on by default**. Turn it off in **Settings → Privacy and security** or set `telemetry_enabled: false` in your profile's `config.yml` and restart Leon.

**Your messages and any personal information are never included in telemetry reports.** Telemetry excludes prompts, replies, attachments, file paths, credentials, tool inputs and outputs, raw errors, and private model names. The collector does not log your IP address.

Leon generates anonymous installation and profile codes locally so we can count installations, profiles, and repeat usage. The codes contain no names or original IDs.

| Data shared | What it includes |
| --- | --- |
| Installation activity | Setup date, time to first answer, whether Leon is running, and timestamps used to track usage over time. |
| Agent turns | Counts of answers, clarifications, cancellations, failures, and recoveries from failed model calls. |
| Client | The type of app that started a turn and its operating system family. |
| Speed | Time spent on turns, tools, and model calls, including time to first model output. |
| Model and tool usage | Public model and provider names, quantization for recognized local models, call counts, and input, output, and cached token counts. |
| Tools and skills | Usage counts and observed failures for public built-in toolkits, tools, functions, and skills. Custom tools and skills are counted by broad category. |
| Context usage | How much of the context window Leon used. |
| Context reduction | Counts of local prompt reductions and estimates of tokens freed. |
| Pulse | Counts, timing, and model usage for proactive checks. |
| Build and reliability | Leon version, public build commit when available, Core server operating system and CPU architecture, and broad failure categories. |
| Timezone | The timezone used by Leon or its server, such as `Europe/Paris`. |
