import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

import type { Clock, Timer } from "../clock.ts";

/**
 * Follows a file that grows by appended lines (progress.jsonl, a harness log) and hands over each
 * complete line once. The file may not exist yet; a partial last line waits for its newline.
 */
export class LineTailer {
  private offset = 0;
  private buffer = "";
  private timer: Timer | undefined;

  private file: string;
  private onLine: (line: string) => void;

  constructor(file: string, onLine: (line: string) => void) {
    this.file = file;
    this.onLine = onLine;
  }

  start(clock: Clock, intervalMs: number): void {
    this.timer = clock.setInterval(() => this.poll(), intervalMs);
  }

  /** Reads whatever was appended since the last poll. */
  poll(): void {
    if (!existsSync(this.file)) return;
    const size = statSync(this.file).size;
    if (size < this.offset) this.offset = 0; // truncated: start over
    if (size === this.offset) return;
    const chunk = Buffer.alloc(size - this.offset);
    const fd = openSync(this.file, "r");
    try {
      readSync(fd, chunk, 0, chunk.length, this.offset);
    } finally {
      closeSync(fd);
    }
    this.offset = size;
    this.buffer += chunk.toString("utf8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) this.onLine(line);
  }

  /** Reads the rest, including a final line without a newline, and stops. */
  stop(): void {
    this.poll();
    if (this.buffer.trim()) this.onLine(this.buffer);
    this.buffer = "";
    this.timer?.cancel();
    this.timer = undefined;
  }
}
