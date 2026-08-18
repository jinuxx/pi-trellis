import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("index.ts");
const guidanceStart = source.indexOf("function branchTaskGuidance");
const guidanceEnd = source.indexOf("// ── Extension", guidanceStart);
const guidance = source.slice(guidanceStart, guidanceEnd);

test("main-session guidance matches the Phase 3 dispatch boundary", () => {
  assert.notEqual(guidanceStart, -1);
  assert.notEqual(guidanceEnd, -1);
  assert.match(guidance, /implementation, check\/fix, and task research work/);
  assert.match(guidance, /explicitly requests current-session execution/);
  assert.match(guidance, /Phase 3 `\.trellis\/spec` updates/);
  assert.match(guidance, /There is no update-spec branch role/);
  assert.match(guidance, /push-task` is unavailable/);
  assert.match(guidance, /only tool call in that assistant batch/);
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
  assert.match(source, /trellis-package-branch-role-catalog/);
  assert.match(guidance, /roleCatalogContext\(\)/);
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

test("v0.6.15 guidance keeps implementation and fixes in scope", () => {
  const beforeDev = read("skills/trellis-before-dev/SKILL.md");
  assert.match(beforeDev, /state the change boundary before writing code/);
  assert.match(beforeDev, /Do not widen the change on your own/);

  const checkSkill = read("skills/trellis-check/SKILL.md");
  assert.match(checkSkill, /### Scope Discipline/);
  assert.match(checkSkill, /Mechanical and local/);
  assert.match(checkSkill, /changing a public interface/);

  const checkRole = read("agents/trellis-check.md");
  assert.match(checkRole, /Fix mechanical, local issues directly/);
  assert.match(checkRole, /public interfaces, module boundaries/);
});

test("workflow-facing resources repeat the Phase 3 boundary", () => {
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
});
