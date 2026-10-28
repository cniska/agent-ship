export type Table = Readonly<Record<string, unknown>>;

export function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
