// Shared utility functions across extension contexts.
export function parseNumberOr(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    // A blank string means "no value"; Number('') would turn it into 0.
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return fallback;
}
