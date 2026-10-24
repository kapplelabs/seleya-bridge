/**
 * The `claude` binary the bridge runs. The Agent SDK normally finds its platform package on its own, but
 * the app bundles the SDK into one file, so the app points it at the binary: shipped in the app's
 * Resources when packaged, the one the SDK installed in development. config.json's claudeExecutable
 * still wins.
 */
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { app } from "electron";

export function bundledClaude(): string | undefined {
  if (app.isPackaged) {
    const shipped = path.join(process.resourcesPath, "claude");
    return existsSync(shipped) ? shipped : undefined;
  }
  try {
    const fromRepo = createRequire(path.join(import.meta.dirname, "../../../package.json"));
    const sdk = realpathSync(fromRepo.resolve("@anthropic-ai/claude-agent-sdk"));
    return createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
  } catch {
    return undefined;
  }
}
