/**
 * Checks a rendered design (spec 004 FR-009–FR-012, research R2–R4). Pure functions over what the
 * renderer measured, so they are tested without Chrome.
 */
import type { TextBox } from "../render/chrome.ts";
import type { Pixels } from "../render/png.ts";
import type { CheckResult } from "../runs/types.ts";

/** Facts: dates, times, prices and numbers, emails, web addresses, phone numbers. */
const FACT_PATTERNS: RegExp[] = [
  /\b\d{1,2}[:h]\d{2}\b/gi, // times
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, // dates
  /[\w.+-]+@[\w-]+\.[\w.]+/g, // emails
  /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, // web addresses
  /\+?\d[\d .-]{6,}\d/g, // phone numbers
  /\b\d{2,}(?:[.,]\d+)*\s?(?:k|đ|vnd|usd|\$|%)?/gi, // numbers and prices (2+ digits)
];

/** Lowercase, collapse spaces, unify date separators; diacritics are kept (Vietnamese matters). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[‐-―]/g, "-")
    .replace(/(\d)[.-](\d)/g, "$1/$2")
    .replace(/\s+/g, " ")
    .trim();
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

export function factsIn(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of FACT_PATTERNS)
    for (const match of text.matchAll(pattern)) found.add(match[0].trim());
  return [...found].filter((fact) => fact.length > 1);
}

/** Every fact on the design must come from the request (FR-009). */
export function checkFacts(designText: string, requestText: string): CheckResult {
  const source = normalize(requestText);
  const sourceDigits = digitsOf(requestText);
  const invented = factsIn(designText).filter((fact) => {
    const value = normalize(fact).replace(/^https?:\/\//, "");
    if (source.includes(value)) return false;
    // Numbers formatted differently (19:00 vs 19h00, 0901 234 567 vs 0901234567) count as present.
    const digits = digitsOf(fact);
    return !(digits.length >= 2 && sourceDigits.includes(digits));
  });
  return {
    name: "facts",
    passed: invented.length === 0,
    findings: invented.map(
      (fact) =>
        `"${fact}" is on the design but not in the request. Remove it or use only facts the request gives.`,
    ),
    attempt: 0,
  };
}

/** Quoted text in the request must appear verbatim (FR-009). */
export function checkQuotes(designText: string, requestText: string): CheckResult {
  const quotes = [...requestText.matchAll(/["“”«»]([^"“”«»]{2,80})["“”«»]/g)].map(([, quote = ""]) =>
    quote.trim(),
  );
  const design = normalize(designText);
  const missing = quotes.filter((quote) => !design.includes(normalize(quote)));
  return {
    name: "quoted text",
    passed: missing.length === 0,
    findings: missing.map(
      (quote) => `"${quote}" was quoted in the request, so it must appear exactly as written.`,
    ),
    attempt: 0,
  };
}

/**
 * How often `needle` appears on its own in `haystack`: not inside a longer token, so a website
 * hidden inside an email address ("x@vulcanlabs.co") does not count as the website.
 */
export function countStandalone(haystack: string, needle: string): number {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}@._/-])${escaped}(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}])`,
    "gu",
  );
  return [...haystack.matchAll(pattern)].length;
}

/** Listed items (menu items, contact lines) each appear exactly once (FR-009). */
export function checkInventory(designText: string, items: string[]): CheckResult {
  const design = normalize(designText);
  const findings: string[] = [];
  for (const item of items) {
    const needle = normalize(item);
    if (!needle) continue;
    let count = countStandalone(design, needle);
    // "Name — price" is usually laid out as two columns: the name once, and its price present.
    const parts = item
      .split(/\s+[—–\-|:]\s+|\t|\s{2,}/)
      .map((part) => normalize(part))
      .filter(Boolean);
    if (count === 0 && parts.length > 1) {
      const nameCount = countStandalone(design, parts[0]!);
      const restPresent = parts.slice(1).every((part) => design.includes(part));
      count = restPresent ? nameCount : 0;
    }
    if (count === 0)
      findings.push(`"${item}" is missing. Every listed item must appear once, on its own.`);
    else if (count > 1) findings.push(`"${item}" appears ${count} times. It must appear once.`);
  }
  return { name: "listed items", passed: findings.length === 0, findings, attempt: 0 };
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrastRatio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Contrast of each text block against the rendered pixels behind it, using the least-contrasting
 * 10% of those pixels (FR-010). Blocks smaller than a few pixels are ignored.
 */
export function checkContrast(boxes: TextBox[], background: Pixels, minimum = 4.5): CheckResult {
  const findings: string[] = [];
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(background.width, Math.ceil(box.x + box.width));
    const y1 = Math.min(background.height, Math.ceil(box.y + box.height));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const [r, g, b, alpha] = box.color;
    const ratios: number[] = [];
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
    for (let y = y0; y < y1; y += step)
      for (let x = x0; x < x1; x += step) {
        // x and y stay inside the image, so the pixel exists.
        const index = (y * background.width + x) * 4;
        const [br, bg, bb] = [
          background.data[index]!,
          background.data[index + 1]!,
          background.data[index + 2]!,
        ];
        // Semi-transparent text is blended over the pixel behind it.
        const fr = r * alpha + br * (1 - alpha);
        const fg = g * alpha + bg * (1 - alpha);
        const fb = b * alpha + bb * (1 - alpha);
        ratios.push(contrastRatio(luminance(fr, fg, fb), luminance(br, bg, bb)));
      }
    if (ratios.length === 0) continue;
    ratios.sort((a, c) => a - c);
    const worst = ratios[Math.floor(ratios.length * 0.1)]!;
    if (worst < minimum)
      findings.push(
        `"${box.text.slice(0, 60)}" has contrast ${worst.toFixed(1)}:1 against what is behind it (needs ${minimum}:1). Darken or lighten the text, or add a solid or gradient backing behind it.`,
      );
  }
  return { name: "contrast", passed: findings.length === 0, findings, attempt: 0 };
}

/** No text clipped, outside the design, or a fact or name wrapped mid-way (FR-010). */
export function checkLayout(
  boxes: TextBox[],
  scroll: { width: number; height: number },
  size: { width: number; height: number },
): CheckResult {
  const findings: string[] = [];
  for (const box of boxes) {
    const label = `"${box.text.slice(0, 60)}"`;
    if (box.outside)
      findings.push(
        `${label} extends outside the design. Keep every text inside the page with a margin.`,
      );
    else if (box.overflows)
      findings.push(
        `${label} is cut off or spills out of its box. Shorten it or give it more room.`,
      );
    if (box.wrapsMidFact)
      findings.push(
        `"${box.wrapsMidFact}" breaks across two lines. Keep it on one line (make the text smaller or the box wider).`,
      );
  }
  if (scroll.width > size.width + 1 || scroll.height > size.height + 1)
    findings.push(
      `The page is ${scroll.width}×${scroll.height} px but must be exactly ${size.width}×${size.height} px with nothing outside it.`,
    );
  return { name: "layout", passed: findings.length === 0, findings, attempt: 0 };
}

/** The design has the parts this usecase needs (FR-012). */
export function checkParts(parts: { name: string; ok: boolean }[]): CheckResult {
  const missing = parts.filter((part) => !part.ok).map((part) => part.name);
  return {
    name: "required parts",
    passed: missing.length === 0,
    findings: missing.map((name) => `The design is missing its ${name}.`),
    attempt: 0,
  };
}

/** A generated visual must not contain text or a watermark (FR-011). */
export function checkVisualText(
  lines: { text: string; confidence: number }[] | undefined,
): CheckResult {
  if (!lines)
    return {
      name: "text in visual",
      passed: true,
      findings: ["Not checked: text recognition is not available on this computer."],
      attempt: 0,
    };
  const words = lines.filter((line) => line.confidence >= 0.5 && /[\p{L}]{3,}/u.test(line.text));
  return {
    name: "text in visual",
    passed: words.length === 0,
    findings: words.map(
      (line) =>
        `The generated visual contains text ("${line.text.slice(0, 40)}"). Regenerate it with no text, letters or watermark.`,
    ),
    attempt: 0,
  };
}
