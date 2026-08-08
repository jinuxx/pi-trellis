# pi-trellis

Pi-only Trellis workflow package for Pi Agent.

This package keeps Trellis task/spec/workflow context injection in Pi, but uses visible Pi session-tree task branches from [`pi-supergsd`](https://github.com/skhoroshavin/pi-supergsd) instead of the old hidden `trellis_subagent` child-process system.

## Status

First-pass package shape for local path validation and GitHub install. It is **not** published to the npm registry.

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

## Install

### Local path validation

From this repository:

```bash
pi install /absolute/path/to/pi-trellis
# or, from a project .pi/settings.json, add a local package path that points at this repo
```

This checkout's project `.pi/settings.json` uses a local package path for validation.

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
- Does not port upstream CLI/core `trellis mem` compaction recovery or the Grok adapter because this package contains only the Pi extension and package resources.

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
- Restores runtime context after compaction when the hidden message was removed.
- Restricts JSONL-referenced context files to the project root.
- Does not include or depend on the Oh My Pi extension; only its generally useful compaction-safety pattern was adapted to the native Pi API.

## What is intentionally not included

- No `.trellis/` scaffold is installed in the first pass. The target project must already have `.trellis/`.
- No npm registry publication.
- No Superpowers skills.
- No hidden `trellis_subagent`, `runPi`, `runSubagent`, or `pi --mode json -p --no-session` subagent dispatch.
- No non-Pi platform runtime or Trellis channel worker runtime.

## Usage model

The main session has an explicit branch-dispatch gate:

- Read-only planning and orientation may stay in the main session.
- Any task work that changes files, runs checks/fixes, or performs task research must be queued with `push-task` before that work, regardless of size.
- Direct work in the main session is allowed only when the user explicitly requests it. A small or familiar task is not an implicit exception.
- If `push-task` is unavailable, report the missing `pi-supergsd` capability instead of silently doing branch work directly.

Before dispatching, the main session may inspect the task artifacts needed to make the prompt self-contained. It must then call `push-task` alone in that turn and wait for the user to start the branch.

The branch prompt must start with:

```text
Active task: .trellis/tasks/<task-dir>
```

It should declare exactly one role on a line such as `Branch role: trellis-implement`; the extension attaches that role instruction file from package-owned `agents/`. Include task artifacts, curated JSONL context, and constraints such as no `git commit`, `git push`, or `git merge`. The role files are for the visible branch only and must not be treated as main-session instructions.

The user starts the branch with:

```text
/start-task
```

and returns the result with:

```text
/finish-task
```

## Verification

Useful checks after install/reload:

```bash
pi list | grep -A2 -B1 'pi-trellis\|pi-supergsd'
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py validate <task-dir>
```

For source validation:

```bash
node - <<'NODE'
const { createJiti } = require('/Users/jin/.nvm/versions/node/v24.12.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti');
const jiti = createJiti(process.cwd() + '/');
const mod = jiti('./index.ts');
const fn = mod.default || mod;
if (typeof fn !== 'function') throw new Error('package extension default export is not a function');
console.log('package extension loads:', typeof fn);
NODE
```
