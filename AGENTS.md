<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# pi-trellis Local Guardrails

## Sources of truth

- The block between `TRELLIS:START` and `TRELLIS:END` is managed by Trellis and may change during an upstream update. Do not treat text outside that block as an upstream snapshot.
- Read `package.json` for the current package version, upstream baseline, and exported Pi resources.
- Read `README.md` for the current product scope, installation model, intentional exclusions, branch workflow, and verification commands.
- Read `index.ts` and the package-owned `skills/`, `prompts/`, and `agents/` for current runtime behavior. Do not infer current Pi behavior from this file.
- Keep this file limited to durable local guardrails; do not copy release-specific implementation details or hard-code the current upstream version here.

## Durable project scope

- Keep this repository a Pi-only, selectively adapted Trellis package. Do not merge the full multi-platform upstream tree blindly.
- Preserve the project's visible Pi session-tree branch model unless the user explicitly requests an architectural change. Confirm its current details in `README.md` and the implementation before editing it.
- Do not restore hidden child-process subagent dispatch or introduce non-Pi platform runtimes unless explicitly requested.
- Do not add or depend on Oh My Pi merely because upstream supports it. Platform-neutral ideas may be evaluated and adapted to native Pi independently.
- Treat security boundaries, especially project-local context-file access, as local requirements that must not be weakened silently during an upstream port.

## Upstream update protocol

- Derive the current baseline from `package.json`; never rely on a version written in `AGENTS.md`.
- Compare the recorded upstream tag with the candidate tag and review only changes relevant to the current Pi-only scope.
- Re-read the current Pi extension documentation and inspect the new upstream implementation before porting. Existing context-injection, compaction, session-identity, and branch-task mechanisms are implementation choices to revalidate, not permanent rules copied from an older release.
- For a major upstream or Pi API change, explicitly reassess system-prompt handling, dynamic context delivery, compaction behavior, session identity, context-file boundaries, and branch isolation. Replace obsolete mechanisms instead of preserving them for consistency with this file.
- After selecting and implementing an update, align `package.json` and `README.md`. Change these local guardrails only when the durable project scope or update policy itself changes.

## Verification

- Use the current verification commands documented in `README.md` rather than duplicating version-sensitive commands here.
- Check `git diff --check` and confirm the Trellis-managed block remains intact.
- Verify behavior affected by the actual diff; do not assume checks from the previous upstream release are still sufficient.
