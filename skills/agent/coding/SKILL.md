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
2. Before editing, inspect applicable `AGENTS.md` files from repository root through each target directory. `file.read` includes them in `repositoryInstructions` with source reads; read missing instructions explicitly. Confirm full returned text, since shell success alone does not prove a file was read. Deeper rules override broader ones only in their subtree. For non-Git work, use the owner-selected boundary, excluding unrelated parent instructions.
3. In plan details, record workspace, instruction paths, constraints, and acceptance criteria with required checks from the request/references. Discover nested instructions before editing new directories. After compaction/continuation, reread applicable files in full before editing; summaries cannot replace current instructions.
4. Inspect Git status and staged/unstaged diffs; record and preserve unrelated changed/untracked content. Never reset, clean, stage or commit owner work without authorization. Use an isolated worktree when concurrency or the requested workflow warrants it.

## Investigate and change

- Use bounded file reads, ripgrep and available structural search. Trace definitions and callers; check installed dependencies instead of inventing symbols or APIs. Batch independent discovery calls.
- For a bug, reproduce the failure with a relevant check before changing the implementation. Inspect existing tests and extend only meaningful coverage. Do not weaken tests to obtain a pass.
- Prefer `file.patch` for changes to existing text, using the current read's content hash when available. Supply unique exact context and preserve unrelated changes. On stale or ambiguous matches, re-read and revise the patch rather than repeating it or overwriting from a partial view.
- Use `file.write` for new files; overwriting an existing file requires its complete current content. Follow the project's formatting and dependency-management instructions.
- Use `shell.executeCommand` for finite commands and project checks, always with the observed workspace cwd. Discover commands from project configuration rather than guessing a package manager.
- Use shell session functions for dev servers, watchers or interactive programs. Record returned session IDs in the plan, follow output cursors, and verify process status. A started process is not a completed or successful check. Never invent handles, replay a command to recover output, or send secrets through stdin.

## Verify and finish

1. Run the checks required by project instructions and those relevant to the changed behavior. Inspect actual exit codes and diagnostics; record each criterion's observed outcome and evidence in plan details. Changes after a successful check make affected proof stale; rerun those checks.
2. For UI work, visually inspect supplied references and the final rendered page at the requested viewports. Compare required layout, typography, assets and content; exercise affected interactions. A build or screenshot file alone does not prove visual conformance. Fix observed mismatches and reinspect affected results; derive checks from the actual brief and references, not assumed template conventions.
3. Review the final diff against the original task and initial owner changes. Remove accidental edits without discarding owner work. Verify unrelated staged, unstaged and untracked content remains intact.
4. Stop command sessions owned by this task unless the owner asked to keep them running. Inspect returned termination status; clean up on failures too.
5. Reconcile all acceptance criteria before reporting completion. Use available tools to resolve missing evidence; disclose requirements that could not be verified. Report what changed, which checks passed or failed, and any remaining blocker. Do not claim completion from an edit acknowledgement, running process or unavailable check. Suggest a commit message when the repository requires one, but do not commit unless asked.
