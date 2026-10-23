/**
 * Seleya's wire format is snake_case (its axios layer and `gatewayPayload` convert to camelCase), so
 * the bridge keeps camelCase internally and converts keys only when writing a response or SSE frame.
 */
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/** Converts object keys (never values) to snake_case, recursively; drops undefined fields. */
export function keysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keysToSnakeCase);
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined) result[snake(key)] = keysToSnakeCase(field);
  }
  return result;
}
