# Telemetry

Leon shares anonymous usage statistics solely to improve its agent loop. The numbers help us see how much Leon is used and where it can be faster, more reliable, or more efficient. Usage sharing is **on by default**. Turn it off in **Settings → Privacy and security** or set `telemetry_enabled: false` in your profile's `config.yml` and restart Leon.

**Your messages and any personal information are never included in telemetry reports.** Telemetry excludes prompts, replies, attachments, file paths, credentials, tool inputs and outputs, and private model names. Raw error messages stay local. The collector does not log your IP address.

**Of course, workspace and session titles aren't shared.**

Leon generates anonymous installation and profile codes locally so we can count installations, profiles, and repeat usage. The codes contain no names or original IDs.

| Data shared | What it includes |
| --- | --- |
| Installation and app | Setup and activity times, Leon version and public build, app type, server and app operating systems, server architecture, and timezone. |
| Workspaces and sessions | Counts of workspaces and sessions. |
| Agent and Pulse | Counts, timing, outcomes, and fixed failure codes for turns and background work, plus token and context usage. |
| Models, tools, and skills | Public model and provider names, recognized local model precision, and usage counts for built-in tools and skills. Custom tools and skills are counted by category. |
