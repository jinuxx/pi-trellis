import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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

function buildManifestContext(root: string, taskDir: string, agent: TrellisAgent): string {
  const jsonlName = TRELLIS_AGENT_JSONL[agent] ?? "";
  if (!jsonlName) return "";

  const chunks: string[] = [];
  for (const line of readText(join(taskDir, jsonlName)).split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      const row = JSON.parse(text) as JsonObject;
      const file = typeof row.file === "string" ? row.file : "";
      if (!file) continue;
      const content = readText(join(root, file));
      if (content) chunks.push(`## ${file}\n\n${content}`);
    } catch {
      // Ignore malformed planning seed/example rows.
    }
  }
  return chunks.join("\n\n---\n\n");
}

function buildTaskContext(root: string, agent: TrellisAgent, key: string | null): string {
  const taskDir = readTaskDir(root, key);
  if (!taskDir) {
    return "No active Trellis task found. Run `python3 ./.trellis/scripts/task.py current --source` or ask the user which task to use before queueing branch work.";
  }

  const prd = readText(join(taskDir, "prd.md"));
  const design = readText(join(taskDir, "design.md"));
  const implement = readText(join(taskDir, "implement.md"));
  const manifest = buildManifestContext(root, taskDir, agent);

  return [
    "## Trellis Task Context",
    `Task directory: ${taskDir}`,
    "",
    "### prd.md",
    prd || "(missing)",
    design ? `\n### design.md\n${design}` : "",
    implement ? `\n### implement.md\n${implement}` : "",
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

function sessionOverview(root: string, key: string | null): string {
  const script = join(root, ".trellis", "scripts", "get_context.py");
  if (!exists(script)) return "";
  try {
    const py = process.platform === "win32" ? "python" : "python3";
    const result = spawnSync(py, [script], {
      cwd: root,
      env: key ? { ...process.env, TRELLIS_CONTEXT_ID: key } : process.env,
      encoding: "utf-8",
      timeout: SESSION_OVERVIEW_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.status !== 0) return "";
    const stdout = (result.stdout ?? "").trim();
    return stdout ? `<session-overview>\n${stdout}\n</session-overview>` : "";
  } catch {
    return "";
  }
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

  pi.on?.("session_start", (event, ctx) => {
    getKey(event, ctx);
    ctx?.ui?.notify?.(
      "Trellis Pi-only context is available. Use /trellis-continue to resume; queue branch work with pi-supergsd push-task.",
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

  pi.on?.("before_agent_start", (event, ctx) => {
    const key = getKey(event, ctx);
    const cur = (event as { systemPrompt?: string }).systemPrompt ?? "";
    const { implementContext, workflow, overview, guidance } = getTurnContext(key);
    return {
      systemPrompt: [cur, implementContext, workflow, overview, guidance]
        .filter(Boolean)
        .join("\n\n"),
    };
  });

  pi.on?.("context", (event, ctx) => {
    getKey(event, ctx);
  });
}
