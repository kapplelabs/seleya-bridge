import type { Clock, Timer } from "../clock.ts";
import { MEDIA_KINDS, pluralOf } from "../media/catalog.ts";
import { capabilitiesOf } from "../media/declarations.ts";
import { RunError } from "../runs/manager.ts";
import type { Store } from "../runs/store.ts";
import type { SkillMeta } from "../skills.ts";
import type { Harness, HarnessStatus } from "./types.ts";

export interface HarnessPreferences {
  default: string | null;
  perSkill: Record<string, string>;
  /** Which agent makes each media kind (spec 008), e.g. {"image": "fabric"}. */
  perCapability: Record<string, string>;
  order: string[];
}

export const DEFAULT_ORDER = ["antigravity", "fabric", "claude", "codex"];
const STALE_MS = 30_000;
const PREFS_KEY = "harness_preferences";

interface Entry {
  harness: Harness;
  kind: "builtin" | "descriptor";
  status?: HarnessStatus;
  checkedAt?: number;
  checking?: Promise<void>;
}

export interface Pick {
  harness: Harness;
  /** Shown to the user before the run starts (fallbacks, missing media kinds). */
  note?: string;
  /** For each media kind the skill uses: capable agents, best first (empty: none here). */
  media?: Record<string, Harness[]>;
}

/**
 * Knows every harness on this computer: detects them (cached for 30 s), keeps the user's
 * preferences and picks one per run (research R6).
 */
export class HarnessRegistry {
  private entries = new Map<string, Entry>();
  private timer: Timer | undefined;
  private store: Store;
  private clock: Clock;
  readonly rejected: { file: string; reason: string }[];
  private overrides: Record<string, string[]>;

  constructor(options: {
    harnesses: { harness: Harness; kind: "builtin" | "descriptor" }[];
    store: Store;
    clock: Clock;
    rejected?: { file: string; reason: string }[];
    /** `<home>/capabilities.json` (spec 008 FR-002). */
    overrides?: Record<string, string[]>;
  }) {
    for (const item of options.harnesses) this.entries.set(item.harness.id, { ...item });
    this.store = options.store;
    this.clock = options.clock;
    this.rejected = options.rejected ?? [];
    this.overrides = options.overrides ?? {};
  }

  /** Media kinds an agent can make: what it reports, plus the user's overrides. */
  private capabilities(entry: Entry): string[] {
    const reported =
      entry.status?.capabilities ?? (entry.status?.canGenerateImages ? ["image"] : []);
    return capabilitiesOf(entry.harness.id, reported, this.overrides);
  }

  private async fresh(): Promise<void> {
    const stale = [...this.entries.values()].filter(
      (entry) => !entry.checkedAt || this.clock.now() - entry.checkedAt > STALE_MS,
    );
    await Promise.all(stale.map((entry) => this.check(entry)));
  }

  private async check(entry: Entry): Promise<void> {
    entry.checking ??= entry.harness
      .check()
      .catch((error: unknown) => ({
        installed: false,
        signedIn: false,
        canGenerateImages: false,
        detail: error instanceof Error ? error.message : String(error),
      }))
      .then((status) => {
        entry.status = status;
        entry.checkedAt = this.clock.now();
        entry.checking = undefined;
      });
    return entry.checking;
  }

  refresh(): Promise<void> {
    return Promise.all([...this.entries.values()].map((entry) => this.check(entry))).then(
      () => undefined,
    );
  }

  /** Probes now and every 30 s (FR-001). */
  startRefreshing(): void {
    void this.refresh();
    this.timer = this.clock.setInterval(() => void this.refresh(), STALE_MS);
  }

  stop(): void {
    this.timer?.cancel();
  }

  private ready(entry: Entry): boolean {
    return Boolean(entry.status?.installed && entry.status.signedIn);
  }

  preferences(): HarnessPreferences {
    const raw = this.store.meta(PREFS_KEY, () =>
      JSON.stringify({ default: null, perSkill: {}, perCapability: {}, order: DEFAULT_ORDER }),
    );
    const prefs = {
      perCapability: {},
      ...(JSON.parse(raw) as Partial<HarnessPreferences>),
    } as HarnessPreferences;
    const known = [...this.entries.keys()];
    // New harnesses (descriptors) join the end of the order.
    return {
      ...prefs,
      order: [
        ...prefs.order.filter((id) => known.includes(id)),
        ...known.filter((id) => !prefs.order.includes(id)),
      ],
    };
  }

  setPreferences(patch: Partial<HarnessPreferences>): HarnessPreferences {
    const ids = [...this.entries.keys()];
    const check = (id: string | null | undefined) => {
      if (id && !ids.includes(id))
        throw new RunError("unknown_harness", `There is no agent named "${id}".`, 400);
    };
    check(patch.default);
    Object.values(patch.perSkill ?? {}).forEach(check);
    Object.values(patch.perCapability ?? {}).forEach(check);
    for (const kind of Object.keys(patch.perCapability ?? {}))
      if (!Object.hasOwn(MEDIA_KINDS, kind))
        throw new RunError("unknown_media", `Seleya does not know the media kind "${kind}".`, 400);
    patch.order?.forEach(check);
    const next = { ...this.preferences(), ...patch };
    this.store.setMeta(PREFS_KEY, JSON.stringify(next));
    return next;
  }

  /** Ready agents in the user's order, the wanted ones first. */
  private ordered(wanted: (string | null | undefined)[]): Entry[] {
    const prefs = this.preferences();
    const ids = [...new Set([...wanted.filter((id): id is string => Boolean(id)), ...prefs.order])];
    return ids
      .map((id) => this.entries.get(id))
      .filter((entry): entry is Entry => Boolean(entry && this.ready(entry)));
  }

  /** Agents that can make a media kind now, best first: the user's pick for the kind, then order. */
  async pickFor(kind: string): Promise<Harness[]> {
    await this.fresh();
    return this.capableFor(kind).map((entry) => entry.harness);
  }

  private capableFor(kind: string): Entry[] {
    return this.ordered([this.preferences().perCapability[kind]]).filter((entry) =>
      this.capabilities(entry).includes(kind),
    );
  }

  /** For every media kind: the agents that can make it now (empty: none). */
  async mediaAvailability(): Promise<Record<string, Harness[]>> {
    await this.fresh();
    return Object.fromEntries(
      Object.keys(MEDIA_KINDS).map((kind) => [kind, this.capableFor(kind).map((e) => e.harness)]),
    );
  }

  /**
   * Routes a run (FR-007, FR-008, spec 008 FR-004/FR-006): the main agent, and for each media kind
   * the skill uses, the agents that can make it. A required kind nobody can make refuses the run.
   */
  async pick(skill: SkillMeta, requested?: string): Promise<Pick> {
    await this.fresh();
    const prefs = this.preferences();
    const wanted = [requested, prefs.perSkill[skill.name], prefs.default].filter(
      (id): id is string => Boolean(id),
    );
    const ready = this.ordered(wanted);
    if (ready.length === 0)
      throw new RunError(
        "no_harness",
        "No AI agent is ready on this computer. Open Agents to see what to sign in to.",
        409,
      );

    const media = Object.fromEntries(
      skill.needs.map((kind) => [kind, this.capableFor(kind).map((entry) => entry.harness)]),
    );
    const missing = skill.needs.filter((kind) => (media[kind] ?? []).length === 0);
    const required = missing.filter((kind) => skill.mediaRequired.includes(kind));
    if (required.length) throw new RunError("capability_missing", missingMessage(required), 409);

    // Inline: the agent itself makes the media, so it must have every kind it can get.
    const chosen =
      skill.media === "inline" && skill.needs.length
        ? (ready.find((entry) =>
            skill.needs
              .filter((kind) => !missing.includes(kind))
              .every((kind) => this.capabilities(entry).includes(kind)),
          ) ?? ready[0]!)
        : ready[0]!;
    const notes: string[] = [];
    const first = wanted[0];
    if (first && chosen.harness.id !== first) {
      const name = this.entries.get(first)?.harness.name ?? first;
      notes.push(`${name} is not available, so ${chosen.harness.name} is doing this one.`);
    }
    for (const kind of missing)
      notes.push(
        `No agent here can make ${pluralOf(kind)}, so ${chosen.harness.name} will do without them.`,
      );
    if (skill.media === "delegated")
      for (const kind of skill.needs) {
        // A kind that is not missing has at least one capable agent.
        const maker = media[kind]?.[0];
        if (maker) notes.push(`${MEDIA_KINDS[kind]?.label ?? kind}s will be made by ${maker.name}.`);
      }
    return { harness: chosen.harness, note: notes.join(" ") || undefined, media };
  }

  statusJson() {
    return [...this.entries.values()].map((entry) => ({
      id: entry.harness.id,
      name: entry.harness.name,
      kind: entry.kind,
      installed: entry.status?.installed ?? false,
      signed_in: entry.status?.signedIn ?? false,
      ready: this.ready(entry),
      version: entry.status?.version,
      can_generate_images: this.capabilities(entry).includes("image"),
      capabilities: this.capabilities(entry),
      workers: entry.status?.workers?.map((worker) => ({
        id: worker.id,
        capabilities: capabilitiesOf(worker.id, worker.capabilities, this.overrides),
      })),
      sign_in_command: entry.status?.signInCommand,
      detail: entry.status?.detail,
      checked_at: entry.checkedAt ? new Date(entry.checkedAt).toISOString() : null,
    }));
  }

  get(id: string): Harness | undefined {
    return this.entries.get(id)?.harness;
  }
}

/** "This needs audio, and no agent on this computer can make audio…" (spec 008 FR-006). */
export function missingMessage(kinds: string[]): string {
  const names = kinds.map(pluralOf).join(" and ");
  return `This needs ${names}, and no agent on this computer can make ${names}. Open Agents to sign in to one that can, or add the ability in capabilities.json.`;
}
