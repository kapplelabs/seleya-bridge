import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

/**
 * Stand-in for seleya-server's sync endpoint (spec 006, demo decision): same contract, runs on this
 * computer, stores what it receives so the audit (SC-003) can inspect every byte that was sent.
 *
 *   PUT    /sync/runs/{id}                 metadata (idempotent: 201 created, 200 duplicate)
 *   PUT    /sync/runs/{id}/files/{name}    one output file (idempotent)
 *   POST   /sync/runs/{id}/complete        all files arrived
 *   GET    /sync/runs                      what the server holds
 *   DELETE /sync/runs/{id}                 remove the server copy
 */
export function createStandinServer(dir: string): Server {
  mkdirSync(dir, { recursive: true });
  const runDir = (id: string) => path.join(dir, id.replace(/[^A-Za-z0-9_-]/g, ""));
  return createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", "http://standin");
    const parts = url.pathname.split("/").filter(Boolean); // sync, runs, id, files, name
    if (parts[0] !== "sync" || parts[1] !== "runs") return send(404, { error: "not found" });
    const id = parts[2];

    if (request.method === "GET" && !id)
      return send(
        200,
        readdirSync(dir).map((name) => ({
          run_id: name,
          complete: existsSync(path.join(dir, name, ".complete")),
          files: existsSync(path.join(dir, name, "files"))
            ? readdirSync(path.join(dir, name, "files"))
            : [],
        })),
      );
    if (!id) return send(404, { error: "not found" });
    const folder = runDir(id);

    if (request.method === "PUT" && parts.length === 3) {
      const duplicate = existsSync(path.join(folder, "run.json"));
      mkdirSync(path.join(folder, "files"), { recursive: true });
      writeFileSync(path.join(folder, "run.json"), body);
      return send(duplicate ? 200 : 201, { run_id: id, duplicate });
    }
    if (request.method === "PUT" && parts[3] === "files" && parts[4]) {
      if (!existsSync(folder)) return send(404, { error: "send the run first" });
      writeFileSync(
        path.join(folder, "files", path.basename(decodeURIComponent(parts.slice(4).join("/")))),
        body,
      );
      return send(200, { stored: parts[4] });
    }
    if (request.method === "POST" && parts[3] === "complete") {
      if (!existsSync(folder)) return send(404, { error: "unknown run" });
      writeFileSync(path.join(folder, ".complete"), new Date().toISOString());
      return send(200, { run_id: id, complete: true });
    }
    if (request.method === "DELETE" && parts.length === 3) {
      rmSync(folder, { recursive: true, force: true });
      return send(200, { run_id: id, deleted: true });
    }
    if (request.method === "GET" && parts.length === 3 && existsSync(folder))
      return send(200, JSON.parse(readFileSync(path.join(folder, "run.json"), "utf8")));
    return send(404, { error: "not found" });
  });
}
