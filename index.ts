import { isUtf8 } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ──────────────────────────────────────────────────────────────
type JsonObject = Record<string, unknown>;
interface PiExtensionContext {
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
  };
  ui?: {
    notify?: (msg: string, type?: "info" | "warning" | "error") => void;
  };
}

type TrellisAgent = "trellis-implement" | "trellis-check" | "trellis-research";

// ── Constants ─────────────────────────────────────────────────────────
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION_OVERVIEW_TIMEOUT_MS = 1500;
const FIRST_REPLY_NOTICE = `<first-reply-notice>
On the first visible assistant reply in this session, briefly acknowledge that Trellis SessionStart context loaded.
Choose the acknowledgment language in this order:
1. Use the language of the user's current request (the user message that triggered this reply).
2. If that request has no clear natural language, use an explicitly established project communication language.
3. If neither provides a language, output the language-neutral fallback exactly: \`Trellis SessionStart ✓\`.
Continue directly with the user's request after the acknowledgment.
The acknowledgment must not alter the language used for the remainder of the response.
This notice is one-shot: do not repeat it after the first visible assistant reply in this session.
</first-reply-notice>`;
const TRELLIS_AGENT_JSONL: Record<string, string> = {
  "trellis-implement": "implement.jsonl",
  implement: "implement.jsonl",
  "trellis-check": "check.jsonl",
  check: "check.jsonl",
  "trellis-research": "research.jsonl",
  research: "research.jsonl",
};
const TRELLIS_ROLE_FILES: Record<TrellisAgent, string> = {
  "trellis-implement": "trellis-implement.md",
  "trellis-check": "trellis-check.md",
  "trellis-research": "trellis-research.md",
};

// ── Small helpers ─────────────────────────────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function isObj(v: unknown): v is JsonObject {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function exists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function callStr(fn: unknown): string | undefined {
  try {
    return typeof fn === "function" ? str(fn()) : undefined;
  } catch {
    return undefined;
  }
}

function lookupStr(input: unknown, keys: string[]): string | undefined {
  if (!isObj(input)) return undefined;
  for (const key of keys) {
    const value = str(input[key]);
    if (value) return value;
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function cmdHasTrellisCtx(cmd: string): boolean {
  return /\bTRELLIS_CONTEXT_ID\s*=/.test(cmd);
}

function sanitizeContextKey(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 160) || hash(value);
}

function resolveProjectFile(root: string, file: string): string | null {
  try {
    const rootPath = realpathSync(root);
    const filePath = realpathSync(resolve(root, file));
    const rel = relative(rootPath, filePath);
    const isInsideRoot =
      rel === "" ||
      (rel !== ".." &&
        !rel.startsWith("../") &&
        !rel.startsWith("..\\") &&
        !isAbsolute(rel));
    return isInsideRoot ? filePath : null;
  } catch {
    return null;
  }
}

interface ContextInjectionLimits {
  max_file_bytes: number;
  max_artifact_bytes: number;
  max_total_bytes: number;
}

const DEFAULT_CONTEXT_INJECTION_LIMITS: ContextInjectionLimits = {
  max_file_bytes: 32768,
  max_artifact_bytes: 65536,
  max_total_bytes: 131072,
};

function truncateUtf8(buf: Buffer, cap: number): Buffer {
  if (cap <= 0 || buf.length <= cap) return buf;
  let i = cap;
  while (i > 0 && (buf[i - 1]! & 0xc0) === 0x80) i--;
  if (i === 0) return Buffer.alloc(0);
  const lead = buf[i - 1]!;
  if (lead & 0x80) {
    let sequenceLength = 1;
    if ((lead & 0xe0) === 0xc0) sequenceLength = 2;
    else if ((lead & 0xf0) === 0xe0) sequenceLength = 3;
    else if ((lead & 0xf8) === 0xf0) sequenceLength = 4;
    if (i - 1 + sequenceLength > cap) i--;
  }
  return buf.subarray(0, i);
}

function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(value[i - 1]!))) {
      return value.slice(0, i);
    }
  }
  return value;
}

function unquoteYaml(value: string): string {
  if (
    value.length >= 2 &&
    value[0] === value[value.length - 1] &&
    (value[0] === '"' || value[0] === "'")
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readContextInjectionLimits(root: string): ContextInjectionLimits {
  const limits = { ...DEFAULT_CONTEXT_INJECTION_LIMITS };
  const config = readText(join(root, ".trellis", "config.yaml"));
  if (!config) return limits;

  let inSection = false;
  let sectionIndent = -1;
  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!inSection) {
      if (/^context_injection\s*:\s*(#.*)?$/.test(trimmed)) {
        inSection = true;
        sectionIndent = line.length - line.trimStart().length;
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= sectionIndent) break;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    if (!(key in limits)) continue;
    const raw = unquoteYaml(stripInlineComment(match[2]!).trim()).trim();
    if (!/^-?\d+$/.test(raw)) continue;
    const value = Number.parseInt(raw, 10);
    if (value < 0) continue;
    limits[key as keyof ContextInjectionLimits] = value;
  }
  return limits;
}

class ContextBudget {
  private used = 0;

  constructor(private readonly maxTotalBytes: number) {}

  hasRoom(size: number): boolean {
    return this.maxTotalBytes <= 0 || this.used + size <= this.maxTotalBytes;
  }

  add(size: number): void {
    this.used += size;
  }
}

function truncateNotice(path: string, cap: number): string {
  return `\n[Trellis: truncated at ${cap} bytes — read ${path} for the full content]`;
}

function binaryNotice(path: string, size: number, reason: string): string {
  return `[Trellis: not inlined (binary file) — ${path} (${size} bytes): ${reason}]`;
}

function indexNotice(path: string, size: number, reason: string): string {
  return `[Trellis: not inlined (total context limit reached) — ${path} (${size} bytes): ${reason}]`;
}

function readFileBytes(path: string): Buffer | null {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

function budgetedBlock(
  budget: ContextBudget,
  header: string,
  path: string,
  content: string,
  reason: string,
  sourceSize: number,
): string {
  const block = `=== ${header} ===\n${content}`;
  const blockSize = Buffer.byteLength(block, "utf-8");
  if (!budget.hasRoom(blockSize)) {
    const notice = indexNotice(path, sourceSize, reason);
    budget.add(Buffer.byteLength(notice, "utf-8"));
    return notice;
  }
  budget.add(blockSize);
  return block;
}

function materializeFile(
  path: string,
  displayPath: string,
  reason: string,
  limits: ContextInjectionLimits,
  budget: ContextBudget,
): string | null {
  const data = readFileBytes(path);
  if (data === null) return null;
  if (data.includes(0) || !isUtf8(data)) {
    const notice = binaryNotice(displayPath, data.length, reason);
    budget.add(Buffer.byteLength(notice, "utf-8"));
    return notice;
  }
  const truncated = truncateUtf8(data, limits.max_file_bytes);
  let content = truncated.toString("utf-8");
  if (truncated.length < data.length) {
    content += truncateNotice(displayPath, limits.max_file_bytes);
  }
  return budgetedBlock(
    budget,
    displayPath,
    displayPath,
    content,
    reason,
    data.length,
  );
}

function materializeArtifact(
  path: string,
  displayPath: string,
  label: string,
  reason: string,
  limits: ContextInjectionLimits,
  budget: ContextBudget,
): string | null {
  const data = readFileBytes(path);
  if (data === null) return null;
  const truncated = truncateUtf8(data, limits.max_artifact_bytes);
  let content = truncated.toString("utf-8");
  if (truncated.length < data.length) {
    content += truncateNotice(displayPath, limits.max_artifact_bytes);
  }
  return budgetedBlock(
    budget,
    `${displayPath} (${label})`,
    displayPath,
    content,
    reason,
    data.length,
  );
}

// ── Trellis context discovery ─────────────────────────────────────────
function findRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (exists(join(current, ".trellis")) || exists(join(current, ".pi"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function contextKey(input?: unknown, ctx?: PiExtensionContext): string | null {
  const override = str(process.env.TRELLIS_CONTEXT_ID);
  if (override) return sanitizeContextKey(override);

  const sessionId =
    callStr(ctx?.sessionManager?.getSessionId) ??
    str(process.env.PI_SESSION_ID) ??
    str(process.env.PI_SESSIONID) ??
    lookupStr(input, ["session_id", "sessionId", "sessionID"]);
  if (sessionId) return `pi_${sanitizeContextKey(sessionId)}`;

  const transcriptPath =
    callStr(ctx?.sessionManager?.getSessionFile) ??
    lookupStr(input, ["transcript_path", "transcriptPath", "transcript"]);
  if (transcriptPath) return `pi_transcript_${hash(transcriptPath)}`;

  return null;
}

function sessionHasTask(root: string, key: string): boolean {
  try {
    const ctx = JSON.parse(
      readText(join(root, ".trellis", ".runtime", "sessions", `${key}.json`)),
    ) as JsonObject;
    return !!str(ctx.current_task);
  } catch {
    return false;
  }
}

function adoptKey(root: string, key: string): string {
  if (sessionHasTask(root, key)) return key;
  try {
    const dir = join(root, ".trellis", ".runtime", "sessions");
    const keys = readdirSync(dir)
      .filter((file) => file.endsWith(".json") && sessionHasTask(root, file.slice(0, -5)))
      .map((file) => file.slice(0, -5));
    const processKeys = keys.filter((k) => k.startsWith("pi_process_"));
    const candidates = processKeys.length ? processKeys : keys;
    return candidates.length === 1 ? candidates[0]! : key;
  } catch {
    return key;
  }
}

function readTaskDir(root: string, key: string | null): string | null {
  if (!key) return null;
  try {
    const ctx = JSON.parse(
      readText(join(root, ".trellis", ".runtime", "sessions", `${key}.json`)),
    ) as JsonObject;
    let ref = str(ctx.current_task);
    if (!ref) return null;
    ref = ref.replace(/\\/g, "/").replace(/^\.\//, "");
    if (ref.startsWith("tasks/")) ref = `.trellis/${ref}`;
    if (ref.startsWith(".trellis/")) return join(root, ref);
    if (isAbsolute(ref)) return ref;
    return join(root, ".trellis", "tasks", ref);
  } catch {
    return null;
  }
}

function buildManifestContext(
  root: string,
  taskDir: string,
  agent: TrellisAgent,
  limits: ContextInjectionLimits,
  budget: ContextBudget,
): string {
  const jsonlName = TRELLIS_AGENT_JSONL[agent] ?? "";
  if (!jsonlName) return "";

  const chunks: string[] = [];
  for (const line of readText(join(taskDir, jsonlName)).split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const row = JSON.parse(text) as JsonObject;
      const file = typeof row.file === "string" ? row.file.trim() : "";
      if (!file) continue;
      const filePath = resolveProjectFile(root, file);
      if (!filePath) continue;
      const reason = str(row.reason) ?? "-";
      const block = materializeFile(filePath, file, reason, limits, budget);
      if (block) chunks.push(block);
    } catch {
      // Ignore malformed planning seed/example rows.
    }
  }
  return chunks.join("\n\n");
}

function buildTaskContext(root: string, agent: TrellisAgent, key: string | null): string {
  const taskDir = readTaskDir(root, key);
  if (!taskDir) {
    return "No active Trellis task found. Run `python3 ./.trellis/scripts/task.py current --source` or ask the user which task to use before queueing branch work.";
  }

  const limits = readContextInjectionLimits(root);
  const budget = new ContextBudget(limits.max_total_bytes);
  const manifest = buildManifestContext(root, taskDir, agent, limits, budget);
  const relativeTaskDir = relative(root, taskDir).replace(/\\/g, "/");
  const prd = materializeArtifact(
    join(taskDir, "prd.md"),
    `${relativeTaskDir}/prd.md`,
    "Requirements",
    "Requirements document",
    limits,
    budget,
  );
  const design = materializeArtifact(
    join(taskDir, "design.md"),
    `${relativeTaskDir}/design.md`,
    "Technical Design",
    "Technical design document",
    limits,
    budget,
  );
  const implement = materializeArtifact(
    join(taskDir, "implement.md"),
    `${relativeTaskDir}/implement.md`,
    "Execution Plan",
    "Execution plan document",
    limits,
    budget,
  );

  return [
    "## Trellis Task Context",
    `Task directory: ${taskDir}`,
    "",
    prd ?? `(missing) ${relativeTaskDir}/prd.md`,
    design ? `\n${design}` : "",
    implement ? `\n${implement}` : "",
    manifest ? `\n### Curated Spec / Research Context\n${manifest}` : "",
  ].join("\n");
}

function roleDefinitionsContext(): string {
  const sections = (Object.entries(TRELLIS_ROLE_FILES) as [TrellisAgent, string][])
    .map(([agent, file]) => {
      const content = readText(join(PACKAGE_ROOT, "agents", file)).trim();
      return content ? `## ${agent} (${file})\n\n${content}` : "";
    })
    .filter(Boolean);

  if (!sections.length) return "";
  return `<trellis-package-role-definitions>\n${sections.join("\n\n---\n\n")}\n</trellis-package-role-definitions>`;
}

// ── Workflow/session prompt injection ─────────────────────────────────
const WF_RE =
  /\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n([\s\S]*?)\n\s*\[\/workflow-state:\1\]/g;

function workflowBreadcrumb(root: string, key: string | null): string {
  const workflow = readText(join(root, ".trellis", "workflow.md"));
  if (!workflow) return "";

  const templates: Record<string, string> = {};
  for (const match of workflow.matchAll(WF_RE)) {
    const state = match[1] ?? "";
    const body = (match[2] ?? "").trim();
    if (state && body) templates[state] = body;
  }

  const taskDir = readTaskDir(root, key);
  let header = "Status: no_task";
  let lookup = "no_task";
  if (taskDir) {
    try {
      const task = JSON.parse(readText(join(taskDir, "task.json"))) as JsonObject;
      const status = str(task.status) ?? "";
      const id = str(task.id) ?? taskDir.split(/[\\/]/).pop() ?? "";
      if (status) {
        header = `Task: ${id} (${status})`;
        lookup = status;
      }
    } catch {
      // Fall through to no_task guidance.
    }
  }

  const body = templates[lookup] ?? "Refer to workflow.md for current step.";
  return `<workflow-state>\n${header}\n${body}\n</workflow-state>`;
}

function runContextScript(root: string, key: string | null, args: string[]): string {
  const script = join(root, ".trellis", "scripts", "get_context.py");
  if (!exists(script)) return "";
  try {
    const py = process.platform === "win32" ? "python" : "python3";
    const result = spawnSync(py, [script, ...args], {
      cwd: root,
      env: key ? { ...process.env, TRELLIS_CONTEXT_ID: key } : process.env,
      encoding: "utf-8",
      timeout: SESSION_OVERVIEW_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.status !== 0) return "";
    return (result.stdout ?? "").trim();
  } catch {
    return "";
  }
}

function sessionOverview(root: string, key: string | null): string {
  const stdout = runContextScript(root, key, []);
  return stdout ? `<session-overview>\n${stdout}\n</session-overview>` : "";
}

function workflowOverview(root: string, key: string | null): string {
  const stdout = runContextScript(root, key, ["--mode", "phase", "--platform", "pi"]);
  return stdout ? `<trellis-workflow>\n${stdout}\n</trellis-workflow>` : "";
}

function buildStartupContext(root: string, key: string | null, overview: string): string {
  const workflow = workflowOverview(root, key);
  return [
    "<session-context>\nTrellis compact SessionStart context. Use it to orient the session; load details on demand.\n</session-context>",
    FIRST_REPLY_NOTICE,
    overview,
    workflow,
    "<ready>\nUse the current workflow state to decide whether to create, continue, or skip a Trellis task.\n</ready>",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function branchTaskGuidance(root: string, key: string | null): string {
  const taskDir = readTaskDir(root, key);
  const activeTaskLine = taskDir
    ? `Active task: ${taskDir.replace(root + "/", "")}`
    : "Active task: <path from `python3 ./.trellis/scripts/task.py current --source`>";

  return [
    "<trellis-pi-branch-task-guidance>",
    "Trellis is Pi-only in this project. Do not use `trellis_subagent`; that hidden child-process tool has been removed.",
    "When fresh Trellis implement/check/research branch work is useful, queue it through pi-supergsd's `push-task` tool.",
    "The queued prompt must be self-contained and should include:",
    `- first line: ${activeTaskLine}`,
    "- the relevant role definition from this package's `agents/` directory; package role definitions are injected below when available",
    "- task PRD/design/implement context and curated JSONL spec/research context",
    "- explicit constraints: no git commit/push/merge; user starts with `/start-task` and returns with `/finish-task`",
    "Use `push-task` only once per turn and do not mix it with other tool calls.",
    "</trellis-pi-branch-task-guidance>",
    roleDefinitionsContext(),
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Extension ──────────────────────────────────────────────────────────
export default function trellisExtension(pi: {
  on?: (
    event: string,
    handler: (event: unknown, ctx?: PiExtensionContext) => unknown,
  ) => void;
}): void {
  const root = findRoot(process.cwd());
  const processKey = `pi_process_${hash([
    root,
    process.pid,
    Date.now(),
    randomBytes(8).toString("hex"),
  ].join(":"))}`;
  let currentKey: string | null = null;

  const getKey = (input?: unknown, ctx?: PiExtensionContext) => {
    const key = adoptKey(root, contextKey(input, ctx) ?? currentKey ?? processKey);
    currentKey = key;
    return key;
  };

  let turnCache: {
    key: string | null;
    ts: number;
    implementContext: string;
    workflow: string;
    overview: string;
    guidance: string;
  } | null = null;

  const getTurnContext = (key: string | null) => {
    const now = Date.now();
    if (turnCache && turnCache.key === key && now - turnCache.ts < 1500) {
      return turnCache;
    }
    turnCache = {
      key,
      ts: now,
      implementContext: buildTaskContext(root, "trellis-implement", key),
      workflow: workflowBreadcrumb(root, key),
      overview: sessionOverview(root, key),
      guidance: branchTaskGuidance(root, key),
    };
    return turnCache;
  };

  // Keep all system-prompt additions byte-stable so provider prefix caches remain valid.
  // Runtime changes are delivered through persisted hidden custom messages instead.
  const startupContextCache = new Map<string, string>();
  const taskContextSnapshot = new Map<string, string>();
  const guidanceSnapshot = new Map<string, string>();
  const lastSentTaskContext = new Map<string, string>();
  const lastSentGuidance = new Map<string, string>();
  const lastSentRuntimeContext = new Map<string, string>();
  const compactedContexts = new Set<string>();

  const getStartupContext = (
    key: string | null,
    turn: { overview: string },
  ): string => {
    const cacheKey = key ?? "default";
    let startup = startupContextCache.get(cacheKey);
    if (startup === undefined) {
      startup = buildStartupContext(root, key, turn.overview);
      startupContextCache.set(cacheKey, startup);
    }
    return startup;
  };

  pi.on?.("session_start", (event, ctx) => {
    getKey(event, ctx);
    ctx?.ui?.notify?.(
      "Trellis Pi-only context is available. Use /trellis-start to bootstrap, /trellis-continue to resume, and pi-supergsd push-task for branch work.",
      "info",
    );
  });

  pi.on?.("tool_call", (event, ctx) => {
    const key = getKey(event, ctx);
    const ev = event as { toolName?: string; input?: JsonObject };
    if (
      ev.toolName === "bash" &&
      isObj(ev.input) &&
      typeof ev.input.command === "string" &&
      !cmdHasTrellisCtx(ev.input.command)
    ) {
      ev.input.command = `export TRELLIS_CONTEXT_ID=${shellQuote(key)}; ${ev.input.command}`;
    }
  });

  pi.on?.("session_before_compact", (event, ctx) => {
    const key = getKey(event, ctx) ?? "default";
    compactedContexts.add(key);
  });

  pi.on?.("before_agent_start", (event, ctx) => {
    const contextKey = getKey(event, ctx);
    const key = contextKey ?? "default";
    const cur = (event as { systemPrompt?: string }).systemPrompt ?? "";
    const turn = getTurnContext(contextKey);
    const startup = getStartupContext(contextKey, turn);
    const { implementContext: freshTaskContext, workflow, overview, guidance: freshGuidance } =
      turn;

    let taskContext = taskContextSnapshot.get(key);
    if (taskContext === undefined) {
      taskContext = freshTaskContext;
      taskContextSnapshot.set(key, taskContext);
      lastSentTaskContext.set(key, freshTaskContext);
    }

    let guidance = guidanceSnapshot.get(key);
    if (guidance === undefined) {
      guidance = freshGuidance;
      guidanceSnapshot.set(key, guidance);
      lastSentGuidance.set(key, freshGuidance);
    }

    const updates: string[] = [];
    const runtimeContext = [workflow, overview].filter(Boolean).join("\n\n");
    if (
      runtimeContext &&
      (compactedContexts.has(key) || runtimeContext !== lastSentRuntimeContext.get(key))
    ) {
      lastSentRuntimeContext.set(key, runtimeContext);
      updates.push(runtimeContext);
    }
    if (freshTaskContext !== lastSentTaskContext.get(key)) {
      lastSentTaskContext.set(key, freshTaskContext);
      updates.push(
        "<trellis-task-context-update>\nTask context changed on disk. This supersedes the Trellis Task Context in the system prompt.\n\n" +
          freshTaskContext +
          "\n</trellis-task-context-update>",
      );
    }
    if (freshGuidance !== lastSentGuidance.get(key)) {
      lastSentGuidance.set(key, freshGuidance);
      updates.push(
        "<trellis-branch-guidance-update>\nBranch guidance changed. This supersedes the branch guidance in the system prompt.\n\n" +
          freshGuidance +
          "\n</trellis-branch-guidance-update>",
      );
    }
    compactedContexts.delete(key);

    const content = updates.join("\n\n");
    return {
      message: content
        ? {
            customType: "trellis-runtime-context",
            content,
            display: false,
          }
        : undefined,
      systemPrompt: [cur, startup, taskContext, guidance].filter(Boolean).join("\n\n"),
    };
  });

  // A hidden runtime message can be removed by compaction during an agent run.
  // Re-add the latest context non-destructively for post-compaction continuations.
  pi.on?.("context", (event, ctx) => {
    const contextKey = getKey(event, ctx);
    const key = contextKey ?? "default";
    if (!compactedContexts.has(key)) return;

    const messages = (event as { messages?: JsonObject[] }).messages ?? [];
    if (
      messages.some(
        (message) =>
          message.role === "custom" && message.customType === "trellis-runtime-context",
      )
    ) {
      return;
    }

    const turn = getTurnContext(contextKey);
    const taskContext = taskContextSnapshot.get(key) ?? "";
    const guidance = guidanceSnapshot.get(key) ?? "";
    const recoveryParts = [
      [turn.workflow, turn.overview].filter(Boolean).join("\n\n"),
    ];
    if (turn.implementContext !== taskContext) {
      recoveryParts.push(
        `<trellis-task-context-update>\n${turn.implementContext}\n</trellis-task-context-update>`,
      );
    }
    if (turn.guidance !== guidance) {
      recoveryParts.push(
        `<trellis-branch-guidance-update>\n${turn.guidance}\n</trellis-branch-guidance-update>`,
      );
    }
    const recovery = recoveryParts.filter(Boolean).join("\n\n");
    if (!recovery) return;

    return {
      messages: [
        ...messages,
        {
          role: "custom",
          customType: "trellis-runtime-context",
          content: recovery,
          timestamp: Date.now(),
        },
      ],
    };
  });
}
