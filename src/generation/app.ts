import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { ArtifactStore } from "./artifacts/artifacts.ts";
import type { Clock } from "./clock.ts";
import { realClock } from "./clock.ts";
import type { LocalConfig } from "./config.ts";
import type { HarnessRegistry } from "./harness/registry.ts";
import type { Harness } from "./harness/types.ts";
import type { ChromeRenderer } from "./render/chrome.ts";
import { type HarnessPicker, RunError, RunManager } from "./runs/manager.ts";
import type { DraftRenderer, PostProcessor } from "./runs/runner.ts";
import { Store } from "./runs/store.ts";
import { createLocalServer, dispatch, type Route } from "./server/http.ts";
import { artifactRoutes } from "./server/routes/artifacts.ts";
import { eventRoutes } from "./server/routes/events.ts";
import { harnessRoutes } from "./server/routes/harnesses.ts";
import { runRoutes } from "./server/routes/runs.ts";
import { sessionRoutes } from "./server/routes/session.ts";
import { skillRoutes } from "./server/routes/skills.ts";
import { slideRoutes } from "./server/routes/slides.ts";
import { studioRoutes } from "./server/routes/studio.ts";
import { syncRoutes } from "./server/routes/sync.ts";
import { policyFor, type SecurityPolicy } from "./server/security.ts";
import { RecipeStore } from "./recipes.ts";
import { loadAllSkills, loadSkills, type SkillMeta } from "./skills.ts";
import { SyncManager } from "./sync/sync.ts";

export interface AppOptions {
  config: LocalConfig;
  clock?: Clock;
  /** Overrides harness selection (tests, `SELEYA_LOCAL_HARNESS=scripted`); spec 002 provides the default. */
  pickHarness?: HarnessPicker;
  harnessStatus?: () => Promise<unknown[]>;
  postProcessors?: Map<string, PostProcessor>;
  draftRenderers?: Map<string, DraftRenderer>;
  /** Agents that can make a media kind (spec 008); default: the registry's. */
  mediaAgents?: (kind: string) => Promise<Harness[]>;
  /** Builds the harness registry once the store exists (spec 002); used unless pickHarness is given. */
  registry?: (store: Store, clock: Clock) => HarnessRegistry;
  /** Where finished runs are synced (spec 006); absent: no sync routes. */
  syncEndpoint?: string;
  /** Renderer shared by creative and slide post-processing (Chrome over CDP). */
  renderer?: () => ChromeRenderer;
  /** Extra routes from later specs (studio, sync). */
  extraRoutes?: (app: LocalApp) => Route[];
  apiOnly?: boolean;
  /**
   * Keys whose signed recipes runs may carry (spec 009): key id → Ed25519 public key, base64 SPKI.
   * Absent or empty: no recipe is accepted, only the base skills run.
   */
  trustedRecipeKeys?: Record<string, string>;
}

export interface LocalApp {
  config: LocalConfig;
  store: Store;
  manager: RunManager;
  registry?: HarnessRegistry;
  sync?: SyncManager;
  skills: () => Map<string, SkillMeta>;
  reloadSkills: () => void;
  recipes: RecipeStore;
  listen: (port: number) => Promise<number>;
  close: () => Promise<void>;
  policy: () => SecurityPolicy;
  /**
   * Runs the route for `apiPath` (the path below `/api` or `/v1/generation`) with no cookie check:
   * seleya-bridge has already checked the caller (spec 009 FR-002). False when no route matches.
   */
  handleTrusted: (
    request: IncomingMessage,
    response: ServerResponse,
    apiPath: string,
    query: URLSearchParams,
  ) => Promise<boolean>;
}

/** A picker that always uses one harness (tests and the scripted demo). */
export const fixedHarness =
  (harness: Harness): HarnessPicker =>
  async () => ({ harness });

const noHarness: HarnessPicker = async () => {
  throw new RunError("no_harness", "No AI agent is available on this computer.", 409);
};

/** Wires store, skills, run manager and HTTP server together. */
export function createApp(options: AppOptions): LocalApp {
  const { config } = options;
  const clock = options.clock ?? realClock;
  const store = new Store(config.dbFile);
  const artifacts = new ArtifactStore(config.dbFile);
  const sessionSecret = store.meta("session_secret", () => randomBytes(24).toString("base64url"));
  // Re-read on demand: saved skills (spec 007) appear without a restart.
  let skillCache = loadAllSkills(
    [config.skillsDir, config.userSkillsDir],
    config.defaultTimeLimitMs,
  );
  const skills = () => skillCache;
  const reloadSkills = () => {
    skillCache = loadAllSkills([config.skillsDir, config.userSkillsDir], config.defaultTimeLimitMs);
  };
  const recipes = new RecipeStore(path.join(config.home, "recipes"), options.trustedRecipeKeys ?? {});
  /** The recipes a run request carries, verified earlier (spec 009). */
  const digestsOf = (request: Record<string, unknown>) =>
    [
      request.recipe_digest,
      ...(Array.isArray(request.recipe_digests) ? request.recipe_digests : []),
    ].filter((digest): digest is string => typeof digest === "string" && recipes.has(digest));
  const skillsFor = (request: Record<string, unknown>) => {
    const digests = digestsOf(request);
    if (digests.length === 0) return skillCache;
    const all = new Map(skillCache);
    for (const digest of digests)
      for (const [name, skill] of loadSkills(recipes.dirFor(digest), config.defaultTimeLimitMs))
        all.set(name, { ...skill, recipe: { digest, version: skill.version } });
    return all;
  };
  const registry = options.pickHarness ? undefined : options.registry?.(store, clock);
  const manager = new RunManager({
    store,
    config,
    clock,
    skills,
    skillsFor,
    recipeDirsFor: (request) => digestsOf(request).map((digest) => recipes.dirFor(digest)),
    pickHarness:
      options.pickHarness ??
      (registry ? (skill, requested) => registry.pick(skill, requested) : noHarness),
    postProcessors: options.postProcessors,
    draftRenderers: options.draftRenderers,
    mediaAgents: options.mediaAgents ?? (registry ? (kind) => registry.pickFor(kind) : undefined),
    mediaAvailability: registry
      ? async () =>
          Object.fromEntries(
            Object.entries(await registry.mediaAvailability()).map(([kind, agents]) => [
              kind,
              agents.map((agent) => agent.name),
            ]),
          )
      : undefined,
  });
  const sync = options.syncEndpoint
    ? new SyncManager({ store, manager, clock, config, endpoint: options.syncEndpoint })
    : undefined;
  sync?.start();
  let policy = policyFor(config.port, config.extraOrigins, sessionSecret);
  let closing: Promise<void> | undefined;

  const app: LocalApp = {
    config,
    store,
    manager,
    registry,
    sync,
    skills,
    reloadSkills,
    recipes,
    policy: () => policy,
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const actual = (server.address() as AddressInfo).port;
          policy = policyFor(actual, config.extraOrigins, sessionSecret);
          resolve(actual);
        });
      }),
    handleTrusted: (request, response, apiPath, query) =>
      dispatch(request, response, routes, apiPath, query),
    close: () =>
      (closing ??= new Promise((resolve) => {
        registry?.stop();
        sync?.stop();
        server.closeAllConnections();
        server.close(() => {
          artifacts.close();
          store.close();
          resolve();
        });
      })),
  };

  const routes: Route[] = [
    ...sessionRoutes({
      config,
      store,
      policy: () => policy,
      skills,
      harnesses: options.harnessStatus ?? (async () => registry?.statusJson() ?? []),
    }),
    ...runRoutes({ config, store, manager, acceptRecipe: (raw) => recipes.accept(raw) }),
    ...eventRoutes(store, manager),
    ...studioRoutes(store, manager, skills, {
      runsDir: config.runsDir,
      home: config.home,
      renderer: options.renderer,
      acceptRecipe: (raw) => recipes.accept(raw),
    }),
    ...skillRoutes(config, manager, skills, reloadSkills),
    ...artifactRoutes(artifacts, store, manager, config.runsDir, () => clock.now()),
    ...(sync ? syncRoutes(sync) : []),
    ...(options.renderer ? slideRoutes(config, store, manager, options.renderer) : []),
    ...(registry ? harnessRoutes(registry) : []),
    ...(options.extraRoutes?.(app) ?? []),
  ];
  const server = createLocalServer({
    policy: () => policy,
    routes,
    distDir: options.apiOnly ? undefined : config.distDir,
  });
  return app;
}
