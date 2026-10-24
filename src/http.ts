import type { IncomingMessage, ServerResponse } from "node:http";

import type { z } from "zod";

import { keysToSnakeCase } from "./case.ts";

/** Largest request body accepted; a prompt is text, so this is generous. */
const MAX_BODY_BYTES = 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** What Seleya needs to explain the error, besides the code (`{provider, state}`, `{connector}`…). */
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(keysToSnakeCase(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

export function sendError(res: ServerResponse, error: HttpError): void {
  sendJson(res, error.status, { error: { code: error.code, message: error.message, details: error.details } });
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { "Content-Length": 0 });
  res.end();
}

/**
 * Reads a JSON body and validates it. Requiring `application/json` also means a cross-origin
 * browser request always sends a CORS preflight first, so it can't slip in as a "simple" request.
 */
export async function readJson<T extends z.ZodType>(req: IncomingMessage, schema: T): Promise<z.infer<T>> {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large", "Request body is too large");
    chunks.push(buffer);
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, "invalid_request", `${issue?.path.join(".") || "body"}: ${issue?.message}`);
  }
  return parsed.data;
}
