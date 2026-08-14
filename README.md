# pi-trellis

Pi-only Trellis workflow package for Pi Agent.

This package keeps Trellis task/spec/workflow context injection in Pi, but uses visible Pi session-tree task branches from [`pi-supergsd`](https://github.com/skhoroshavin/pi-supergsd) instead of the old hidden `trellis_subagent` child-process system.

## Status

Source-installable package for local path validation and GitHub install. It is **not** published to the npm registry.

## Upstream baseline

This project is adapted from [`mindfold-ai/Trellis`](https://github.com/mindfold-ai/Trellis). The current upstream baseline is recorded in `package.json` under `trellisUpstream`:

- Repository: `https://github.com/mindfold-ai/Trellis.git`
- Package version: `0.6.14` (kept aligned with the upstream baseline)
- Tag: [`v0.6.14`](https://github.com/mindfold-ai/Trellis/tree/v0.6.14)
- Upstream version: `0.6.14`
- Recorded at: `2026-08-08`

When upstream changes, compare the new upstream tag range from this baseline, analyze which changes still apply to the Pi-only package boundary, and selectively port the relevant updates instead of merging blindly.

## Requirements

1. Pi Agent installed.
2. A target project that already contains a `.trellis/` runtime/workflow/spec setup.
3. `pi-supergsd` installed with bundled Superpowers skills disabled:

```json
{
  "source": "npm:pi-supergsd",
  "skills": []
}
```

This package does not vendor or fork `pi-supergsd`.

The `trellis-session-insight` skill additionally requires an optional, separately installed global Trellis CLI. This package does not include Trellis CLI/core.

## Install

### Local path validation

From this repository:

```bash
pi install /absolute/path/to/pi-trellis
# or add that local package path to a target project's .pi/settings.json
```

### GitHub install shape

Once the repository owner/ref is finalized, install from GitHub with one of:

```bash
pi install git:github.com/jinuxx/pi-trellis@main
pi install https://github.com/jinuxx/pi-trellis@main
```

Pi clones git packages and runs `npm install` when `package.json` exists.

## Package resources

`package.json` declares:

- `pi.extensions`: `./index.ts`
- `pi.skills`: `./skills`
- `pi.prompts`: `./prompts`

Role definitions live in package-owned `agents/` as branch-only prompt payloads. The extension injects only their file catalog into the main session and, when a queued prompt declares `Branch role: ...`, attaches the selected role file to that branch prompt.

## Selected v0.6.14 updates

- Resolves archived task JSONL self-references against the archived task copy, matching upstream task-context validation behavior.
- Keeps active task directories and remapped context files inside the target project; rejects external task paths and archive traversal entries.
- Does not ship upstream CLI/core or the Grok adapter; `trellis-session-insight` can use a separately installed global Trellis CLI.

## Selected v0.6.12 updates

- Uses Pi's native session identity as the Trellis context key and binds `sessionManager` getters to their owner.
- Adds a hash when session ID normalization or length limiting changes the value, preventing different native sessions from colliding.
- Removes cross-session task adoption and does not treat a stale `TRELLIS_CONTEXT_ID` environment variable as the current Pi session; the variable remains an explicit bash child-process carrier after the current key is resolved.
- This selective port excludes v0.6.11 hidden-subagent/CLI changes, v0.7 beta workflow changes, and all non-Pi runtime updates.

## Selected v0.6.10 updates

- Tightens `trellis-brainstorm` planning gates: a final planning summary and a subsequent explicit approval are required before implementation.
- Chooses the one-shot SessionStart acknowledgment language from the triggering request, then the established project language, with `Trellis SessionStart ✓` as a neutral fallback.
- Caps injected JSONL files, task artifacts, and aggregate inline context at 32/64/128 KiB by default, with UTF-8-safe truncation, binary reference notices, and overflow index notices.
- Keeps upstream CLI/core, hidden-subagent, non-Pi, and scaffold changes out of this package.

Target projects can override the context limits in `.trellis/config.yaml`; `0` disables the corresponding limit:

```yaml
context_injection:
  max_file_bytes: 32768
  max_artifact_bytes: 65536
  max_total_bytes: 131072
```

## Selected v0.6.6 updates

- Keeps Pi's injected `systemPrompt` byte-stable across turns for provider prefix-cache reuse.
- Delivers changing workflow/task context as hidden custom messages instead of rewriting user input.
- Re-sends the latest dynamic runtime context through Pi hooks when a compaction removed its hidden message.
- Restricts JSONL-referenced context files to the project root.
- Does not include or depend on the Oh My Pi extension; only its generally useful compaction-safety pattern was adapted to the native Pi API.

## What is intentionally not included

- No `.trellis/` scaffold. The target project must already have `.trellis/`.
- No Trellis CLI/core.
- No npm registry publication.
- No Superpowers skills.
- No hidden `trellis_subagent`, `runPi`, `runSubagent`, or `pi --mode json -p --no-session` subagent dispatch.
- No non-Pi platform runtime or Trellis channel worker runtime.

## Usage model

The extension activates only when the current directory or an ancestor contains a real `.trellis/` directory. A `.pi/` directory alone does not activate it.

The main session has an explicit branch-dispatch gate:

- Planning/orientation, Trellis task/workspace management, Phase 3 `.trellis/spec/` updates, and commit/finish management may run directly in the main session.
- Implementation, check/fix, and task-scoped research use visible `trellis-implement`, `trellis-check`, or `trellis-research` branches.
- Direct implementation/check/research in the main session requires an explicit user request for current-session work.
- There is no `trellis-update-spec` branch role. Run Phase 3 spec updates in the main session.
- If `push-task` is unavailable, report the missing `pi-supergsd` capability instead of silently doing branch work directly.

Before dispatching, the main session may inspect task artifacts needed to make the prompt self-contained. Call `push-task` as the only tool in its assistant tool batch. `pi-supergsd` 0.2.9 requires both fields:

```json
{
  "title": "Short task title",
  "prompt": "Active task: .trellis/tasks/<task-dir>\nBranch role: trellis-implement\n..."
}
```

The prompt's first line must name a usable task directory under `.trellis/tasks` (an active task or a dated archive task containing `task.json` and `prd.md`) and it must contain exactly one valid `Branch role:` line. The extension validates both, then attaches the selected package-owned role file. Include relevant task artifacts, curated JSONL context, and constraints such as no `git commit`, `git push`, or `git merge`.

The user starts the visible branch, optionally selecting a model, then returns its result:

```text
/start-task [model]
/finish-task
```

## Verification

Package source checks:

```bash
npm test
node --check index.ts
node -e "import('./index.ts').then(m => { if (typeof m.default !== 'function') throw new Error('invalid extension export') })"
git diff --check
```

Optional smoke checks after install/reload from a target Trellis project:

```bash
pi list | grep -A2 -B1 'pi-trellis\|pi-supergsd'
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py validate <task-dir>
```
