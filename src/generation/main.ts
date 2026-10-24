/**
 * Generation inside seleya-bridge (spec 009): the engine that runs Seleya's signed recipes with the
 * agents installed here. The bridge starts it once and serves its routes under /v1/generation.
 */
import { cpSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

import { createApp, fixedHarness, type LocalApp } from "./app.ts";
import { realClock } from "./clock.ts";
import { loadLocalConfig } from "./config.ts";
import { creativePostProcessor } from "./creative/postprocess.ts";
import { BUILTIN_CLI_HARNESSES } from "./harness/builtins.ts";
import { loadDescriptors } from "./harness/descriptor.ts";
import { FabricHarness } from "./harness/fabric.ts";
import { HarnessRegistry } from "./harness/registry.ts";
import { ScriptedHarness } from "./harness/scripted.ts";
import { loadOverrides } from "./media/declarations.ts";
import { ChromeRenderer } from "./render/chrome.ts";
import { routedPostProcessor } from "./runs/route.ts";
import { slideDraftRenderer, slidesPostProcessor } from "./slides/postprocess.ts";
import { createStandinServer } from "./sync/standin.ts";

export interface GenerationOptions {
  /** Where generation keeps its data; default `<bridge home>/generation`. */
  home?: string;
  /** Keys whose signed recipes runs may carry (key id → base64 SPKI). */
  trustedRecipeKeys: Record<string, string>;
  /** A built Seleya client to serve (`--serve-app`, spec 009 D10). */
  distDir?: string;
  log?: (line: string) => void;
}

export interface Generation {
  app: LocalApp;
  /** Runs that were going when the bridge last stopped, now marked interrupted. */
  interrupted: number;
  close: () => Promise<void>;
}

/** Copies an older Seleya Local's data in once (spec 009 D10). */
function adoptSeleyaLocal(home: string, log: (line: string) => void) {
  const old = path.join(homedir(), ".seleya-local");
  if (existsSync(path.join(home, "seleya.db")) || !existsSync(path.join(old, "seleya.db"))) return;
  cpSync(old, home, { recursive: true, force: false });
  log(`generation: copied earlier Seleya Local data from ${old}`);
}

export async function startGeneration(options: GenerationOptions): Promise<Generation> {
  const log = options.log ?? ((line: string) => console.log(line));
  const config = loadLocalConfig({
    ...(options.home ? { home: options.home } : {}),
    ...(options.distDir ? { distDir: options.distDir } : {}),
  });
  adoptSeleyaLocal(config.home, log);

  const scripted =
    config.defaultHarness === "scripted" ? new ScriptedHarness(realClock) : undefined;
  const renderer = new ChromeRenderer(config.home);
  const creative = creativePostProcessor(renderer, config.home);
  const slides = slidesPostProcessor(renderer, config.home);
  // Every run post-processes by the result shape its recipe declares (design pages or a deck).
  const routed = routedPostProcessor({ creative, slides });

  // Spec 006 (demo): finished runs sync to a stand-in of seleya-server's endpoint on this computer,
  // unless SELEYA_SYNC_URL points at a real one.
  let syncEndpoint = process.env.SELEYA_SYNC_URL;
  let standin: ReturnType<typeof createStandinServer> | undefined;
  if (!syncEndpoint) {
    const server = createStandinServer(path.join(config.home, "sync-standin"));
    standin = server;
    const port = await new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
    );
    syncEndpoint = `http://127.0.0.1:${port}`;
  }

  const app = createApp({
    syncEndpoint,
    config,
    apiOnly: !options.distDir,
    trustedRecipeKeys: options.trustedRecipeKeys,
    renderer: () => renderer,
    postProcessors: new Map([["*", routed]]),
    draftRenderers: new Map([["*", slideDraftRenderer(renderer)]]),
    pickHarness: scripted ? fixedHarness(scripted) : undefined,
    registry: (store, clock) => {
      const descriptors = loadDescriptors(path.join(config.home, "harnesses"));
      const overrides = loadOverrides(config.home);
      const registry = new HarnessRegistry({
        store,
        clock,
        overrides,
        rejected: descriptors.rejected,
        harnesses: [
          ...BUILTIN_CLI_HARNESSES.map((harness) => ({ harness, kind: "builtin" as const })),
          { harness: new FabricHarness(clock, undefined, overrides), kind: "builtin" as const },
          ...descriptors.harnesses.map((harness) => ({ harness, kind: "descriptor" as const })),
        ],
      });
      registry.startRefreshing();
      return registry;
    },
  });
  const interrupted = app.manager.recover();
  return {
    app,
    interrupted,
    close: async () => {
      await Promise.all([app.close(), renderer.close()]);
      await new Promise<void>((resolve) => (standin ? standin.close(() => resolve()) : resolve()));
    },
  };
}
