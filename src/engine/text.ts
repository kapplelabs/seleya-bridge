/**
 * Line-buffered, redacted streaming of one text block (docs/gateway.md §6.5). Redaction works on whole
 * values, so a delta never ends inside a line: an address or a token split between two provider deltas is
 * seen whole before any of it is sent.
 */
import { Redactor } from "../redact.ts";

/**
 * Text is streamed a line at a time, redacted, so a value is never split between two deltas before
 * redaction sees it whole. A line longer than this is sent up to its last space instead.
 */
export const MAX_HELD_TEXT = 1000;

/** Cuts text to at most `max` characters, the last one an ellipsis. */
export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One text block: takes the provider's raw deltas, hands `send` the redacted text it adds. */
export class TextStream {
  /** Everything the provider wrote, unredacted. */
  private raw = "";
  /** The redacted text the stream already carried. */
  private sent = "";
  private ended = false;
  private readonly send: (text: string) => void;

  constructor(send: (text: string) => void) {
    this.send = send;
  }

  /** The block as sent so far; after end(), the whole block redacted. */
  get text(): string {
    return this.sent;
  }

  get done(): boolean {
    return this.ended;
  }

  /** Holds the text back until its line is complete; see MAX_HELD_TEXT. */
  append(text: string): void {
    if (this.ended || !text) return;
    this.raw += text;
    let end = this.raw.lastIndexOf("\n") + 1;
    if (this.raw.length - end > MAX_HELD_TEXT) end = Math.max(end, this.raw.lastIndexOf(" ") + 1);
    // A scratch redactor: the run's count is taken once per block, in end().
    if (end > 0) this.push(new Redactor().text(this.raw.slice(0, end)));
  }

  /**
   * Closes the block: redacts all of it with `redactor` (the run's, so each block counts exactly once),
   * sends what is still held back and returns the whole block redacted. Later calls change nothing.
   */
  end(redactor: Redactor): string {
    if (this.ended) return this.sent;
    this.ended = true;
    const redacted = redactor.text(this.raw);
    this.push(redacted);
    this.sent = redacted;
    return redacted;
  }

  /** Sends what the redacted text adds to what the stream already carried. */
  private push(redacted: string): void {
    if (redacted.length <= this.sent.length) return;
    const text = redacted.slice(this.sent.length);
    this.sent = redacted;
    this.send(text);
  }
}
