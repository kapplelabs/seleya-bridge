/**
 * The bridge writes to the console (connector errors, Claude failures); the app has no terminal, so the
 * last lines are kept for the control panel's "Show log".
 */
import { format } from "node:util";

const MAX_LINES = 200;
const lines: string[] = [];

export function appendLog(...args: unknown[]): void {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  for (const line of format(...args).split("\n")) lines.push(`${time}  ${line}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export const logLines = () => [...lines];

/** Copies console output into the log, still printing it (visible when the app runs from a terminal). */
export function captureConsole(): void {
  for (const method of ["log", "info", "warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      appendLog(...args);
      original(...args);
    };
  }
}
