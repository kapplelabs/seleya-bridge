import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

/**
 * The smallest MCP client Seleya needs: start a stdio server, `initialize`, and `tools/call`.
 * Messages are newline-delimited JSON-RPC 2.0 (MCP stdio transport).
 */
export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class McpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private ready: Promise<void> | undefined;
  private spec: McpServerSpec;

  constructor(spec: McpServerSpec) {
    this.spec = spec;
  }

  /** Starts the server and completes the MCP handshake once. */
  connect(): Promise<void> {
    this.ready ??= this.open();
    return this.ready;
  }

  private async open() {
    const child = spawn(this.spec.command, this.spec.args, {
      env: { ...process.env, ...this.spec.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.stderr.resume();
    child.on("exit", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("MCP server exited"));
      this.pending.clear();
      this.ready = undefined;
      this.child = undefined;
    });
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "seleya-local", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "MCP error"));
      else pending.resolve(message.result);
    }
  }

  private send(message: Record<string, unknown>) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.send({ method, params });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  /** Calls a tool and parses its text content as JSON. */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.connect();
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (result.content ?? []).map((item) => item.text ?? "").join("");
    if (result.isError) throw new Error(`${name}: ${text}`);
    return JSON.parse(text) as T;
  }

  close(): void {
    this.child?.kill();
  }
}
