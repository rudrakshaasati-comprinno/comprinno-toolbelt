import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { KIRO_API_KEY, TRUST_TOOLS as DEFAULT_TRUST_TOOLS, TRUST_ALL_TOOLS, WORKSPACE_DIR } from "./config.js";

// Timeout for session initialization (covers backend cold-start + throttling).
// A cold container's first session/new call also triggers a one-time
// semantic-search model download (~83MB); on a slow link that alone can take
// several minutes, so this must comfortably exceed it.
const INIT_TIMEOUT_MS = 600_000; // 10 minutes

// Whether to log raw ACP JSON-RPC traffic. Truthy env values enable it, but the
// common "off" strings (0/false/no/empty) are treated as disabled so
// DEBUG_ACP=0 actually silences it (a bare truthiness check would not, since
// "0" is a truthy string).
const DEBUG_ACP = !["", "0", "false", "no", "off"].includes(
  String(process.env.DEBUG_ACP || "").trim().toLowerCase()
);

/**
 * AcpSession wraps a single `kiro-cli acp` child process and speaks the ACP
 * JSON-RPC-over-stdio protocol. One instance per conversation.
 */
export class AcpSession {
  constructor({ id, agent, model, trustTools, trustAllTools }) {
    this.id = id || randomUUID();
    this.busy = false;
    this.acpSessionId = null;
    this.agent = agent || null;
    this.model = model || null;
    this.trustTools =
      Array.isArray(trustTools) && trustTools.length
        ? trustTools
        : DEFAULT_TRUST_TOOLS;
    // Auto-approve all tools unless explicitly overridden. Defaults to the
    // service config (TRUST_ALL_TOOLS), which is true for this headless agent.
    this.trustAllTools = trustAllTools ?? TRUST_ALL_TOOLS;

    this.nextId = 1;
    this.pending = new Map();
    this.permissionResolvers = new Map();
    this.listeners = new Set();
    this.buf = "";
    this.ready = false;
    this.closed = false;
    // NOTE on terminology: ACP models each selectable persona as a "mode"
    // (`availableModes`). This server surfaces those modes to API clients under
    // the friendlier name "agents" (see the `agents` field in the chat `start`
    // event and the /api/agents endpoint). So `this.modes` here == the "agents"
    // clients see; switching one is `session/set_mode` (see setMode()).
    this.modes = [];
    this.models = [];
    this.lastActivity = Date.now();

    const args = ["acp"];
    if (this.agent) args.push("--agent", this.agent);
    if (this.model) args.push("--model", this.model);
    // Headless service: no human answers the ACP permission prompt, so a gated
    // tool would hang the run. Trust all tools by default (config), else pass
    // the explicit allowlist.
    if (this.trustAllTools) {
      args.push("--trust-all-tools");
    } else if (this.trustTools.length) {
      args.push(`--trust-tools=${this.trustTools.join(",")}`);
    } else {
      args.push("--trust-tools=");
    }

    // Auth: inherit the parent environment so the CLI's interactive login
    // (Builder ID / IAM Identity Center) works. Only inject KIRO_API_KEY when
    // it is actually set and non-empty — an empty/undefined key would otherwise
    // override a valid interactive session and make the ACP handshake hang.
    const childEnv = { ...process.env };
    if (KIRO_API_KEY && KIRO_API_KEY.trim()) {
      childEnv.KIRO_API_KEY = KIRO_API_KEY;
    } else {
      delete childEnv.KIRO_API_KEY;
    }

    this.child = spawn("kiro-cli", args, {
      env: childEnv,
      cwd: WORKSPACE_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (d) => this._onData(d));
    this.child.stderr.on("data", (d) => {
      if (DEBUG_ACP) process.stderr.write(`[acp:${this.id}] ${d}`);
    });
    // Guard stdin: if the child has exited, a write raises EPIPE asynchronously
    // as an 'error' event. Without a listener that crashes the process. This
    // happens when a run is aborted (client disconnect) while a request is in
    // flight — close() kills the child, then the pending _send hits a dead pipe.
    this.child.stdin.on("error", (err) => {
      this.closed = true;
      if (DEBUG_ACP) console.log(`[acp:${this.id}] stdin error: ${err.code || err.message}`);
    });
    this.child.on("close", (code) => {
      this.closed = true;
      this._emit("closed", { code });
      for (const [, p] of this.pending) p.reject(new Error("ACP process closed"));
      this.pending.clear();
    });
    this.child.on("error", (err) => {
      this.closed = true;
      this._emit("error", { message: `Failed to start kiro-cli acp: ${err.message}` });
    });
  }

  // --- transport ---------------------------------------------------------

  _send(method, params, timeoutMs) {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    const json = JSON.stringify(msg);
    if (DEBUG_ACP) console.log(`[acp:${this.id}:out]`, json);

    return new Promise((resolve, reject) => {
      // Don't write to a dead/closed child: reject cleanly rather than let an
      // EPIPE surface as an unhandled error.
      if (this.closed || !this.child || this.child.exitCode !== null || !this.child.stdin.writable) {
        reject(new Error("ACP process is not available"));
        return;
      }
      try {
        this.child.stdin.write(json + "\n");
      } catch (err) {
        reject(new Error(`ACP write failed: ${err.message}`));
        return;
      }

      let timer;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
      };

      this.pending.set(id, {
        resolve: (result) => {
          cleanup();
          resolve(result);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      });

      if (timeoutMs) {
        timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`${method} timed out after ${timeoutMs / 1000}s (backend may be unavailable)`));
          }
        }, timeoutMs);
      }
    });
  }

  _respond(id, result) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  // Fire-and-forget JSON-RPC notification (no id, no response expected).
  _notify(method, params) {
    if (DEBUG_ACP) console.log(`[acp:${this.id}:notify]`, method);
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  _onData(chunk) {
    this.buf += chunk.toString();
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this._handle(msg);
    }
  }

  _handle(msg) {
    this.lastActivity = Date.now();
    if (DEBUG_ACP) console.log(`[acp:${this.id}:handle]`, JSON.stringify(msg));

    // Agent -> client REQUEST (has both method and id): must respond.
    if (msg.method && msg.id !== undefined) {
      if (msg.method === "session/request_permission") {
        this._onPermissionRequest(msg);
      } else {
        this._respond(msg.id, {});
      }
      return;
    }

    // Notification (method, no id).
    if (msg.method && msg.id === undefined) {
      this._onNotification(msg);
      return;
    }

    // Response to one of our requests.
    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "ACP error"));
        else p.resolve(msg.result);
      }
    }
  }

  _onNotification(msg) {
    const method = msg.method;
    const params = msg.params || {};
    const update = params.update;

    if (method === "session/update" && update) {
      // A session/update may originate from the main (orchestrator) session or
      // from a sub-agent session the subagent tool spawned. Tag each event so
      // the UI can show sub-agent work as background activity rather than
      // blending it into the orchestrator's own output. `params.sessionId` is
      // the sub-agent's session when it differs from our acpSessionId.
      const fromSessionId = params.sessionId || null;
      const isSub =
        !!fromSessionId && !!this.acpSessionId && fromSessionId !== this.acpSessionId;
      const origin = isSub ? "subagent" : "main";

      switch (update.sessionUpdate) {
        case "agent_message_chunk":
          if (update.content?.type === "text") {
            this._emit("chunk", { text: update.content.text, origin, fromSessionId });
          }
          break;
        case "tool_call":
          this._emit("tool", {
            phase: "start",
            toolCallId: update.toolCallId,
            title: update.title,
            toolName: update._meta?.kiro?.toolName,
            kind: update.kind,
            rawInput: update.rawInput,
            // Plain-language "why" the agent supplies for this call.
            purpose: update.rawInput?.__tool_use_purpose,
            locations: update.locations,
            origin,
            fromSessionId,
          });
          break;
        case "tool_call_update":
          this._emit("tool", {
            phase: "update",
            toolCallId: update.toolCallId,
            status: update.status,
            title: update.title,
            rawInput: update.rawInput,
            purpose: update.rawInput?.__tool_use_purpose,
            // The tool's result — lets the UI surface what a tool returned.
            rawOutput: update.rawOutput,
            locations: update.locations,
            origin,
            fromSessionId,
          });
          break;
      }
      return;
    }

    if (method === "_kiro.dev/session/update" && update?.sessionUpdate === "retry_warning") {
      this._emit("status", { message: update.message });
      return;
    }

    // Live sub-agent (crew) status. The CLI fires this repeatedly while a
    // `subagent` tool call runs, so the UI can show what each delegated
    // specialist is doing (spawned -> working -> terminated) instead of a
    // silent gap. We normalize to the fields the UI needs and drop the bulky
    // initialQuery/loop internals.
    if (method === "_kiro.dev/subagent/list_update") {
      const list = Array.isArray(params.subagents) ? params.subagents : [];
      this._emit("subagent", {
        subagents: list.map((s) => ({
          sessionId: s.sessionId,
          name: s.sessionName || s.agentName || "sub-agent",
          agentName: s.agentName,
          role: s.role,
          group: s.group,
          // status is { type: "working"|"terminated"|..., message? }
          statusType: s.status?.type || null,
          statusMessage: s.status?.message || null,
        })),
        pending: Array.isArray(params.pendingStages) ? params.pendingStages.length : 0,
      });
    }
  }

  _onPermissionRequest(msg) {
    const { id } = msg;
    const p = msg.params || {};
    this.permissionResolvers.set(id, (optionId) => {
      this._respond(id, { outcome: { outcome: "selected", optionId } });
      this.permissionResolvers.delete(id);
    });
    this._emit("approval_required", {
      requestId: id,
      toolCallId: p.toolCall?.toolCallId,
      title: p.toolCall?.title,
      rawInput: p.toolCall?.rawInput,
      options: p.options || [],
    });
  }

  resolvePermission(requestId, optionId) {
    const resolver = this.permissionResolvers.get(requestId);
    if (!resolver) return false;
    resolver(optionId);
    this._emit("approval_resolved", { requestId, optionId });
    return true;
  }

  // --- lifecycle ---------------------------------------------------------

  async initialize() {
    // The initialize handshake triggers the CLI's cold-start work on first call
    // (model backend, MCP servers), which can exceed 30s in a cold container.
    const init = await this._send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    }, INIT_TIMEOUT_MS);

    // session/new requires backend connectivity; may be slow or throttled
    const created = await this._send("session/new", {
      cwd: WORKSPACE_DIR,
      mcpServers: [],
    }, INIT_TIMEOUT_MS);

    this.acpSessionId = created.sessionId;
    this.modes = created.modes?.availableModes || [];
    this.models = created.models?.availableModels || [];
    this.ready = true;
    return { agentInfo: init.agentInfo, modes: this.modes, models: this.models };
  }

  async load(acpSessionId) {
    await this._send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    }, INIT_TIMEOUT_MS);

    const loaded = await this._send("session/load", {
      sessionId: acpSessionId,
      cwd: WORKSPACE_DIR,
      mcpServers: [],
    }, INIT_TIMEOUT_MS);

    this.acpSessionId = acpSessionId;
    this.modes = loaded?.modes?.availableModes || [];
    this.models = loaded?.models?.availableModels || [];
    this.ready = true;
    return { modes: this.modes, models: this.models };
  }

  async prompt(text) {
    if (!this.ready) throw new Error("session not initialized");
    this.lastActivity = Date.now();
    // Prompts can take a while (model inference); no timeout here.
    return this._send("session/prompt", {
      sessionId: this.acpSessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /**
   * Cancel the current operation (e.g., stop a running prompt).
   * Per the ACP spec, session/cancel is a NOTIFICATION (no id, no response) —
   * sending it as a request returns "Method not found". The agent ends the
   * active session/prompt with stopReason "cancelled".
   */
  async cancel() {
    if (!this.ready) throw new Error("session not initialized");
    this._notify("session/cancel", { sessionId: this.acpSessionId });
  }

  /**
   * Change the model mid-session without starting a new session.
   * @param {string} modelId - The model ID to switch to
   */
  async setModel(modelId) {
    if (!this.ready) throw new Error("session not initialized");
    // The CLI expects `modelId` (matching availableModels[].modelId). Sending
    // `model` instead makes the ACP process panic and close, so this key name
    // is load-bearing, not stylistic.
    const result = await this._send("session/set_model", {
      sessionId: this.acpSessionId,
      modelId,
    }, 30_000);
    this.model = modelId;
    return result;
  }

  /**
   * Change the agent/mode mid-session without starting a new session.
   * @param {string} agentName - The agent name to switch to
   */
  async setMode(agentName) {
    if (!this.ready) throw new Error("session not initialized");
    // Like set_model, the CLI expects `modeId` (matching modes.currentModeId /
    // availableModes[].id). Sending `mode` panics and closes the ACP process.
    const result = await this._send("session/set_mode", {
      sessionId: this.acpSessionId,
      modeId: agentName,
    }, 30_000);
    this.agent = agentName;
    return result;
  }

  // --- SSE fan-out -------------------------------------------------------

  addListener(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _emit(event, data) {
    for (const cb of this.listeners) {
      try {
        cb(event, data);
      } catch {
        /* listener errors shouldn't break the session */
      }
    }
  }

  close() {
    if (this.closed && !this.child) return Promise.resolve();
    this.closed = true;
    if (!this.child || this.child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      this.child.once("close", done);
      try {
        this.child.kill("SIGTERM");
      } catch {
        resolve();
        return;
      }
      setTimeout(() => {
        try {
          this.child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        resolve();
      }, 3000).unref();
    });
  }
}
