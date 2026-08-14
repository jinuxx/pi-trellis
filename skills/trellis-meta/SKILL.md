---
name: trellis-meta
description: "Understand and customize this Pi-only Trellis package: .trellis workflow/tasks/specs, .pi extension/skills/prompts/agent role files, pi-supergsd branch-task integration, and local package-boundary cleanup."
---

# Trellis Meta — Pi-only

Use this skill when the user asks to modify Trellis itself in this project: workflow text, task scripts, specs, Pi extension hooks, Pi skills/prompts, role prompts, or the pi-supergsd branch-task integration.

This is a **Pi Agent only** Trellis package. Treat package files and the target project's own configuration as separate ownership boundaries.

## Package-Owned Architecture

- `index.ts` — Pi extension that injects Trellis task/workflow context and branch-task guidance. It must not register the old hidden child-process `trellis_subagent` tool.
- `agents/trellis-implement.md`, `agents/trellis-check.md`, `agents/trellis-research.md` — role prompts for visible Pi branch tasks.
- `skills/` — Pi skills that remain useful for Trellis workflow guidance.
- `prompts/` — Pi prompt templates such as continue and finish-work.

## Target-Project-Owned State

- `.pi/settings.json`, when present — target-project Pi settings that may load `pi-trellis` and filtered `pi-supergsd`.
- `.trellis/workflow.md` — target project's workflow source of truth.
- `.trellis/tasks/` — task PRD/design/implement/research artifacts and context manifests.
- `.trellis/spec/` — project coding conventions and guides.
- `.trellis/workspace/` — developer journals.
- Filtered `pi-supergsd` installation — provides `push-task`, `/start-task`, `/finish-task`, `/abort-task`, `/discard-task`, and visible `task-result` messages.

## Current Rules

- Trellis is scoped to Pi Agent in this project.
- Queue implementation, check/fix, and task-scoped research through pi-supergsd `push-task`; the user starts it with `/start-task [model]` and returns with `/finish-task`.
- Planning/orientation, Trellis task/workspace management, Phase 3 `.trellis/spec/` updates, and commit/finish management may run in the main session. There is no update-spec branch role.
- Direct implementation/check/research in the main session requires an explicit user request. If `push-task` is unavailable, report the missing capability.
- Call `push-task` alone in its assistant tool batch with required `{title, prompt}` fields. The prompt must be self-contained and start with `Active task: <task path>`.
- Include exactly one role instruction file, task artifacts, and curated JSONL context in branch prompts. Files under package-owned `agents/` are branch-only payloads and are not main-session instructions.
- Do not reintroduce hidden subprocess dispatch or a `trellis_subagent` fallback.
- Do not add Superpowers skills; pi-supergsd should be loaded with `skills: []`.
- Keep changes surgical and local unless the user explicitly asks for package publishing/extraction.

## When Editing

1. When changing package behavior, read `index.ts` and the affected package-owned `agents/`, `skills/`, `prompts/`, and tests.
2. When changing a target project's workflow, read its current task artifacts and relevant `.trellis/spec/` guides.
3. Search for old non-Pi or hidden-dispatch language before claiming cleanup is complete.
4. Do not invent package-local `.pi/` or `.trellis/` files; those belong to target projects.

## Do Not

- Do not describe Claude Code, Codex, OpenCode, Cursor, Gemini, Qoder, CodeBuddy, Copilot, Droid, or channel workers as supported by this Pi-only package.
- Do not restore `.trellis/agents/` channel runtime files as part of the Pi-only MVP.
- Do not modify global npm installs or `node_modules` for project-local behavior.
- Do not commit or push unless explicitly requested.
