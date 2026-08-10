import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("index.ts");
const guidanceStart = source.indexOf("function branchTaskGuidance");
const guidanceEnd = source.indexOf("// ── Extension", guidanceStart);
const guidance = source.slice(guidanceStart, guidanceEnd);

test("main-session guidance requires branch dispatch", () => {
  assert.notEqual(guidanceStart, -1);
  assert.notEqual(guidanceEnd, -1);
  assert.match(guidance, /MUST be queued through pi-supergsd's `push-task` tool/);
  assert.match(guidance, /regardless of task size/);
  assert.match(guidance, /explicitly requested direct current-session work/);
  assert.match(guidance, /push-task` is unavailable/);
  assert.match(guidance, /only tool call in that turn/);
});

test("task-result guidance prevents repeated finish-task prompts", () => {
  assert.match(
    guidance,
    /`task-result` only appears after `\/finish-task` has successfully returned/,
  );
  assert.match(guidance, /never ask the user to run `\/finish-task` again/);
  assert.match(guidance, /stale child-branch history/);
});

test("main-session guidance exposes only the branch role catalog", () => {
  assert.match(source, /function roleCatalogContext/);
  assert.match(source, /trellis-package-branch-role-catalog/);
  assert.match(guidance, /roleCatalogContext\(\)/);
  assert.match(source, /ev\.toolName === "push-task"/);
  assert.match(source, /attachBranchRole\(ev\.input\)/);
  assert.doesNotMatch(source, /roleDefinitionsContext/);
  assert.doesNotMatch(guidance, /package role definitions are injected below/);
});

test("all visible branch roles prohibit recursive dispatch", () => {
  for (const path of [
    "agents/trellis-implement.md",
    "agents/trellis-check.md",
    "agents/trellis-research.md",
  ]) {
    assert.match(read(path), /Do NOT queue/);
  }
});

test("all visible branch roles constrain final responses", () => {
  for (const path of [
    "agents/trellis-implement.md",
    "agents/trellis-check.md",
    "agents/trellis-research.md",
  ]) {
    const content = read(path);
    assert.match(content, /final reply MUST contain only/);
    assert.match(content, /\*\*Completed work\*\*/);
    assert.match(content, /\*\*Changed files\*\*/);
    assert.match(content, /\*\*Verification results\*\*/);
    assert.match(content, /\*\*Blockers\*\*/);
    assert.match(content, /Do not include branch-navigation instructions/);
    assert.match(content, /run `\/finish-task`/);
  }
});

test("workflow-facing resources repeat the dispatch gate", () => {
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
    assert.match(content, /regardless of (task )?size|regardless of diff size/);
  }
});
