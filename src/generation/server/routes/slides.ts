import { existsSync } from "node:fs";
import path from "node:path";

import type { LocalConfig } from "../../config.ts";
import { findDelivered } from "../../media/catalog.ts";
import type { ChromeRenderer } from "../../render/chrome.ts";
import { fileUrl } from "../../runs/events.ts";
import { RunError, type RunManager } from "../../runs/manager.ts";
import type { Store } from "../../runs/store.ts";
import { readDeck } from "../../slides/deck.ts";
import { loadDeck, renderDeck } from "../../slides/postprocess.ts";
import type { Route } from "../http.ts";

/**
 * A finished deck's content and images (spec 005). PUT re-renders edited content without the agent
 * (FR-009): the deck view's text edits reach the slides and the PDF in seconds.
 */
/** Adds a query parameter to a file URL that may already carry one (a bridge file ticket). */
const withQuery = (url: string, pair: string) => `${url}${url.includes("?") ? "&" : "?"}${pair}`;

export function slideRoutes(
  config: LocalConfig,
  store: Store,
  manager: RunManager,
  renderer: () => ChromeRenderer,
): Route[] {
  const deckJson = (runId: string) => {
    const run = manager.get(runId);
    if (run.skill !== "slides")
      throw new RunError("not_slides", "This run is not a slide deck.", 400);
    const folder = path.join(config.runsDir, runId);
    const deck = loadDeck(folder);
    const slides = deck.slides.map((slide, index) => {
      const png = `out/slides/${String(index + 1).padStart(2, "0")}.png`;
      const picture = slide.image
        ? findDelivered(path.join(folder, "out", "media"), slide.image.id, "image")
        : undefined;
      return {
        ...slide,
        // Spec 008: the generated picture on this slide, when one was made.
        picture_url: picture ? fileUrl(runId, path.relative(folder, picture)) : undefined,
        image_url: existsSync(path.join(folder, png))
          ? withQuery(fileUrl(runId, png), `v=${run.finishedAt ?? 0}`)
          : undefined,
      };
    });
    return {
      run_id: runId,
      title: deck.title,
      theme: deck.theme,
      slides,
      pdf_url: existsSync(path.join(folder, "out", "deck.pdf"))
        ? fileUrl(runId, "out/deck.pdf")
        : undefined,
      checks: run.checks,
    };
  };

  return [
    {
      method: "GET",
      pattern: /^\/slides\/([A-Za-z0-9_-]+)$/,
      handle: ({ params: [runId = ""] }) => deckJson(runId),
    },
    {
      method: "PUT",
      pattern: /^\/slides\/([A-Za-z0-9_-]+)$/,
      handle: async ({ params: [runId = ""], body }) => {
        const run = manager.get(runId);
        if (!["completed", "completed_with_issues"].includes(run.localStatus))
          throw new RunError("not_finished", "Edit the deck once it has finished.", 409);
        const deck = readDeck(await body());
        if (deck.slides.length === 0)
          throw new RunError("empty_deck", "A deck needs at least one slide.", 400);
        const folder = path.join(config.runsDir, run.id);
        const result = await renderDeck(renderer(), folder, deck, run.request, config.home);
        // Text edits keep the generated pictures and their media check (spec 008).
        store.updateRun(run.id, {
          outputs: [
            ...run.outputs.filter((output) => output.path.startsWith("out/media/")),
            ...result.outputs,
          ],
          checks: [...result.checks, ...run.checks.filter((check) => check.name === "media")],
          finishedAt: Date.now(),
        });
        // Spec 006: a deck already sent to the server is sent again with the edit.
        manager.emit(run.id, "seleya.run.updated", { reason: "edited" });
        return deckJson(run.id);
      },
    },
  ];
}
