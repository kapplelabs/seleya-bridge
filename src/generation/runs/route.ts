import type { PostProcessor } from "./runner.ts";
import { defaultPostProcess } from "./runner.ts";

/**
 * Post-processing by result shape (spec 009): the skill the manifest names (a routed run's choice)
 * or the run's own skill says, through its recipe settings, whether it made design pages or a deck;
 * a skill without settings (a saved one) is judged by what its manifest holds.
 */
export function routedPostProcessor(fallback: {
  creative?: PostProcessor;
  slides?: PostProcessor;
}): PostProcessor {
  return async (context) => {
    const chosen = typeof context.manifest.skill === "string" ? context.manifest.skill : undefined;
    if (chosen === "none")
      throw new DeclinedError(
        typeof context.manifest.reason === "string"
          ? context.manifest.reason
          : "This request is not a still design or a deck, so nothing was made.",
      );
    const skill = (chosen ? context.skills.get(chosen) : undefined) ?? context.skill;
    if (skill.settings?.result === "pages") return (fallback.creative ?? defaultPostProcess)(context);
    if (skill.settings?.result === "deck") return (fallback.slides ?? defaultPostProcess)(context);
    if (Array.isArray(context.manifest.pages) || typeof context.manifest.html === "string")
      return (fallback.creative ?? defaultPostProcess)(context);
    if (typeof context.manifest.deck === "string")
      return (fallback.slides ?? defaultPostProcess)(context);
    return defaultPostProcess(context);
  };
}

/** The agent judged the request out of scope (spec 007 FR-003): shown as is, not as a crash. */
export class DeclinedError extends Error {
  override name = "DeclinedError";
}
