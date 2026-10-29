export type Table = Readonly<Record<string, unknown>>;

export function parsedJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

export function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
