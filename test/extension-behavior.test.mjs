import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import trellisExtension from "../index.ts";

const require = createRequire(import.meta.url);
const packageIndex = fileURLToPath(new URL("../index.ts", import.meta.url));
const packageRoot = dirname(packageIndex);

function tempDir(t) {
  const path = mkdtempSync(join(tmpdir(), "pi-trellis-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function project(t) {
  const root = tempDir(t);
  mkdirSync(join(root, ".trellis", "tasks"), { recursive: true });
  return root;
}

function task(root, name, prd = `PRD:${name}`) {
  const path = join(root, ".trellis", "tasks", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "task.json"), JSON.stringify({ id: name, status: "in_progress" }));
  writeFileSync(join(path, "prd.md"), prd);
  return path;
}

function writeSession(root, sessionId, taskPath) {
  const sessions = join(root, ".trellis", ".runtime", "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(
    join(sessions, `pi_${sessionId}.json`),
    JSON.stringify({ current_task: taskPath }),
  );
}

function withCwd(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

async function withCwdAsync(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

function harness(cwd) {
  const handlers = new Map();
  withCwd(cwd, () => {
    trellisExtension({
      on(event, handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    });
  });
  return handlers;
}

async function emit(handlers, event, data, ctx) {
  const list = handlers.get(event) ?? [];
  assert.equal(list.length, 1, `expected one ${event} handler`);
  return await list[0](data, ctx);
}

function sessionState(sessionId = "test") {
  let branch = [];
  return {
    ctx: {
      sessionManager: {
        getSessionId: () => sessionId,
        getBranch: () => branch,
      },
    },
    setBranch(value) {
      branch = value;
    },
  };
}

function userMessage(text) {
  return {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function toolBatch(calls) {
  return [
    {
      type: "message",
      message: {
        role: "assistant",
        content: calls.map(({ id, name, input = {} }) => ({
          type: "toolCall",
          id,
          name,
          arguments: input,
        })),
      },
    },
  ];
}

function queuedPrompt(taskPath, role, body = "Do the work.") {
  return `Active task: ${taskPath}\nBranch role: ${role}\n${body}`;
}

function hiddenContent(result) {
  return result?.message?.content ?? "";
}

function customContent(result) {
  return result?.messages?.at(-1)?.content ?? "";
}

function read(relativePath) {
  return readFileSync(join(packageRoot, relativePath), "utf8");
}

test("ordinary projects are a complete no-op, while .pi does not stop root discovery", (t) => {
  const plain = tempDir(t);
  const plainNested = join(plain, "app", ".pi", "nested");
  mkdirSync(plainNested, { recursive: true });
  writeFileSync(join(plain, ".trellis"), "not a directory");
  assert.equal(harness(plainNested).size, 0);

  const root = project(t);
  const nested = join(root, "app", ".pi", "nested");
  mkdirSync(nested, { recursive: true });
  assert.deepEqual(
    [...harness(nested).keys()].sort(),
    [
      "before_agent_start",
      "context",
      "session_before_compact",
      "session_start",
      "tool_call",
    ],
  );
});

test("push-task validates Active task and exactly one supported role", async (t) => {
  const root = project(t);
  task(root, "task-a");
  task(root, "archive/2026-08/task-z");
  mkdirSync(join(root, "src"));
  const prdOnly = join(root, ".trellis", "tasks", "prd-only");
  mkdirSync(prdOnly);
  writeFileSync(join(prdOnly, "prd.md"), "missing task metadata");
  const metadataOnly = join(root, ".trellis", "tasks", "metadata-only");
  mkdirSync(metadataOnly);
  writeFileSync(join(metadataOnly, "task.json"), "{}");
  task(root, "archive/not-a-month/task-z");
  const handlers = harness(root);
  const state = sessionState("push-validation");

  const validInput = {
    title: "Check task",
    prompt: queuedPrompt(".trellis/tasks/task-a", "trellis-check"),
  };
  state.setBranch(toolBatch([{ id: "valid", name: "push-task", input: validInput }]));
  assert.equal(
    await emit(
      handlers,
      "tool_call",
      { toolCallId: "valid", toolName: "push-task", input: validInput },
      state.ctx,
    ),
    undefined,
  );
  assert.match(validInput.prompt, /--- Package branch role: trellis-check ---/);
  assert.match(validInput.prompt, /# Check Agent/);

  const embeddedRoleInput = {
    title: "Check embedded role",
    prompt: queuedPrompt(
      ".trellis/tasks/task-a",
      "trellis-check",
      read("agents/trellis-check.md"),
    ),
  };
  state.setBranch(
    toolBatch([{ id: "embedded-role", name: "push-task", input: embeddedRoleInput }]),
  );
  assert.equal(
    await emit(
      handlers,
      "tool_call",
      { toolCallId: "embedded-role", toolName: "push-task", input: embeddedRoleInput },
      state.ctx,
    ),
    undefined,
  );
  const attachedPrompt = embeddedRoleInput.prompt;
  assert.match(attachedPrompt, /--- Package branch role: trellis-check ---/);
  assert.equal(
    await emit(
      handlers,
      "tool_call",
      { toolCallId: "embedded-role", toolName: "push-task", input: embeddedRoleInput },
      state.ctx,
    ),
    undefined,
  );
  assert.equal(embeddedRoleInput.prompt, attachedPrompt);

  for (const [id, input] of [
    ["missing-title", { prompt: validInput.prompt }],
    ["non-string-prompt", { title: "Bad prompt", prompt: 42 }],
  ]) {
    state.setBranch(toolBatch([{ id, name: "push-task", input }]));
    const result = await emit(
      handlers,
      "tool_call",
      { toolCallId: id, toolName: "push-task", input },
      state.ctx,
    );
    assert.equal(result.block, true);
    assert.match(result.reason, /requires string `\{title, prompt\}` arguments/);
  }

  const archivedInput = {
    title: "Research archived task",
    prompt: queuedPrompt(
      ".trellis/tasks/archive/2026-08/task-z",
      "trellis-research",
    ),
  };
  state.setBranch(
    toolBatch([{ id: "archived", name: "push-task", input: archivedInput }]),
  );
  assert.equal(
    await emit(
      handlers,
      "tool_call",
      { toolCallId: "archived", toolName: "push-task", input: archivedInput },
      state.ctx,
    ),
    undefined,
  );

  const cases = [
    {
      name: "missing role",
      prompt: "Active task: .trellis/tasks/task-a\nDo work.",
      reason: /exactly one `Branch role:/,
    },
    {
      name: "duplicate role",
      prompt:
        "Active task: .trellis/tasks/task-a\nBranch role: trellis-check\nBranch role: trellis-research",
      reason: /exactly one `Branch role:/,
    },
    {
      name: "unsupported role",
      prompt: "Active task: .trellis/tasks/task-a\nBranch role: trellis-update-spec",
      reason: /branch role must be/,
    },
    {
      name: "missing Active task first line",
      prompt: "Branch role: trellis-check\nActive task: .trellis/tasks/task-a",
      reason: /prompt first line must be/,
    },
    {
      name: "missing task directory",
      prompt: "Active task: .trellis/tasks/missing\nBranch role: trellis-check",
      reason: /usable task under \.trellis\/tasks/,
    },
    {
      name: "project root is not a task",
      prompt: "Active task: .\nBranch role: trellis-check",
      reason: /usable task under \.trellis\/tasks/,
    },
    {
      name: "source directory is not a task",
      prompt: "Active task: src\nBranch role: trellis-check",
      reason: /usable task under \.trellis\/tasks/,
    },
    {
      name: "task metadata is required",
      prompt: "Active task: .trellis/tasks/prd-only\nBranch role: trellis-check",
      reason: /task\.json and prd\.md/,
    },
    {
      name: "task PRD is required",
      prompt: "Active task: .trellis/tasks/metadata-only\nBranch role: trellis-check",
      reason: /task\.json and prd\.md/,
    },
    {
      name: "archive month must be valid",
      prompt:
        "Active task: .trellis/tasks/archive/not-a-month/task-z\nBranch role: trellis-check",
      reason: /usable task under \.trellis\/tasks/,
    },
  ];

  for (const [index, entry] of cases.entries()) {
    const id = `invalid-${index}`;
    const input = { title: entry.name, prompt: entry.prompt };
    state.setBranch(toolBatch([{ id, name: "push-task", input }]));
    const result = await emit(
      handlers,
      "tool_call",
      { toolCallId: id, toolName: "push-task", input },
      state.ctx,
    );
    assert.equal(result.block, true, entry.name);
    assert.match(result.reason, entry.reason, entry.name);
    assert.doesNotMatch(input.prompt, /Package branch role:/, entry.name);
  }

  const outside = tempDir(t);
  const outsideInput = {
    title: "Outside",
    prompt: queuedPrompt(outside, "trellis-implement"),
  };
  state.setBranch(toolBatch([{ id: "outside", name: "push-task", input: outsideInput }]));
  const outsideResult = await emit(
    handlers,
    "tool_call",
    { toolCallId: "outside", toolName: "push-task", input: outsideInput },
    state.ctx,
  );
  assert.equal(outsideResult.block, true);
  assert.match(outsideResult.reason, /usable task under \.trellis\/tasks/);
});

test("push-task blocks itself and every sibling in the same assistant batch", async (t) => {
  const root = project(t);
  task(root, "task-a");
  const handlers = harness(root);
  const state = sessionState("batch");
  const pushInput = {
    title: "Implement",
    prompt: queuedPrompt(".trellis/tasks/task-a", "trellis-implement"),
  };
  const bashInput = { command: "printf sibling" };
  state.setBranch(
    toolBatch([
      { id: "bash-first", name: "bash", input: bashInput },
      { id: "push-second", name: "push-task", input: pushInput },
    ]),
  );

  const bashResult = await emit(
    handlers,
    "tool_call",
    { toolCallId: "bash-first", toolName: "bash", input: bashInput },
    state.ctx,
  );
  const pushResult = await emit(
    handlers,
    "tool_call",
    { toolCallId: "push-second", toolName: "push-task", input: pushInput },
    state.ctx,
  );

  assert.equal(bashResult.block, true);
  assert.equal(pushResult.block, true);
  assert.match(bashResult.reason, /only tool call/);
  assert.match(pushResult.reason, /only tool call/);
  assert.equal(bashInput.command, "printf sibling");
  assert.doesNotMatch(pushInput.prompt, /Package branch role:/);
});

test("unverifiable batches block every tool before mutation", async (t) => {
  const root = project(t);
  task(root, "task-a");
  const handlers = harness(root);
  const state = sessionState("unknown-batch");
  const bashInput = { command: "printf unknown" };
  const pushInput = {
    title: "Unknown",
    prompt: queuedPrompt(".trellis/tasks/task-a", "trellis-check"),
  };

  for (const event of [
    { toolCallId: "unknown-bash", toolName: "bash", input: bashInput },
    { toolCallId: "unknown-push", toolName: "push-task", input: pushInput },
  ]) {
    const result = await emit(handlers, "tool_call", event, state.ctx);
    assert.equal(result.block, true);
    assert.match(result.reason, /cannot verify/);
  }
  assert.equal(bashInput.command, "printf unknown");
  assert.doesNotMatch(pushInput.prompt, /Package branch role:/);

  state.setBranch(toolBatch([{ id: "known-bash", name: "bash", input: bashInput }]));
  assert.equal(
    await emit(
      handlers,
      "tool_call",
      { toolCallId: "known-bash", toolName: "bash", input: bashInput },
      state.ctx,
    ),
    undefined,
  );
  assert.match(bashInput.command, /TRELLIS_CONTEXT_ID='pi_unknown-batch'/);
});

test("Trellis bash calls receive the current context key", async (t) => {
  const root = project(t);
  const handlers = harness(root);
  const state = sessionState("bash-key");
  const input = { command: "printf ok" };
  state.setBranch(toolBatch([{ id: "bash", name: "bash", input }]));

  assert.equal(
    await emit(
      handlers,
      "tool_call",
      { toolCallId: "bash", toolName: "bash", input },
      state.ctx,
    ),
    undefined,
  );
  assert.match(input.command, /^export TRELLIS_CONTEXT_ID='pi_bash-key'; printf ok$/);
});

test("automatic compaction re-sends latest context once without prompt growth", async (t) => {
  const root = project(t);
  task(root, "task-a", "TASK_VERSION_A");
  task(root, "task-b", "TASK_VERSION_B");
  writeSession(root, "compact", ".trellis/tasks/task-a");
  const handlers = harness(root);
  const state = sessionState("compact");

  const first = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "first" },
    state.ctx,
  );
  assert.match(first.systemPrompt, /TASK_VERSION_A/);

  writeSession(root, "compact", ".trellis/tasks/task-b");
  const changed = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "second" },
    state.ctx,
  );
  assert.equal(changed.systemPrompt, first.systemPrompt);
  assert.match(hiddenContent(changed), /trellis-task-context-update/);
  assert.match(hiddenContent(changed), /trellis-branch-guidance-update/);
  assert.match(hiddenContent(changed), /TASK_VERSION_B/);
  assert.match(hiddenContent(changed), /Active task: \.trellis\/tasks\/task-b/);

  await emit(handlers, "session_before_compact", { reason: "threshold" }, state.ctx);
  const contextRecovery = await emit(
    handlers,
    "context",
    { messages: [] },
    state.ctx,
  );
  assert.match(customContent(contextRecovery), /TASK_VERSION_B/);
  assert.match(customContent(contextRecovery), /Active task: \.trellis\/tasks\/task-b/);
  assert.equal(
    await emit(
      handlers,
      "context",
      { messages: contextRecovery.messages },
      state.ctx,
    ),
    undefined,
  );
  const repeatedProviderRecovery = await emit(
    handlers,
    "context",
    { messages: [] },
    state.ctx,
  );
  assert.match(customContent(repeatedProviderRecovery), /TASK_VERSION_B/);

  const nextTurn = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "after compact" },
    state.ctx,
  );
  assert.equal(nextTurn.systemPrompt, first.systemPrompt);
  assert.match(hiddenContent(nextTurn), /trellis-task-context-update/);
  assert.match(hiddenContent(nextTurn), /trellis-branch-guidance-update/);
  assert.match(hiddenContent(nextTurn), /TASK_VERSION_B/);
  assert.match(hiddenContent(nextTurn), /Active task: \.trellis\/tasks\/task-b/);
});

test("visible check and research branches keep role-specific context", async (t) => {
  const root = project(t);
  const mainTask = task(root, "task-main", "MAIN_PRD_ARTIFACT");
  const checkTask = task(root, "task-check", "CHECK_PRD_VERSION_A");
  const researchTask = task(root, "task-research", "RESEARCH_PRD_ARTIFACT");
  writeFileSync(join(root, "implement-spec.md"), "IMPLEMENT_MANIFEST_ONLY");
  writeFileSync(join(root, "check-spec.md"), "CHECK_MANIFEST_ONLY");
  writeFileSync(join(root, "research-spec.md"), "RESEARCH_MANIFEST_ONLY");
  writeFileSync(
    join(mainTask, "implement.jsonl"),
    JSON.stringify({ file: "implement-spec.md", reason: "implement" }),
  );
  writeFileSync(
    join(checkTask, "check.jsonl"),
    JSON.stringify({ file: "check-spec.md", reason: "check" }),
  );
  writeFileSync(
    join(researchTask, "research.jsonl"),
    JSON.stringify({ file: "research-spec.md", reason: "research" }),
  );
  writeSession(root, "roles", ".trellis/tasks/task-main");

  const handlers = harness(root);
  const state = sessionState("roles");
  const main = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "main" },
    state.ctx,
  );
  assert.match(main.systemPrompt, /MAIN_PRD_ARTIFACT/);
  assert.match(main.systemPrompt, /IMPLEMENT_MANIFEST_ONLY/);
  assert.doesNotMatch(main.systemPrompt, /CHECK_MANIFEST_ONLY|RESEARCH_MANIFEST_ONLY/);

  const parentPending = {
    type: "custom",
    customType: "task",
    data: {
      prompt: queuedPrompt(".trellis/tasks/task-research", "trellis-research"),
    },
  };
  const checkPrompt = queuedPrompt(".trellis/tasks/task-check", "trellis-check");
  state.setBranch([
    parentPending,
    { type: "custom", customType: "task-start", id: "check-start" },
    userMessage(checkPrompt),
    userMessage("Later check-branch turn without role metadata."),
  ]);
  const check = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "follow-up" },
    state.ctx,
  );
  assert.equal(check.systemPrompt, main.systemPrompt);
  assert.match(hiddenContent(check), /CHECK_PRD_VERSION_A/);
  assert.match(hiddenContent(check), /CHECK_MANIFEST_ONLY/);
  assert.doesNotMatch(
    hiddenContent(check),
    /MAIN_PRD_ARTIFACT|IMPLEMENT_MANIFEST_ONLY|RESEARCH_MANIFEST_ONLY/,
  );

  const stableCheck = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "another follow-up" },
    state.ctx,
  );
  assert.equal(stableCheck.message, undefined);

  writeFileSync(join(checkTask, "prd.md"), "CHECK_PRD_VERSION_B");
  await emit(handlers, "session_before_compact", { reason: "manual" }, state.ctx);
  const recoveredCheck = await emit(
    handlers,
    "context",
    { messages: [] },
    state.ctx,
  );
  assert.match(customContent(recoveredCheck), /CHECK_PRD_VERSION_B/);
  assert.match(customContent(recoveredCheck), /CHECK_MANIFEST_ONLY/);
  assert.doesNotMatch(
    customContent(recoveredCheck),
    /CHECK_PRD_VERSION_A|MAIN_PRD_ARTIFACT|RESEARCH_MANIFEST_ONLY/,
  );
  const repeatedCheckRecovery = await emit(
    handlers,
    "context",
    { messages: [] },
    state.ctx,
  );
  assert.match(customContent(repeatedCheckRecovery), /CHECK_PRD_VERSION_B/);
  await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "settle compact" },
    state.ctx,
  );

  const researchPrompt = queuedPrompt(
    ".trellis/tasks/task-research",
    "trellis-research",
  );
  state.setBranch([
    parentPending,
    { type: "custom", customType: "task-start", id: "research-start" },
    userMessage(researchPrompt),
    userMessage("Later research-branch turn without role metadata."),
  ]);
  const research = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "follow-up" },
    state.ctx,
  );
  assert.equal(research.systemPrompt, main.systemPrompt);
  assert.match(hiddenContent(research), /RESEARCH_PRD_ARTIFACT/);
  assert.match(hiddenContent(research), /RESEARCH_MANIFEST_ONLY/);
  assert.doesNotMatch(
    hiddenContent(research),
    /CHECK_PRD_VERSION_B|CHECK_MANIFEST_ONLY|IMPLEMENT_MANIFEST_ONLY/,
  );

  state.setBranch([]);
  const returnedMain = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "back on main" },
    state.ctx,
  );
  assert.equal(returnedMain.systemPrompt, main.systemPrompt);
  assert.match(hiddenContent(returnedMain), /MAIN_PRD_ARTIFACT/);
  assert.match(hiddenContent(returnedMain), /IMPLEMENT_MANIFEST_ONLY/);
  assert.doesNotMatch(
    hiddenContent(returnedMain),
    /CHECK_MANIFEST_ONLY|RESEARCH_MANIFEST_ONLY/,
  );
});

test("archived manifests remap self-references without traversal", async (t) => {
  const root = project(t);
  const archived = join(root, ".trellis", "tasks", "archive", "2026-08", "task-a");
  mkdirSync(archived, { recursive: true });
  writeFileSync(join(archived, "prd.md"), "ARCHIVED_PRD");
  writeFileSync(join(archived, "spec.md"), "ARCHIVED_SELF_REFERENCE");
  writeFileSync(
    join(archived, "implement.jsonl"),
    [
      JSON.stringify({ file: ".trellis/tasks/task-a/spec.md", reason: "self" }),
      JSON.stringify({ file: ".trellis/tasks/task-a/../outside.md", reason: "bad" }),
    ].join("\n"),
  );
  writeFileSync(join(root, ".trellis", "tasks", "outside.md"), "TRAVERSAL_MUST_NOT_LOAD");
  writeSession(root, "archive", ".trellis/tasks/archive/2026-08/task-a");

  const handlers = harness(root);
  const state = sessionState("archive");
  const result = await emit(
    handlers,
    "before_agent_start",
    { systemPrompt: "BASE", prompt: "archive" },
    state.ctx,
  );
  assert.match(result.systemPrompt, /ARCHIVED_PRD/);
  assert.match(result.systemPrompt, /ARCHIVED_SELF_REFERENCE/);
  assert.doesNotMatch(result.systemPrompt, /TRAVERSAL_MUST_NOT_LOAD/);
});

test("role and workflow resources match the Phase 3 contract", () => {
  for (const path of [
    "agents/trellis-implement.md",
    "agents/trellis-check.md",
    "agents/trellis-research.md",
  ]) {
    const content = read(path);
    assert.match(content, /Do NOT queue/);
    for (const heading of [
      "Completed work",
      "Changed files",
      "Verification results",
      "Blockers",
    ]) {
      assert.match(content, new RegExp(`\\*\\*${heading}\\*\\*`));
    }
    assert.match(content, /Do not include branch-navigation instructions/);
  }

  const research = read("agents/trellis-research.md");
  assert.ok(research.indexOf("first line") < research.indexOf("task.py current --source"));
  assert.match(research, /Never replace a valid prompt path with the runtime current task/);

  for (const path of [
    "README.md",
    "skills/trellis-before-dev/SKILL.md",
    "skills/trellis-brainstorm/SKILL.md",
    "skills/trellis-check/SKILL.md",
    "skills/trellis-meta/SKILL.md",
    "prompts/trellis-start.md",
    "prompts/trellis-continue.md",
  ]) {
    const content = read(path);
    assert.match(content, /push-task/);
    assert.match(content, /\.trellis\/spec/);
    assert.doesNotMatch(content, /regardless of (task )?size|regardless of diff size/);
  }

  const quickReference = read(
    "skills/trellis-session-insight/references/cli-quick-reference.md",
  );
  for (const command of ["list", "search", "context", "extract", "projects"]) {
    assert.match(quickReference, new RegExp(`trellis mem ${command}`));
  }
  assert.doesNotMatch(quickReference, /trellis mem show/);

  const readme = read("README.md");
  assert.match(readme, /optional, separately installed global Trellis CLI/);
  assert.match(readme, /^\/start-task \[model\]$/m);
  assert.match(readme, /`pi-supergsd` 0\.2\.9 requires both fields/);
  assert.doesNotMatch(readme, /First-pass|This checkout's project `\.pi\/settings\.json`/);

  const meta = read("skills/trellis-meta/SKILL.md");
  assert.match(meta, /Package-Owned Architecture/);
  assert.match(meta, /Target-Project-Owned State/);
  assert.doesNotMatch(meta, /being rebaselined/);
});

function packageDir(name) {
  const candidates = [];
  try {
    candidates.push(dirname(require.resolve(`${name}/package.json`)));
  } catch {
    // Try known package roots below.
  }

  const moduleRoots = [
    join(homedir(), ".pi", "agent", "npm", "node_modules"),
    process.env.PI_AGENT_DIR
      ? join(process.env.PI_AGENT_DIR, "npm", "node_modules")
      : null,
  ];
  try {
    moduleRoots.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
  } catch {
    // Global npm packages are optional for this integration test.
  }
  for (const root of moduleRoots.filter(Boolean)) {
    candidates.push(join(root, ...name.split("/")));
  }

  for (const candidate of candidates) {
    try {
      const metadata = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8"));
      if (metadata.name === name) return candidate;
    } catch {
      // Continue searching.
    }
  }
  return null;
}

test("Pi 0.84.1 parallel execution blocks every push-task sibling", async (t) => {
  const piRoot = packageDir("@earendil-works/pi-coding-agent");
  if (!piRoot) {
    return t.skip("optional integration skipped: Pi 0.84.1 is unavailable");
  }

  const piPackage = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8"));
  if (piPackage.version !== "0.84.1") {
    return t.skip(`optional integration skipped: Pi ${piPackage.version} is not 0.84.1`);
  }

  const corePath = join(
    piRoot,
    "node_modules",
    "@earendil-works",
    "pi-agent-core",
    "dist",
    "index.js",
  );
  const aiPath = join(
    piRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
    "dist",
    "index.js",
  );
  if (!existsSync(corePath) || !existsSync(aiPath)) {
    return t.skip("optional integration skipped: Pi agent-core runtime is unavailable");
  }

  const [{ runAgentLoop }, { createAssistantMessageEventStream, Type }] =
    await Promise.all([
      import(pathToFileURL(corePath).href),
      import(pathToFileURL(aiPath).href),
    ]);
  const root = project(t);
  task(root, "task-a");
  const handlers = harness(root);
  const state = sessionState("parallel-batch");
  const executions = [];
  const preflights = [];
  const schemas = {
    bash: Type.Object({ command: Type.String() }),
    "push-task": Type.Object({ title: Type.String(), prompt: Type.String() }),
  };
  const tools = Object.entries(schemas).map(([name, parameters]) => ({
    name,
    label: name,
    description: name,
    parameters,
    async execute(_toolCallId, args) {
      executions.push({ name, args });
      return { content: [{ type: "text", text: "executed" }], details: {} };
    },
  }));
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const model = {
    id: "test",
    name: "test",
    api: "openai-completions",
    provider: "test",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1024,
    maxTokens: 128,
  };

  async function runBatch(calls) {
    const message = {
      role: "assistant",
      content: calls.map(({ id, name, input }) => ({
        type: "toolCall",
        id,
        name,
        arguments: input,
      })),
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage,
      stopReason: "toolUse",
      timestamp: Date.now(),
    };
    await runAgentLoop(
      [{ role: "user", content: "run tools", timestamp: Date.now() }],
      { systemPrompt: "", messages: [], tools },
      {
        model,
        convertToLlm: (messages) => messages,
        shouldStopAfterTurn: () => true,
        beforeToolCall: async ({ assistantMessage, toolCall, args }) => {
          preflights.push(toolCall.id);
          state.setBranch([{ type: "message", message: assistantMessage }]);
          return await emit(
            handlers,
            "tool_call",
            { toolCallId: toolCall.id, toolName: toolCall.name, input: args },
            state.ctx,
          );
        },
      },
      () => {},
      undefined,
      () => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() =>
          stream.push({ type: "done", reason: "toolUse", message }),
        );
        return stream;
      },
    );
  }

  const push = (id) => ({
    id,
    name: "push-task",
    input: {
      title: id,
      prompt: queuedPrompt(".trellis/tasks/task-a", "trellis-check"),
    },
  });
  const bash = (id) => ({ id, name: "bash", input: { command: `printf ${id}` } });

  for (const calls of [
    [bash("bash-first"), push("push-second")],
    [push("push-first"), bash("bash-second")],
    [push("push-one"), push("push-two")],
  ]) {
    const before = preflights.length;
    await runBatch(calls);
    assert.deepEqual(preflights.slice(before), calls.map((call) => call.id));
    assert.equal(executions.length, 0);
  }

  await runBatch([bash("next-turn-bash")]);
  assert.equal(executions.length, 1, "blocked batch state must not leak into next turn");
  assert.equal(executions[0].name, "bash");
  assert.match(executions[0].args.command, /TRELLIS_CONTEXT_ID='pi_parallel-batch'/);
});

test("pi-supergsd 0.2.9 official loader path stores the gated prompt", async (t) => {
  const piRoot = packageDir("@earendil-works/pi-coding-agent");
  const supergsdRoot = packageDir("pi-supergsd");
  if (!piRoot || !supergsdRoot) {
    return t.skip(
      "optional integration skipped: Pi official loader or pi-supergsd is unavailable",
    );
  }

  const supergsdPackage = JSON.parse(
    readFileSync(join(supergsdRoot, "package.json"), "utf8"),
  );
  if (supergsdPackage.version !== "0.2.9") {
    return t.skip(
      `optional integration skipped: pi-supergsd ${supergsdPackage.version} is not 0.2.9`,
    );
  }

  const loaderPath = join(piRoot, "dist", "core", "extensions", "loader.js");
  if (!existsSync(loaderPath)) {
    return t.skip("optional integration skipped: Pi official extension loader is unavailable");
  }
  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);

  const root = project(t);
  task(root, "task-a");
  const loaded = await withCwdAsync(root, () =>
    loadExtensions([packageIndex, join(supergsdRoot, "index.ts")], root),
  );
  assert.deepEqual(loaded.errors, []);

  const trellis = loaded.extensions.find(
    (extension) => realpathSync(extension.resolvedPath) === realpathSync(packageIndex),
  );
  const supergsd = loaded.extensions.find((extension) => extension.tools.has("push-task"));
  assert.ok(trellis, "pi-trellis loaded through official loader");
  assert.ok(supergsd, "pi-supergsd loaded through official loader");

  const input = {
    title: "Stored title",
    prompt: queuedPrompt(".trellis/tasks/task-a", "trellis-research"),
  };
  const state = sessionState("official-loader");
  state.setBranch(toolBatch([{ id: "store", name: "push-task", input }]));
  for (const handler of trellis.handlers.get("tool_call") ?? []) {
    const gate = await handler(
      { toolCallId: "store", toolName: "push-task", input },
      state.ctx,
    );
    assert.equal(gate, undefined);
  }

  const registered = supergsd.tools.get("push-task");
  assert.ok(registered);
  assert.deepEqual(
    [...registered.definition.parameters.required].sort(),
    ["prompt", "title"],
  );

  const stored = [];
  loaded.runtime.appendEntry = (customType, data) => {
    stored.push({ customType, data });
    return "stored-entry";
  };
  const result = await registered.definition.execute(
    "store",
    input,
    undefined,
    undefined,
    { hasUI: false },
  );

  assert.equal(result.terminate, true);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].customType, "task");
  assert.equal(stored[0].data.title, "Stored title");
  assert.match(stored[0].data.prompt, /^Active task: \.trellis\/tasks\/task-a/m);
  assert.match(stored[0].data.prompt, /Branch role: trellis-research/);
  assert.match(stored[0].data.prompt, /--- Package branch role: trellis-research ---/);
  assert.match(stored[0].data.prompt, /# Research Agent/);
});
