import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

test("archived task context remaps historical self-references safely", () => {
  const start = source.indexOf("function resolveManifestFile");
  const end = source.indexOf("function buildManifestContext", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const resolver = source.slice(start, end);
  assert.match(resolver, /relative\(realpathSync\(root\), taskDir\)/);
  assert.match(source, /const historicalRoot = `\.trellis\/tasks\/\$\{taskParts\[4\]\}`/);
  assert.match(source, /relativeParts\.some/);
  assert.match(source, /part === "\."/);
  assert.match(source, /part === "\.\."/);
  assert.match(source, /return resolveProjectFile\(taskDir, relativePath\);/);
  assert.match(source, /str\(row\.file\) \?\? str\(row\.path\)/);
  assert.match(source, /resolveManifestFile\(root, taskDir, file\)/);
});

test("active task directories remain project-root-bound", () => {
  const start = source.indexOf("function readTaskDir");
  const end = source.indexOf("function resolveManifestFile", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const reader = source.slice(start, end);
  assert.match(reader, /return resolveProjectPath\(root, target\);/);
  assert.doesNotMatch(reader, /return ref;/);
  assert.match(
    source,
    /`Active task: \$\{relative\(realpathSync\(root\), taskDir\)\.replace/,
  );
  assert.match(source, /const relativeTaskDir = relative\(realpathSync\(root\), taskDir\)/);
});
