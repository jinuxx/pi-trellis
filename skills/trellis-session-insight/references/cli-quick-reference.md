# trellis mem Pi Quick Reference

Use a separately installed global Trellis CLI's `trellis mem` only for local Pi Agent session history. `pi-trellis` does not include CLI/core.

## Common commands

```bash
trellis mem list --limit 10
trellis mem search "keyword" --limit 20
trellis mem context <session-id> --turns 3 --around 2
trellis mem extract <session-id> --phase all
trellis mem projects
```

## Scope

- Read local Pi Agent session logs from the default or environment-configured session root, global `~/.pi/agent/settings.json`, and the scoped project's `.pi/settings.json`.
- Resolve relative `sessionDir` values from the directory containing the settings file; pass `--cwd <project-path>` when project-local settings must be selected explicitly.
- Treat any non-Pi provider flags exposed by an older CLI as legacy implementation detail.
- Do not rely on Claude Code, Codex, OpenCode, or other platform logs for this package.
- `mem` is read-only; any spec/task updates must be explicit follow-up edits.
