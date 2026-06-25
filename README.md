# pi-trellis

Pi-only Trellis workflow package for Pi Agent.

This package keeps Trellis task/spec/workflow context injection in Pi, but uses visible Pi session-tree task branches from [`pi-supergsd`](https://github.com/skhoroshavin/pi-supergsd) instead of the old hidden `trellis_subagent` child-process system.

## Status

First-pass package shape for local path validation and GitHub install. It is **not** published to the npm registry.

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

Role definitions live in package-owned `agents/` and are read by the extension when injecting branch-task guidance.

## What is intentionally not included

- No `.trellis/` scaffold is installed in the first pass. The target project must already have `.trellis/`.
- No npm registry publication.
- No Superpowers skills.
- No hidden `trellis_subagent`, `runPi`, `runSubagent`, or `pi --mode json -p --no-session` subagent dispatch.
- No non-Pi platform runtime or Trellis channel worker runtime.

## Usage model

When fresh implementation/check/research isolation is useful, the main Pi session queues a self-contained branch task through `push-task` from `pi-supergsd`.

The branch prompt must start with:

```text
Active task: .trellis/tasks/<task-dir>
```

It should include role instructions, task artifacts, curated JSONL context, and constraints such as no `git commit`, `git push`, or `git merge`.

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
