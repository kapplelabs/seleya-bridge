import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { type Clock, realClock, type Timer } from "../clock.ts";
import { capabilitiesOf } from "../media/declarations.ts";
import { LineTailer } from "../runs/tail.ts";
import { classifyFailure, failureMessage } from "./classify.ts";
import { McpClient, type McpServerSpec } from "./mcp-client.ts";
import { PARSERS, type StreamKind } from "./parsers.ts";
import type {
  Harness,
  HarnessActivity,
  HarnessExit,
  HarnessHandle,
  HarnessStartInput,
  HarnessStatus,
} from "./types.ts";

/**
 * Fabric targets Seleya can hand runs to, best first (Antigravity: proven image generation). What
 * each makes comes from the media declarations (spec 008 D5): Fabric does not advertise it.
 */
const TARGETS: { id: string; stream: StreamKind }[] = [
  { id: "antigravity", stream: "antigravity" },
  { id: "claude", stream: "claude" },
  { id: "codex", stream: "codex" },
];

const DASHBOARD = "http://127.0.0.1:8788";
const POLL_MS = 2_000;
const CANCEL_WAIT_MS = 6_000;
/** Fabric unreachable for this long while a run is in flight means it stopped (spec 002 US4.3). */
const FABRIC_DOWN_MS = 30_000;

interface FabricSetup {
  spec: McpServerSpec;
  /** agent-fabric checkout, for its worker logs. */
  root: string;
}

/**
 * How the user's agents already reach Agent Fabric: SELEYA_FABRIC_MCP, or the `agent-fabric-peer`
 * MCP server registered in ~/.claude.json (only its launch command is read; research R5).
 */
export function discoverFabric(): FabricSetup | undefined {
  let spec: McpServerSpec | undefined;
  if (process.env.SELEYA_FABRIC_MCP) {
    try {
      spec = JSON.parse(process.env.SELEYA_FABRIC_MCP) as McpServerSpec;
    } catch {
      spec = undefined;
    }
  } else {
    try {
      const config = JSON.parse(readFileSync(path.join(homedir(), ".claude.json"), "utf8")) as {
        mcpServers?: Record<
          string,
          { command?: string; args?: string[]; env?: Record<string, string> }
        >;
      };
      const server = config.mcpServers?.["agent-fabric-peer"];
      if (server?.command && Array.isArray(server.args))
        spec = { command: server.command, args: server.args, env: server.env };
    } catch {
      spec = undefined;
    }
  }
  if (!spec) return undefined;
  const entry = spec.args.find((arg) => arg.endsWith("peer-mcp.ts") || arg.endsWith("peer-mcp.js"));
  const root = entry ? path.resolve(path.dirname(entry), "..", "..") : "";
  return {
    root,
    spec: {
      ...spec,
      env: { ...spec.env, PEER_REQUESTER_HOST: "seleya", PEER_ALLOW_CLIENT_SESSION: "1" },
    },
  };
}

interface PeerTask {
  taskId: string;
  status: string;
  terminal?: boolean;
  error?: string | null;
  result?: string | null;
}

export class FabricHarness implements Harness {
  readonly id = "fabric";
  readonly name = "Agent Fabric";
  private setup: FabricSetup | undefined;
  private client: McpClient | undefined;
  private liveTargets: string[] = [];
  private session = `seleya-local-${process.pid}`;
  private clock: Clock;
  private overrides: Record<string, string[]>;

  constructor(
    clock: Clock = realClock,
    setup = discoverFabric(),
    overrides: Record<string, string[]> = {},
  ) {
    this.clock = clock;
    this.setup = setup;
    this.overrides = overrides;
  }

  /** Media kinds a worker can make. */
  workerCapabilities(id: string): string[] {
    return capabilitiesOf(id, undefined, this.overrides);
  }

  private mcp(): McpClient {
    if (!this.setup) throw new Error("Agent Fabric is not set up on this computer.");
    this.client ??= new McpClient(this.setup.spec);
    return this.client;
  }

  async check(): Promise<HarnessStatus> {
    if (!this.setup)
      return {
        installed: false,
        signedIn: false,
        canGenerateImages: false,
        detail: "Agent Fabric is not set up (optional).",
      };
    try {
      const list = await withTimeout(
        this.mcp().callTool<{ callees: { target: string; liveness: string }[] }>("peer_list", {}),
        15_000,
      );
      this.liveTargets = list.callees
        .filter(
          (callee) =>
            callee.liveness === "up" && TARGETS.some((target) => target.id === callee.target),
        )
        .map((callee) => callee.target);
      const workers = this.liveTargets.map((id) => ({
        id,
        capabilities: this.workerCapabilities(id),
      }));
      const capabilities = [...new Set(workers.flatMap((worker) => worker.capabilities))];
      return {
        installed: true,
        signedIn: this.liveTargets.length > 0,
        canGenerateImages: capabilities.includes("image"),
        capabilities,
        workers,
        detail: this.liveTargets.length
          ? `Workers up: ${workers
              .map((worker) =>
                worker.capabilities.length
                  ? `${worker.id} (${worker.capabilities.join(", ")})`
                  : worker.id,
              )
              .join(", ")}`
          : "No Agent Fabric workers are running. Start them with `make up` in agent-fabric.",
      };
    } catch (error) {
      this.client?.close();
      this.client = undefined;
      return {
        installed: true,
        signedIn: false,
        canGenerateImages: false,
        detail: `Agent Fabric did not answer: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /** The worker for a task: the first one up that makes every kind it needs, else the first one up. */
  targetFor(needs: string[]): { id: string; stream: StreamKind } {
    const live = TARGETS.filter((target) => this.liveTargets.includes(target.id));
    const target =
      live.find((item) => {
        const can = this.workerCapabilities(item.id);
        return needs.every((kind) => can.includes(kind));
      }) ?? live[0];
    if (!target) throw new Error("No Agent Fabric worker is up.");
    return target;
  }

  start(input: HarnessStartInput): HarnessHandle {
    const listeners: ((activity: HarnessActivity) => void)[] = [];
    let settle!: (exit: HarnessExit) => void;
    const exited = new Promise<HarnessExit>((resolve) => (settle = resolve));
    let done = false;
    let taskId: string | undefined;
    let stopRequested = false;
    let failingSince: number | undefined;
    let poller: Timer | undefined;
    let tailer: LineTailer | undefined;
    const finish = (exit: HarnessExit) => {
      if (done) return;
      done = true;
      poller?.cancel();
      tailer?.stop();
      settle(exit);
    };

    const target = this.targetFor(input.needs ?? input.skill.needs);
    const parse = PARSERS[target.stream];
    const logsDir = this.setup ? path.join(this.setup.root, "logs") : "";

    void this.mcp()
      .callTool<PeerTask>("peer_handoff", {
        target: target.id,
        folder: input.folder,
        prompt: input.prompt,
        requesterSessionId: this.session,
      })
      .then((task) => {
        taskId = task.taskId;
        // Stopped while the handoff was in flight: cancel the task Fabric just queued.
        if (stopRequested || done) return void cancelTask(task.taskId);
        poller = this.clock.setInterval(() => void poll(), POLL_MS);
      })
      .catch((error: unknown) =>
        finish({
          ok: false,
          code: "crashed",
          message: `Agent Fabric refused the run: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );

    const cancelTask = (id: string) =>
      fetch(`${DASHBOARD}/tasks/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        signal: AbortSignal.timeout(3_000),
      })
        .then(() => undefined)
        .catch(() => undefined);

    const attachLog = () => {
      if (tailer || !taskId || !existsSync(logsDir)) return;
      const file = readdirSync(logsDir).find((name) => name.startsWith(`${taskId}.attempt-`));
      if (!file) return;
      tailer = new LineTailer(path.join(logsDir, file), (line) => {
        for (const activity of parse(line).activity)
          for (const listener of listeners) listener(activity);
      });
    };

    let polling = false;
    const poll = async () => {
      if (done || !taskId || polling) return;
      polling = true;
      try {
        attachLog();
        tailer?.poll();
        const task = await this.mcp().callTool<PeerTask>("peer_get", {
          taskId,
          requesterSessionId: this.session,
        });
        failingSince = undefined;
        if (!task.terminal) return;
        if (task.status === "COMPLETED") return finish({ ok: true });
        const text = `${task.error ?? ""}\n${task.result ?? ""}`;
        const code = task.status === "CANCELED" ? "crashed" : classifyFailure(text);
        finish({
          ok: false,
          code,
          message:
            task.status === "CANCELED"
              ? "Agent Fabric cancelled the task."
              : failureMessage(code, `Agent Fabric (${target.id})`),
        });
      } catch {
        // Transient errors are retried on the next poll; a Fabric that stays unreachable has stopped.
        failingSince ??= this.clock.now();
        if (this.clock.now() - failingSince >= FABRIC_DOWN_MS)
          finish({
            ok: false,
            code: "crashed",
            message:
              "Agent Fabric stopped while this run was in progress. Retry it, or pick an agent that runs directly in Settings → Agents.",
          });
      } finally {
        polling = false;
      }
    };

    return {
      onActivity: (listener) => listeners.push(listener),
      exited,
      stop: async (reason = "cancelled") => {
        if (done) return;
        stopRequested = true;
        // The result is already in the run folder: let Fabric's task finish on its own (it is
        // nearly done) instead of recording a cancellation for a run that succeeded.
        if (reason === "finished") return finish({ ok: true });
        // No task id yet: the handoff callback cancels the task as soon as Fabric names it.
        if (!taskId) return finish({ ok: false, code: "stopped", message: "Stopped" });
        await cancelTask(taskId);
        await Promise.race([
          exited,
          new Promise((resolve) => this.clock.setTimeout(() => resolve(undefined), CANCEL_WAIT_MS)),
        ]);
        finish({ ok: false, code: "stopped", message: "Stopped" });
      },
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
