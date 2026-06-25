---
name: trellis-meta
description: "Understand and customize this Pi-only Trellis package: .trellis workflow/tasks/specs, .pi extension/skills/prompts/agent role files, pi-supergsd branch-task integration, and local package-boundary cleanup."
---

# Trellis Meta — Pi-only

Use this skill when the user asks to modify Trellis itself in this project: workflow text, task scripts, specs, Pi extension hooks, Pi skills/prompts, role prompts, or the pi-supergsd branch-task integration.

This project is being rebaselined as a **Pi Agent only** Trellis package. Treat local files as authoritative.

## Local Architecture

- `index.ts` — Pi extension that injects Trellis task/workflow context and branch-task guidance. It must not register the old hidden child-process `trellis_subagent` tool.
- `agents/trellis-implement.md`, `agents/trellis-check.md`, `agents/trellis-research.md` — role prompts for visible Pi branch tasks, owned by the package root.
- `skills/` — Pi skills that remain useful for Trellis workflow guidance.
- `prompts/` — Pi prompt templates such as continue and finish-work.
- `.pi/settings.json` — project-level Pi settings that should load `pi-trellis` as a local package path and separately load filtered `pi-supergsd`.
- `.trellis/workflow.md` — workflow source of truth. It should describe Pi branch-task flow, not multi-platform dispatch.
- `.trellis/tasks/` — task PRD/design/implement/research artifacts and `implement.jsonl` / `check.jsonl` context manifests.
- `.trellis/spec/` — project coding conventions and guides.
- `.trellis/workspace/` — developer journals.
- Filtered `pi-supergsd` user/package dependency — provides `push-task`, `/start-task`, `/finish-task`, `/abort-task`, `/discard-task`, and visible `task-result` messages.

## Current Rules

- Trellis is scoped to Pi Agent in this project.
- Queue visible branch work through pi-supergsd `push-task`; the user starts it with `/start-task` and returns with `/finish-task`.
- The queued prompt must be self-contained and start with `Active task: <task path>`.
- Include role instructions, task artifacts, and curated JSONL context in branch prompts.
- Do not reintroduce hidden subprocess dispatch or a `trellis_subagent` fallback.
- Do not add Superpowers skills; pi-supergsd should be loaded with `skills: []`.
- Keep changes surgical and local unless the user explicitly asks for package publishing/extraction.

## When Editing

1. Read the current task artifacts under `.trellis/tasks/<active-task>/`.
2. Read relevant `.trellis/spec/` guides before code changes.
3. Search for old non-Pi or hidden-dispatch language before claiming cleanup is complete.
4. Prefer updating `.pi/` and `.trellis/` local validation files first; package-owned layout migration is post-smoke unless the user changes scope.

## Do Not

- Do not describe Claude Code, Codex, OpenCode, Cursor, Gemini, Qoder, CodeBuddy, Copilot, Droid, or channel workers as supported by this Pi-only package.
- Do not restore `.trellis/agents/` channel runtime files as part of the Pi-only MVP.
- Do not modify global npm installs or `node_modules` for project-local behavior.
- Do not commit or push unless explicitly requested.
