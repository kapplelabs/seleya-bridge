import type { ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findBrowsers, launchBrowser } from "./launch.ts";
import { printCopy } from "./print.ts";

/**
 * One headless Chrome per runtime, driven over the DevTools protocol (research R1). Renders a design
 * page at an exact size to PNG and PDF and measures its text boxes, in a single page load.
 */
/** Rendering is not possible here right now (no browser, it would not start, or it stalled). */
export class RenderError extends Error {
  override name = "RenderError";
}

export function findChrome(): string | undefined {
  return findBrowsers()[0];
}

/** A text block as rendered: its box, its colour and its text. */
export interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Computed colour, RGBA 0–255 (alpha 0–1). */
  color: [number, number, number, number];
  /** Whether its content overflows its own box (clipped or spilling). */
  overflows: boolean;
  /** Whether it extends outside the page. */
  outside: boolean;
  /** The fact or keep-together phrase that wraps across lines, or false. */
  wrapsMidFact: string | false;
}

export interface RenderResult {
  png: Buffer;
  /** Same page with all text transparent (for contrast sampling). */
  background: Buffer;
  pdf?: Buffer;
  text: string;
  boxes: TextBox[];
  /** Document size, to detect a page bigger than declared. */
  scrollWidth: number;
  scrollHeight: number;
}

type CdpMessage = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
  method?: string;
  sessionId?: string;
};

class Cdp {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket.close();
  }
}

/** Measures text blocks inside the page (runs in the browser). */
const MEASURE = (keepTogether: string[]) => `((keep) => {
  const FACT = /(\\d{1,2}[:h]\\d{2})|(\\d{1,2}[\\/.-]\\d{1,2}([\\/.-]\\d{2,4})?)|([\\w.+-]+@[\\w-]+\\.[\\w.]+)|((?:https?:\\/\\/)?[\\w-]+(?:\\.[\\w-]+)+(?:\\/\\S*)?)|(\\+?\\d[\\d .-]{6,}\\d)/g;
  const page = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
  const parse = (c) => { const m = c.match(/[\\d.]+/g) || ["0","0","0","1"]; return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])]; };
  // Text hidden by an ancestor that clips its overflow (a list cut off at the bottom of its box).
  const clippedByAncestor = (el, r) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflow === "visible" && cs.overflowY === "visible" && cs.overflowX === "visible") continue;
      const ar = a.getBoundingClientRect();
      if (r.bottom > ar.bottom + 1 || r.right > ar.right + 1 || r.top < ar.top - 1 || r.left < ar.left - 1) return true;
    }
    return false;
  };
  const boxes = [];
  for (const el of document.body.querySelectorAll("*")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join(" ").replace(/\\s+/g, " ").trim();
    if (!own) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const range = document.createRange(); range.selectNodeContents(el);
    const lines = [...range.getClientRects()];
    let wrapsMidFact = false;
    // Facts (dates, times, prices, contacts) and the phrases the skill asked to keep together
    // (names, addresses) must sit on one line: a phrase wraps when its glyphs span several lines.
    const phrases = [...[...own.matchAll(FACT)].map((m) => m[0]), ...keep.filter((k) => own.includes(k))];
    for (const phrase of phrases) {
      const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes(phrase));
      if (!textNode) continue;
      const start = textNode.textContent.indexOf(phrase);
      const sub = document.createRange(); sub.setStart(textNode, start); sub.setEnd(textNode, start + phrase.length);
      const tops = new Set([...sub.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
      if (tops.size > 1) wrapsMidFact = phrase;
    }
    boxes.push({
      text: own, x: r.left, y: r.top, width: r.width, height: r.height,
      color: parse(style.color),
      overflows: (style.overflow !== "visible" && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) || lines.some((q) => q.right > r.right + 2) || clippedByAncestor(el, r),
      outside: r.left < -1 || r.top < -1 || r.right > page.w + 1 || r.bottom > page.h + 1,
      wrapsMidFact,
    });
  }
  return JSON.stringify({ text: document.body.innerText, boxes, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight });
})(${JSON.stringify(keepTogether)})`;

const HIDE_TEXT = `(() => { const s = document.createElement("style"); s.textContent = "*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important;caret-color:transparent !important}"; document.head.appendChild(s); return true; })()`;

export class ChromeRenderer {
  private process: ChildProcess | undefined;
  private cdp: Promise<Cdp> | undefined;
  private dataDir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(home: string) {
    this.dataDir = path.join(home, "chrome");
  }

  private start(): Promise<Cdp> {
    this.cdp ??= (async () => {
      const launched = await launchBrowser(this.dataDir);
      this.process = launched.process;
      const socket = new WebSocket(launched.endpoint);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome.")), {
          once: true,
        });
      });
      return new Cdp(socket);
    })().catch((error: unknown) => {
      this.cdp = undefined;
      throw error;
    });
    return this.cdp;
  }

  /**
   * Renders one HTML file at an exact size. Renders run one at a time. Any failure is a RenderError:
   * the post-processors then deliver the design without rendering instead of failing the run.
   */
  render(
    file: string,
    width: number,
    height: number,
    options: { pdf?: boolean; keepTogether?: string[] } = {},
  ): Promise<RenderResult> {
    // A PDF prints from a copy whose large PNGs are JPEG (print.ts): Chrome stalls on them.
    const job = this.queue
      .then(async () => this.renderNow(options.pdf ? await printCopy(file) : file, width, height, options))
      .catch((error: unknown) => {
        throw new RenderError(error instanceof Error ? error.message : String(error));
      });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async renderNow(
    file: string,
    width: number,
    height: number,
    options: { pdf?: boolean; keepTogether?: string[] },
  ): Promise<RenderResult> {
    const cdp = await this.start();
    // Renders run one at a time, so a call Chrome never answers would block every later render
    // (a deck's PDF once stalled for 14 min): every call gets a deadline, closing the page too.
    let stalled = false;
    const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
      new Promise<unknown>((resolve, reject) => {
        const limitMs = method === "Page.printToPDF" ? 120_000 : 30_000;
        const timer = setTimeout(() => {
          stalled = true;
          reject(new Error(`Chrome did not finish ${method} within ${limitMs / 1000} s`));
        }, limitMs);
        cdp.send(method, params, sessionId).then(
          (value) => (clearTimeout(timer), resolve(value)),
          (error: unknown) => (clearTimeout(timer), reject(error)),
        );
      });
    const { targetId } = (await call("Target.createTarget", { url: "about:blank" })) as {
      targetId: string;
    };
    const { sessionId } = (await call("Target.attachToTarget", { targetId, flatten: true })) as {
      sessionId: string;
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      call(method, params, sessionId);
    try {
      await send("Page.enable");
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send("Page.navigate", { url: pathToFileURL(file).href });
      // Wait for load, fonts and images.
      for (let attempt = 0; attempt < 150; attempt++) {
        const state = (await send("Runtime.evaluate", {
          expression:
            "document.readyState === 'complete' && document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete)",
          returnByValue: true,
        })) as { result: { value: boolean } };
        if (state.result.value) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const measured = (await send("Runtime.evaluate", {
        expression: MEASURE(options.keepTogether ?? []),
        returnByValue: true,
      })) as { result: { value: string } };
      const page = JSON.parse(measured.result.value) as Pick<
        RenderResult,
        "text" | "boxes" | "scrollWidth" | "scrollHeight"
      >;
      const clip = { x: 0, y: 0, width, height, scale: 1 };
      const shot = (await send("Page.captureScreenshot", {
        format: "png",
        clip,
        captureBeyondViewport: false,
      })) as { data: string };
      const pdf = options.pdf
        ? ((await send("Page.printToPDF", {
            paperWidth: width / 96,
            paperHeight: height / 96,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            printBackground: true,
            preferCSSPageSize: false,
          })) as { data: string })
        : undefined;
      await send("Runtime.evaluate", { expression: HIDE_TEXT, returnByValue: true });
      const background = (await send("Page.captureScreenshot", {
        format: "png",
        clip,
        captureBeyondViewport: false,
      })) as { data: string };
      return {
        ...page,
        png: Buffer.from(shot.data, "base64"),
        background: Buffer.from(background.data, "base64"),
        pdf: pdf ? Buffer.from(pdf.data, "base64") : undefined,
      };
    } finally {
      // A Chrome that stopped answering is restarted for the next render: closing its page would
      // wait forever (a poster run once timed out this way after all its checks had passed).
      if (stalled) await this.close();
      else await call("Target.closeTarget", { targetId }).catch(() => this.close());
    }
  }

  /**
   * One PDF from several same-size pages (both faces of a card, a deck): a wrapper page stacks
   * them as frames, one per printed page.
   */
  async pdfOfPages(
    folder: string,
    files: string[],
    width: number,
    height: number,
  ): Promise<Buffer> {
    const wrapper = path.join(folder, ".pages.html");
    const printed = await Promise.all(files.map((file) => printCopy(file)));
    const frames = printed
      .map(
        (file) =>
          `<iframe src="${pathToFileURL(file).href}" style="display:block;width:${width}px;height:${height}px;border:0;break-after:page"></iframe>`,
      )
      .join("");
    writeFileSync(
      wrapper,
      `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0}</style></head><body>${frames}</body></html>`,
    );
    try {
      const result = await this.render(wrapper, width, height, { pdf: true });
      if (!result.pdf) throw new Error("no PDF");
      return result.pdf;
    } finally {
      rmSync(wrapper, { force: true });
    }
  }

  async close(): Promise<void> {
    if (this.cdp) (await this.cdp.catch(() => undefined))?.close();
    this.process?.kill();
    this.cdp = undefined;
  }
}
