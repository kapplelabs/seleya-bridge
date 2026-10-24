/**
 * Seleya's wire format is snake_case (its axios layer and `gatewayPayload` convert to camelCase), so
 * the bridge keeps camelCase internally and converts keys only when writing a response or SSE frame.
 */
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/**
 * Data whose keys aren't the bridge's, sent as it is: a run's structured output (its schema came from the
 * request) and a tool's input (the tool's own argument names). JSON.stringify writes the value itself.
 */
class Verbatim {
  readonly value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }

  toJSON(): unknown {
    return this.value;
  }
}

export const verbatim = (value: unknown) => new Verbatim(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** Converts object keys (never values) to snake_case, recursively; drops undefined fields. Verbatim data stays. */
export function keysToSnakeCase(value: unknown): unknown {
  if (value instanceof Verbatim) return value;
  if (Array.isArray(value)) return value.map(keysToSnakeCase);
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined) result[snake(key)] = keysToSnakeCase(field);
  }
  return result;
}
