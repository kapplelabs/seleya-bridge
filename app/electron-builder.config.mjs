// `pnpm dist`: Seleya Bridge.app in a .dmg for this Mac's architecture (release/).
// The Agent SDK's `claude` binary ships in Contents/Resources (claudeBinary.ts finds it there): it is
// too big for the asar archive and must stay executable.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const fromRepo = createRequire(path.join(import.meta.dirname, "../package.json"));
const sdk = realpathSync(fromRepo.resolve("@anthropic-ai/claude-agent-sdk"));
const claude = createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);

/** @type {import("electron-builder").Configuration} */
export default {
  appId: "co.vulcanlabs.seleya-bridge",
  productName: "Seleya Bridge",
  directories: { output: "release", buildResources: "build" },
  // Everything the app needs is bundled into dist/ (main, preload, renderer) and assets/.
  files: ["dist/**/*", "assets/**/*", "package.json", "!**/*.map"],
  extraResources: [{ from: claude, to: "claude" }],
  protocols: [{ name: "Seleya Bridge", schemes: ["seleya-bridge"] }],
  mac: {
    category: "public.app-category.developer-tools",
    target: [{ target: "dmg", arch: [process.arch] }],
    icon: "build/icon.icns",
    // A menu-bar app: no Dock icon.
    extendInfo: { LSUIElement: true },
    hardenedRuntime: true,
  },
  dmg: { title: "Seleya Bridge" },
};
