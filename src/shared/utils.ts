// Shared utility functions across extension contexts.

export function parseNumberOr<T extends number>(value: unknown, fallback: T): T {
  if (typeof value === 'number' && Number.isFinite(value)) return value as T;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed as T;
  }
  return fallback;
}
