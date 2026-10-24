/**
 * Slide decks (spec 005): the agent writes structured slides; Seleya renders them with its own
 * themes (decision FR-004), so text edits re-render without the agent and overflow is checkable.
 * Spec 008 FR-009: slides may carry a generated image (made by an agent that can make images) and
 * use image, key-number and card layouts; without an image a slide shows the theme's artwork.
 */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

export type SlideLayout =
  | "cover"
  | "section"
  | "bullets"
  | "two-column"
  | "quote"
  | "closing"
  | "image-left"
  | "image-right"
  | "image-full"
  | "stats"
  | "cards";
export const LAYOUTS: SlideLayout[] = [
  "cover",
  "section",
  "bullets",
  "two-column",
  "quote",
  "closing",
  "image-left",
  "image-right",
  "image-full",
  "stats",
  "cards",
];

/** A generated picture for a slide: `out/media/<id>.png`, made from `prompt` (spec 008). */
export interface SlideImage {
  id: string;
  prompt?: string;
}

export interface Slide {
  layout: SlideLayout;
  heading: string;
  /** Small label above the heading. */
  kicker?: string;
  body?: string;
  bullets?: string[];
  /** two-column: the right column's bullets. */
  right?: string[];
  /** stats: key numbers, only figures given in the brief. */
  stats?: { value: string; label: string }[];
  /** cards: 2–4 short points with a title each. */
  cards?: { title: string; body?: string }[];
  image?: SlideImage;
  notes?: string;
}

export interface Deck {
  title: string;
  theme: ThemeId;
  slides: Slide[];
}

export type ThemeId = "midnight" | "paper" | "aurora" | "ember" | "fresh";

interface Theme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  display: string;
  body: string;
  /** Decorative layer behind the content. */
  art: string;
  /** Stands in for a picture when there is none. */
  placeholder: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  midnight: {
    background: "linear-gradient(135deg,#0b1220 0%,#111c33 100%)",
    surface: "rgba(255,255,255,0.06)",
    text: "#f4f7fb",
    muted: "#b6c2d6",
    accent: "#5ad1ff",
    accent2: "#8b7bff",
    display: "'Be Vietnam Pro'",
    body: "'Be Vietnam Pro'",
    art: "radial-gradient(600px 400px at 92% 8%,rgba(90,209,255,.18),transparent 70%),radial-gradient(500px 380px at 0% 100%,rgba(139,123,255,.16),transparent 70%),repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 48px),repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 48px)",
    placeholder: "linear-gradient(140deg,#13325a 0%,#1d1f4f 55%,#3a2a7a 100%)",
  },
  paper: {
    background: "#f7f4ee",
    surface: "#ffffff",
    text: "#1d1f24",
    muted: "#4d5360",
    accent: "#c2410c",
    accent2: "#1f4e5f",
    display: "'Playfair Display'",
    body: "'Be Vietnam Pro'",
    art: "radial-gradient(420px 420px at 100% 0%,rgba(194,65,12,.08),transparent 70%),linear-gradient(90deg,transparent 0 87px,rgba(29,31,36,.08) 87px 88px,transparent 88px)",
    placeholder: "linear-gradient(150deg,#e8dccb 0%,#d9c2a3 50%,#b98c66 100%)",
  },
  aurora: {
    background: "linear-gradient(140deg,#1b1035 0%,#2c1a5c 55%,#0f3d4c 100%)",
    surface: "rgba(255,255,255,0.08)",
    text: "#fbf8ff",
    muted: "#d3c9ee",
    accent: "#7cf5c6",
    accent2: "#ff9bd2",
    display: "'Lexend'",
    body: "'Be Vietnam Pro'",
    art: "radial-gradient(520px 360px at 85% 15%,rgba(124,245,198,.22),transparent 70%),radial-gradient(560px 420px at 10% 95%,rgba(255,155,210,.2),transparent 70%)",
    placeholder: "linear-gradient(140deg,#3b2a7a 0%,#1f6b74 60%,#7cf5c6 140%)",
  },
  ember: {
    background: "linear-gradient(150deg,#1c120e 0%,#2a1a14 60%,#3a2016 100%)",
    surface: "rgba(255,236,220,0.07)",
    text: "#fff6ee",
    muted: "#e3cbb8",
    accent: "#ffb36b",
    accent2: "#e8655a",
    display: "'Playfair Display'",
    body: "'Be Vietnam Pro'",
    art: "radial-gradient(560px 400px at 95% 0%,rgba(255,179,107,.2),transparent 70%),radial-gradient(480px 360px at 0% 100%,rgba(232,101,90,.16),transparent 70%)",
    placeholder: "linear-gradient(150deg,#5a3423 0%,#8a4b2c 55%,#d9875a 100%)",
  },
  fresh: {
    background: "#f3faf7",
    surface: "#ffffff",
    text: "#10231c",
    muted: "#46605a",
    accent: "#0f9d75",
    accent2: "#2563eb",
    display: "'Lexend'",
    body: "'Be Vietnam Pro'",
    art: "radial-gradient(460px 460px at 100% 0%,rgba(15,157,117,.12),transparent 70%),radial-gradient(420px 360px at 0% 100%,rgba(37,99,235,.08),transparent 70%)",
    placeholder: "linear-gradient(150deg,#c9efe1 0%,#8fd6bd 50%,#3fae8a 100%)",
  },
};

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown) =>
  Array.isArray(value)
    ? value.map(str).filter(Boolean)
    : typeof value === "string"
      ? [value.trim()].filter(Boolean)
      : [];
const records = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && !!item)
    : [];

function readImage(value: unknown, index: number): SlideImage | undefined {
  if (typeof value === "string" && value.trim())
    return { id: `slide-${String(index + 1).padStart(2, "0")}`, prompt: value.trim() };
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const id = str(raw.id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return undefined;
  return { id, prompt: str(raw.prompt) || undefined };
}

/** Reads one slide as the agent wrote it, tolerating small shape differences. */
export function readSlide(raw: unknown, index: number): Slide {
  const value = (raw ?? {}) as Record<string, unknown>;
  const layout =
    LAYOUTS.find((item) => item === value.layout) ?? (index === 0 ? "cover" : "bullets");
  const stats = records(value.stats)
    .map((item) => ({ value: str(item.value), label: str(item.label) }))
    .filter((item) => item.value)
    .slice(0, 4);
  const cards = records(value.cards)
    .map((item) => ({ title: str(item.title), body: str(item.body) || undefined }))
    .filter((item) => item.title)
    .slice(0, 4);
  return {
    layout,
    heading: str(value.heading) || str(value.title) || `Slide ${index + 1}`,
    kicker: str(value.kicker) || undefined,
    body: str(value.body) || undefined,
    bullets: list(value.bullets ?? value.points),
    right: list(value.right),
    stats: stats.length ? stats : undefined,
    cards: cards.length ? cards : undefined,
    image: readImage(value.image, index),
    notes: str(value.notes) || undefined,
  };
}

export function readDeck(raw: unknown): Deck {
  const value = (raw ?? {}) as Record<string, unknown>;
  const theme = (Object.keys(THEMES) as ThemeId[]).find((id) => id === value.theme) ?? "midnight";
  const slides = Array.isArray(value.slides) ? value.slides.map(readSlide) : [];
  return { title: str(value.title) || slides[0]?.heading || "Deck", theme, slides };
}

/**
 * A key number's size: short values ("3", "12") stay big; long ones ("7:00–22:00") shrink so they fit
 * their card on one line (cards narrow as more stand side by side).
 */
function statSize(value: string, cards: number): number {
  const width = cards >= 4 ? 230 : cards === 3 ? 320 : cards === 2 ? 500 : 1000;
  return Math.max(36, Math.min(96, Math.floor(width / Math.max(1, value.length * 0.62))));
}

const bulletsHtml = (items: string[] | undefined) =>
  items?.length
    ? `<ul class="bullets">${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`
    : "";
const kickerHtml = (slide: Slide) =>
  slide.kicker ? `<p class="kicker">${escape(slide.kicker)}</p>` : "";
const pictureHtml = (src: string | undefined, extra = "") =>
  src
    ? `<div class="media ${extra}"><img src="${escape(src)}" alt=""></div>`
    : `<div class="media placeholder ${extra}"></div>`;

/**
 * One slide as a self-contained 1280×720 page in the deck's theme. `imageSrc` is the slide's
 * picture, relative to the HTML file, when it exists.
 */
/**
 * A printable speaker-notes page for one slide (spec 005 US3: notes go into the PDF). Placed right
 * after its slide in the deck PDF; never shown as a slide image.
 */
export function notesHtml(
  slide: Slide,
  deck: Pick<Deck, "theme" | "title">,
  number: number,
  total: number,
): string | undefined {
  const notes = slide.notes?.trim();
  if (!notes) return undefined;
  const theme = THEMES[deck.theme];
  const paragraphs = notes
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escape(line)}</p>`)
    .join("");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap"><style>
html,body{margin:0;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;background:#fff;color:#1b1f24;font-family:"Be Vietnam Pro",Arial,sans-serif}
.notes{box-sizing:border-box;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;padding:72px 96px;display:flex;flex-direction:column;gap:20px}
.label{margin:0;font-size:16px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:${theme.accent}}
h1{margin:0;font-size:34px;line-height:1.2}
.text{display:flex;flex-direction:column;gap:12px;font-size:22px;line-height:1.55;color:#333a42;overflow:hidden}
.text p{margin:0}
.foot{margin-top:auto;font-size:15px;color:#8a929b}
</style></head><body><div class="notes"><p class="label">Speaker notes · slide ${number} of ${total}</p><h1>${escape(slide.heading)}</h1><div class="text">${paragraphs}</div><p class="foot">${escape(deck.title)}</p></div></body></html>`;
}

export function slideHtml(
  slide: Slide,
  deck: Pick<Deck, "theme" | "title">,
  number: number,
  total: number,
  imageSrc?: string,
  /** Below 1: the text is scaled down to fit (Seleya's own fix for a slide that overflows). */
  fit = 1,
): string {
  const theme = THEMES[deck.theme];
  const fonts =
    "family=Be+Vietnam+Pro:wght@400;500;600;700&family=Playfair+Display:wght@600;700&family=Lexend:wght@500;600;700";
  const index = String(number).padStart(2, "0");
  // A content slide with a picture but a text layout shows it beside the text.
  const layout =
    imageSrc && (slide.layout === "bullets" || slide.layout === "two-column")
      ? "image-right"
      : slide.layout;
  let onImage = false;
  const content = (() => {
    switch (layout) {
      case "cover":
        if (imageSrc) {
          onImage = true;
          return `${pictureHtml(imageSrc, "bleed")}<div class="scrim left"></div><div class="cover-copy">${kickerHtml(slide) || (deck.title !== slide.heading ? `<p class="kicker">${escape(deck.title)}</p>` : "")}<h1 class="display xl">${escape(slide.heading)}</h1>${slide.body ? `<p class="lead">${escape(slide.body)}</p>` : ""}</div>`;
        }
        return `<div class="orb"></div><div class="center cover">${kickerHtml(slide) || (deck.title !== slide.heading ? `<p class="kicker">${escape(deck.title)}</p>` : "")}<h1 class="display xl">${escape(slide.heading)}</h1><span class="rule"></span>${slide.body ? `<p class="lead">${escape(slide.body)}</p>` : ""}</div>`;
      case "section":
        return `<div class="center"><span class="index">${index}</span>${kickerHtml(slide)}<h1 class="display">${escape(slide.heading)}</h1>${slide.body ? `<p class="lead">${escape(slide.body)}</p>` : ""}</div>`;
      case "quote":
        return `<div class="center quote"><span class="mark">“</span><blockquote>${escape(slide.body ?? slide.heading)}</blockquote>${slide.body ? `<p class="cite">— ${escape(slide.heading)}</p>` : ""}</div>`;
      case "two-column":
        return `<div class="stack">${kickerHtml(slide)}<h2>${escape(slide.heading)}</h2><div class="columns"><div class="column">${slide.body ? `<p class="body">${escape(slide.body)}</p>` : ""}${bulletsHtml(slide.bullets)}</div><div class="column panel">${bulletsHtml(slide.right)}</div></div></div>`;
      case "image-left":
      case "image-right":
        return `<div class="split ${layout === "image-left" ? "left" : "right"}">${pictureHtml(imageSrc)}<div class="copy">${kickerHtml(slide)}<h2>${escape(slide.heading)}</h2>${slide.body ? `<p class="body">${escape(slide.body)}</p>` : ""}${bulletsHtml(slide.bullets)}</div></div>`;
      case "image-full":
        onImage = Boolean(imageSrc);
        return `${pictureHtml(imageSrc, "bleed")}<div class="scrim bottom"></div><div class="full-copy">${kickerHtml(slide)}<h1 class="display">${escape(slide.heading)}</h1>${slide.body ? `<p class="lead">${escape(slide.body)}</p>` : ""}</div>`;
      case "stats":
        return `<div class="stack">${kickerHtml(slide)}<h2>${escape(slide.heading)}</h2>${slide.body ? `<p class="body">${escape(slide.body)}</p>` : ""}<div class="grid n${slide.stats?.length ?? 0}">${(slide.stats ?? []).map((stat) => `<div class="stat"><span class="value" style="font-size:${statSize(stat.value, slide.stats?.length ?? 1)}px">${escape(stat.value)}</span><span class="label">${escape(stat.label)}</span></div>`).join("")}</div>${slide.stats?.length ? "" : bulletsHtml(slide.bullets)}</div>`;
      case "cards":
        return `<div class="stack">${kickerHtml(slide)}<h2>${escape(slide.heading)}</h2>${slide.body ? `<p class="body">${escape(slide.body)}</p>` : ""}<div class="grid n${slide.cards?.length ?? 0}">${(slide.cards ?? []).map((card, position) => `<div class="card"><span class="num">${String(position + 1).padStart(2, "0")}</span><h3>${escape(card.title)}</h3>${card.body ? `<p>${escape(card.body)}</p>` : ""}</div>`).join("")}</div>${slide.cards?.length ? "" : bulletsHtml(slide.bullets)}</div>`;
      case "closing":
        if (imageSrc) onImage = true;
        return `${imageSrc ? `${pictureHtml(imageSrc, "bleed")}<div class="scrim even"></div>` : '<div class="orb"></div>'}<div class="center closing">${kickerHtml(slide)}<h1 class="display">${escape(slide.heading)}</h1>${slide.body ? `<p class="lead">${escape(slide.body)}</p>` : ""}${slide.bullets?.length ? `<div class="chips">${slide.bullets.map((item) => `<span>${escape(item)}</span>`).join("")}</div>` : ""}</div>`;
      default:
        return `<div class="stack">${kickerHtml(slide)}<h2>${escape(slide.heading)}</h2>${slide.body ? `<p class="body">${escape(slide.body)}</p>` : ""}${bulletsHtml(slide.bullets)}</div>`;
    }
  })();
  const pad = 88;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap"><style>
html,body{margin:0;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden}
body{background:${theme.background};color:${theme.text};font-family:${theme.body},Arial,sans-serif}
.slide{position:relative;box-sizing:border-box;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;padding:76px ${pad}px 84px;overflow:hidden;display:flex;flex-direction:column}
.slide::before{content:"";position:absolute;inset:0;background:${theme.art};pointer-events:none}
.slide>*{position:relative}
.slide.on-image{color:#fff}
.stack{margin:auto 0;display:flex;flex-direction:column;min-height:0;max-height:100%;overflow:hidden}
.stack .columns{flex:0 1 auto}
.center{margin:auto 0;display:flex;flex-direction:column;gap:22px;max-width:1000px;overflow:hidden}
.center.cover{max-width:880px}
.display{font-family:${theme.display},Arial,sans-serif;font-size:60px;line-height:1.08;margin:0;font-weight:700;letter-spacing:-.01em}
.display.xl{font-size:76px}
.kicker{margin:0 0 14px;color:${theme.accent};font-size:18px;letter-spacing:.16em;text-transform:uppercase;font-weight:700}
.center .kicker,.cover-copy .kicker,.full-copy .kicker{margin:0}
.lead{margin:0;color:${theme.muted};font-size:28px;line-height:1.4;max-width:860px}
.on-image .lead{color:rgba(255,255,255,.86)}
.on-image .kicker{color:#fff;opacity:.9}
h2{font-family:${theme.display},Arial,sans-serif;font-size:46px;line-height:1.12;margin:0 0 26px;font-weight:700;letter-spacing:-.01em}
.body{margin:0 0 22px;color:${theme.muted};font-size:24px;line-height:1.45}
.bullets{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px;overflow:hidden}
.bullets li{font-size:26px;line-height:1.35;padding-left:36px;position:relative}
.bullets li::before{content:"";position:absolute;left:2px;top:12px;width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,${theme.accent},${theme.accent2})}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:40px;flex:1;min-height:0;overflow:hidden}
.column{min-height:0;overflow:hidden}
.panel{background:${theme.surface};border-radius:22px;padding:30px;border:1px solid rgba(127,127,127,.14)}
.rule{width:120px;height:6px;border-radius:3px;background:linear-gradient(90deg,${theme.accent},${theme.accent2})}
.orb{position:absolute;right:-140px;top:50%;width:560px;height:560px;margin-top:-280px;border-radius:50%;background:radial-gradient(circle at 30% 30%,${theme.accent},${theme.accent2} 60%,transparent 72%);opacity:.22;filter:blur(2px)}
.index{font-family:${theme.display},Arial,sans-serif;font-size:150px;line-height:.9;font-weight:700;color:transparent;-webkit-text-stroke:2px ${theme.accent};opacity:.85}
.quote .mark{font-family:${theme.display},Georgia,serif;font-size:200px;line-height:.6;height:90px;color:${theme.accent};opacity:.5}
blockquote{margin:0;font-family:${theme.display},Arial,sans-serif;font-size:44px;line-height:1.25;font-weight:600}
.cite{margin:0;color:${theme.muted};font-size:24px}
.media{overflow:hidden;background:${theme.placeholder}}
.media img{display:block;width:100%;height:100%;object-fit:cover}
.media.placeholder{background:${theme.placeholder}}
.media.placeholder::after{content:"";position:absolute;inset:0;background:radial-gradient(300px 220px at 70% 30%,rgba(255,255,255,.25),transparent 70%)}
.media.bleed{position:absolute;inset:0}
.scrim{position:absolute;inset:0}
.scrim.left{background:linear-gradient(90deg,rgba(6,8,14,.86) 0%,rgba(6,8,14,.6) 45%,rgba(6,8,14,.05) 80%)}
.scrim.bottom{background:linear-gradient(0deg,rgba(6,8,14,.88) 0%,rgba(6,8,14,.45) 45%,rgba(6,8,14,0) 75%)}
.scrim.even{background:rgba(6,8,14,.62)}
.cover-copy{margin:auto 0;display:flex;flex-direction:column;gap:22px;max-width:720px}
.full-copy{margin-top:auto;display:flex;flex-direction:column;gap:18px;max-width:900px}
.split{position:absolute;inset:0;display:grid;grid-template-columns:520px 1fr}
.split.right{grid-template-columns:1fr 520px}
.split .media{position:relative;height:100%}
.split.right .media{order:2}
.split .copy{box-sizing:border-box;padding:76px 64px 92px;display:flex;flex-direction:column;justify-content:center;min-height:0;overflow:hidden}
.split.left .copy{padding-right:${pad}px}
.split.right .copy{padding-left:${pad}px}
.split h2{font-size:42px}
.split .bullets li{font-size:24px}
.grid{display:grid;gap:24px;margin-top:8px}
.grid.n1{grid-template-columns:1fr}.grid.n2{grid-template-columns:repeat(2,1fr)}.grid.n3{grid-template-columns:repeat(3,1fr)}.grid.n4{grid-template-columns:repeat(4,1fr)}
.stat,.card{background:${theme.surface};border-radius:22px;padding:30px 28px;border:1px solid rgba(127,127,127,.14);display:flex;flex-direction:column;gap:12px;overflow:hidden}
.stat{padding:36px 32px;min-height:190px;justify-content:flex-end}
.stat .value{font-family:${theme.display},Arial,sans-serif;font-size:96px;line-height:1;font-weight:700;color:${theme.accent};white-space:nowrap}
.stat .label{font-size:22px;line-height:1.35;color:${theme.muted}}
.card{min-height:230px}
.card .num{font-size:16px;font-weight:700;letter-spacing:.14em;color:${theme.accent}}
.card h3{margin:auto 0 0;font-size:28px;line-height:1.2;font-weight:700}
.card p{margin:0;font-size:20px;line-height:1.45;color:${theme.muted}}
.closing{align-items:center;text-align:center;margin:auto;max-width:960px}
.chips{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.chips span{padding:10px 20px;border-radius:999px;font-size:20px;background:${theme.surface};border:1px solid rgba(127,127,127,.2)}
.on-image .chips span{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3)}
.footer{position:absolute;left:${pad}px;right:${pad}px;bottom:30px;display:flex;justify-content:space-between;align-items:center;color:${theme.muted};font-size:15px;letter-spacing:.04em}
.on-image .footer{color:rgba(255,255,255,.78)}
.split ~ .footer{display:none}
.progress{position:absolute;left:0;bottom:0;height:5px;width:${((number / Math.max(total, 1)) * 100).toFixed(2)}%;background:linear-gradient(90deg,${theme.accent},${theme.accent2})}${fit < 1 ? `\n.stack,.center,.cover-copy,.copy,.full-copy{zoom:${fit}}` : ""}
</style></head><body><div class="slide${onImage ? " on-image" : ""}">${content}<div class="footer"><span>${escape(deck.title)}</span><span>${index} / ${String(total).padStart(2, "0")}</span></div><div class="progress"></div></div></body></html>`;
}
