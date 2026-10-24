/**
 * Removes personal and security-sensitive data from connector content before it goes anywhere: contact
 * details (email addresses, phone numbers), credentials (keys, tokens, passwords, sign-in codes, private
 * keys), financial and government ids (card numbers, IBANs, SSNs, passport/CCCD numbers), IP addresses
 * and links that carry access (meeting joins, webhooks, signed URLs). People's display names stay: a
 * briefing needs to say who wrote.
 *
 * Each match becomes a placeholder such as `[email]` or `[secret]`, so Claude (and the user) can see
 * something was there without seeing it. Pattern-based, so it is a safety net: the prompts also tell
 * Claude to leave such data out.
 */

export type RedactionKind = "secret" | "email" | "phone" | "card" | "id" | "ip" | "link";

interface Rule {
  kind: RedactionKind;
  pattern: RegExp;
  /** Replacement for one match; return the match itself to keep it. Defaults to the placeholder. */
  replace?: (match: string, ...groups: string[]) => string;
}

const placeholder = (kind: RedactionKind) => `[${kind}]`;

const digits = (text: string) => text.replace(/\D/g, "");

/** Card numbers pass the Luhn check; random long numbers (order ids, timestamps) mostly don't. */
function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Hosts whose links let anyone holding them in: meetings and incoming webhooks. */
const ACCESS_LINK_HOSTS = [
  /(^|\.)meet\.google\.com$/,
  /(^|\.)zoom\.us$/,
  /(^|\.)teams\.microsoft\.com$/,
  /(^|\.)teams\.live\.com$/,
  /(^|\.)webex\.com$/,
  /(^|\.)hooks\.slack\.com$/,
];

/** Query parameters that carry access: dropped from links that are otherwise kept. */
const SENSITIVE_PARAM = /token|key|secret|sig|signature|auth|code|pass|pwd|session|credential|otp/i;

function redactUrl(match: string): string {
  // Sentence punctuation after a link isn't part of it.
  const raw = match.replace(/[.,;:!?]+$/, "");
  const trailing = match.slice(raw.length);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return match;
  }
  if (url.username || url.password) return placeholder("link") + trailing;
  if (ACCESS_LINK_HOSTS.some((host) => host.test(url.hostname))) return placeholder("link") + trailing;
  if (/\/api\/webhooks\//.test(url.pathname)) return placeholder("link") + trailing;
  let changed = false;
  for (const name of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (url.hash && SENSITIVE_PARAM.test(url.hash)) {
    url.hash = "";
    changed = true;
  }
  return changed ? url.toString() + trailing : match;
}

/** Applied in order: credentials first, so a token inside a URL or after "password:" goes as a whole. */
const RULES: Rule[] = [
  {
    kind: "secret",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  // JSON Web Tokens.
  { kind: "secret", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: "secret",
    pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g,
    replace: (_match, scheme = "") => `${scheme} ${placeholder("secret")}`,
  },
  // Well-known key and token formats (Anthropic, OpenAI, GitHub, GitLab, Slack, AWS, Google, Stripe, npm, SendGrid).
  {
    kind: "secret",
    pattern:
      /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprse]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}|npm_[A-Za-z0-9]{36}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})/g,
  },
  // Before "token=…" below, so a link loses only its sensitive parameters.
  { kind: "link", pattern: /\bhttps?:\/\/[^\s<>"'`()[\]]+/g, replace: redactUrl },
  // "password: hunter2", "api_key=…", "token is …", also as JSON ("secret": "…").
  {
    kind: "secret",
    pattern:
      /\b(password|passwd|passphrase|pwd|passcode|mật khẩu|secret|client[_ -]?secret|api[_ -]?key|apikey|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|id[_ -]?token|token|private[_ -]?key)(["']?\s*(?:[:=]|\bis\b|\blà\b)\s*["']?)([^\s"',;]{4,})/gi,
    replace: (_match, key = "", separator = "") => `${key}${separator}${placeholder("secret")}`,
  },
  // Sign-in and verification codes: "Your code is 482913", "OTP: 1234", "mã xác nhận 123456".
  {
    kind: "secret",
    pattern:
      /\b(code|OTP|PIN|passcode|mã(?: xác (?:nhận|thực)| OTP)?)(\s*(?:is|:|là)?\s*)(\d{4,8})\b/gi,
    replace: (_match, word = "", separator = "") => `${word}${separator}${placeholder("secret")}`,
  },
  {
    kind: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  {
    kind: "card",
    // 14–19 digits: 13-digit epoch milliseconds (Gmail's internalDate) are left alone.
    pattern: /\b\d(?:[ -]?\d){13,18}\b/g,
    replace: (match) => (luhn(digits(match)) ? placeholder("card") : match),
  },
  // IBAN.
  { kind: "id", pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g },
  // US SSN.
  { kind: "id", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Ids named as such: passport, national id (CCCD/CMND), tax id, bank account.
  {
    kind: "id",
    pattern:
      /\b(SSN|passport(?: no\.?| number)?|CCCD|CMND|national id|tax id|MST|account (?:no\.?|number)|số tài khoản|STK)(\s*(?:is|:|#|là)?\s*)([A-Z]{0,2}\d[\d -]{4,18}\d)/gi,
    replace: (_match, word = "", separator = "") => `${word}${separator}${placeholder("id")}`,
  },
  {
    kind: "ip",
    pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
  },
  // Phone numbers: international (+84 912 345 678), local with a leading 0 (0912 345 678), US formats.
  {
    kind: "phone",
    pattern:
      /(?<![\w+#])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\w-])|(?<![\w#.-])0\d{2,3}(?:[ .-]?\d{3,4}){2}(?![\w-])|(?<![\w#])\(\d{3}\) ?\d{3}[ .-]\d{4}(?![\w-])|(?<![\w#.-])\d{3}[.-]\d{3}[.-]\d{4}(?![\w-])/g,
    replace: (match) => {
      const count = digits(match).length;
      return count >= 8 && count <= 15 ? placeholder("phone") : match;
    },
  },
];

/** JSON keys whose values are credentials whatever they hold. Pagination tokens (nextPageToken) stay. */
const SECRET_KEY =
  /^(password|passwd|pwd|secret|client_?secret|token|access_?token|refresh_?token|id_?token|api_?key|authorization|cookie|set-cookie|private_?key|otp|ssn)$/i;

/** Redacts strings and JSON values, counting what it removed. One per run, so the counts add up. */
export class Redactor {
  private readonly counts = new Map<RedactionKind, number>();

  /** How many values were removed so far. */
  get total(): number {
    let total = 0;
    for (const count of this.counts.values()) total += count;
    return total;
  }

  private add(kind: RedactionKind) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }

  text(input: string): string {
    let output = input;
    for (const rule of RULES) {
      output = output.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
        const groups = rest.filter((item): item is string => typeof item === "string");
        const next = rule.replace ? rule.replace(match, ...groups) : placeholder(rule.kind);
        if (next !== match) this.add(rule.kind);
        return next;
      });
    }
    // "Jane Doe <[email]>" reads better as "Jane Doe".
    return output.replace(/\s*<\[email\]>/g, "");
  }

  /**
   * Deep copy of a JSON-like value with every string redacted, keys included, and credential fields
   * blanked.
   */
  value(input: unknown): unknown {
    return this.walk(input);
  }

  private walk(input: unknown): unknown {
    if (typeof input === "string") return this.text(input);
    if (Array.isArray(input)) return input.map((item) => this.walk(item));
    if (typeof input !== "object" || input === null) return input;
    const result = new Map<string, unknown>();
    for (const [key, field] of Object.entries(input)) {
      if (SECRET_KEY.test(key)) {
        // A credential's name is not itself sensitive: the key stays, its value goes.
        const blank = field === null || field === "";
        if (!blank) this.add("secret");
        result.set(uniqueKey(result, key), blank ? field : placeholder("secret"));
        continue;
      }
      // A map-shaped output ("sender → count") can put an address or a token in a key.
      result.set(uniqueKey(result, this.text(key)), this.walk(field));
    }
    // fromEntries defines own properties, so a "__proto__" key can't change the copy's prototype.
    return Object.fromEntries(result);
  }
}

/**
 * Keys that redact to the same text ("a@x.com" and "b@y.com" → "[email]") are kept apart as
 * "[email]", "[email] (2)", "[email] (3)"…: the values stay, in order, and a reader still sees how many.
 */
function uniqueKey(taken: Map<string, unknown>, key: string): string {
  if (!taken.has(key)) return key;
  let n = 2;
  while (taken.has(`${key} (${n})`)) n++;
  return `${key} (${n})`;
}
