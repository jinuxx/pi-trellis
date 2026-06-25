# trellis mem Pi Quick Reference

Use `trellis mem` only for local Pi Agent session history in this Pi-only package.

## Common commands

```bash
trellis mem list --limit 10
trellis mem search "keyword" --limit 20
trellis mem show <session-id> --limit 200
```

## Scope

- Read local Pi Agent session logs under `~/.pi/agent/sessions/`.
- Treat any non-Pi provider flags exposed by an older CLI as legacy implementation detail.
- Do not rely on Claude Code, Codex, OpenCode, or other platform logs for this package.
- `mem` is read-only; any spec/task updates must be explicit follow-up edits.
