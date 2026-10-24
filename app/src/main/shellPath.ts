/**
 * Apps opened from Finder or at login get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so Claude Code
 * wouldn't find git or anything installed with Homebrew. Take the PATH the user's login shell sets up.
 */
import { execFileSync } from "node:child_process";

const MARK = "__SELEYA_PATH__";

export function useLoginShellPath(): void {
  if (process.platform !== "darwin") return;
  try {
    const output = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const found = output.split(MARK)[1];
    if (found) process.env.PATH = found;
  } catch {
    // Keep the PATH we were given; Claude Code still runs, only tools outside it are missing.
  }
}
