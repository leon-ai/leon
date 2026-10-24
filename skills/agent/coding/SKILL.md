---
name: coding
description: Investigate, implement and verify code changes directly in a repository using Leon's file, search and shell tools.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Coding

Code directly with Leon's existing loop and tools. Respect scope: analysis does not authorize edits, commits, pushes or publication. Delegate only on owner request or applicable preference.

For delegation, use the owner's preferred available agent/interface. Pass the repository, task, instructions and authorized scope; inspect and verify results, not just prompt submission. If unavailable, explain briefly and continue directly within scope.

## Repository and instructions

1. Establish the exact workspace/cwd from the request and live observations. Read relevant manifests and nearby code; reuse helpers before adding abstractions.
2. Before project commands or edits, inspect applicable `AGENTS.md` files from repository root through each target directory. `file.read` includes them in `repositoryInstructions` with source reads; read missing instructions explicitly. Confirm full returned text, since shell success alone does not prove a file was read. Reuse complete returned instructions, including unchanged content referenced in earlier visible tool results, instead of rediscovering the same files. Apply their package manager and test commands to the baseline as well as final checks. Deeper rules override broader ones only in their subtree. For non-Git work, use the owner-selected boundary, excluding unrelated parent instructions.
3. In plan details, record workspace, instruction paths, constraints, and acceptance criteria with required checks from the request/references. Discover nested instructions before editing new directories. After compaction/continuation, reread applicable files in full before editing; summaries cannot replace current instructions.
4. Inspect Git status and staged/unstaged diffs; record and preserve unrelated changed/untracked content. Never reset, clean, stage or commit owner work without authorization. Use an isolated worktree when concurrency or the requested workflow warrants it.

## Investigate and change

- Select the functions needed for inspection, authorized edits and verification together from the tool index; reuse their schemas throughout the task. Expand discovery only when evidence requires another capability. Use bounded reads, ripgrep and available structural search. Trace definitions/callers and check installed dependencies; never invent symbols/APIs. Read package metadata from its manifest; respect package exports and resolve dependencies from their owning source rather than assuming a flat install layout.
- Batch independent reads of known files, searches and edits to different files in one response. Combine independent commands/checks when each result and exit status remains visible; keep dependent checks after their inputs exist. Include plan updates supported by prior evidence alongside the next independent action. Do not weaken verification or bypass dedicated tool safeguards to reduce call counts.
- Reproduce bugs before editing; use affected existing tests when baseline evidence is needed to distinguish existing failures from regressions. Run repository-required baseline checks even when an interactive reproduction already shows the bug; do not infer a full baseline suite requirement from a rule to run lint or relevant tests. Extend only meaningful coverage when authorized, and never weaken tests for a pass.
- Prefer `file.patch` with the current read's hash when available, unique exact context and unrelated changes preserved. For stale/ambiguous matches, reread and revise; never repeat unchanged patches or overwrite from partial views.
- Use `file.write` for new files; overwriting requires complete current content. Follow project formatting and dependency rules.
- Prefer `shell.executeCommand` for short finite commands/checks. Use `shell.startSession` for long checks, installs, servers, watchers and interactive programs so owner follow-ups can be handled without discarding running work. Supply the observed workspace cwd and use the project's commands and package manager.
- Record session IDs and commands in the plan, follow output cursors and verify process status; starting is not completion/success. After follow-ups or interruptions, inspect retained work before restarting anything. Informational questions preserve the task and its sessions; stop affected sessions when the owner cancels or redirects work that is no longer applicable. Never invent handles, replay commands for output or send secrets through stdin.

## Verify and finish

1. Inspect test scripts before choosing commands: appended file arguments may add to an existing directory selection instead of narrowing it. For affected tests, use the project's configured runner with explicit files and the same environment/options, unless repository instructions require a broader command. Preserve mandatory whole-project checks such as lint.
2. Run project-required and relevant checks with existing tests/installed parsers. Scale verification to the change: a mechanical edit can use an exact diff, syntax checks and the existing relevant tests. Do not invent a separate smoke-test suite to restate an already checked transformation. Batch independent checks with visible exit statuses; inspect diagnostics and record criterion outcomes/evidence in plan details. Rerun affected checks after changes, failures or unresolved evidence gaps; finish once required checks pass rather than repeating completed verification.
3. For UI work, visually compare references and final render at requested viewports: layout, typography, assets and content; exercise affected interactions. Builds/screenshot files alone do not prove conformance. Fix mismatches and reinspect. Derive checks from the brief/references, not assumed templates.
4. Review the final diff against the original task and initial owner changes. Remove accidental edits while preserving unrelated staged, unstaged and untracked content.
5. Stop only task-owned sessions unless the owner requests otherwise. Inspect termination status; clean up on failures too.
6. Reconcile every criterion; use available tools to resolve evidence gaps and disclose unverified requirements. Report changes, passed/failed checks and blockers. Edit acknowledgements, running processes and unavailable checks do not prove completion. Suggest a commit message if required; commit only when asked.

## Publication

Before authorized commits, pushes or public releases, inspect exact selected files (including untracked), staged diff, destination and outgoing history; record evidence in the existing plan. Ignore rules cannot remove tracked/committed secrets.

Withhold publication of credentials/private data until outgoing content is remediated and rechecked. Prepare clean example configuration or sanitized content within scope; preserve unrelated owner work and never print secret values. Shared-history rewrites, credential revocation and account-access changes require authorization. Report required owner action with secrets redacted. Never test exposed credentials, sign in with them or request more for an unsafe release.

After remediation, inspect final staged content and every outgoing commit; publish only verified content to the authorized destination. Command success does not prove secrets were excluded: inspect the resulting commit/release artifact before claiming completion.
