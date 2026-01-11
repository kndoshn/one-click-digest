function parseNumberOr(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return fallback;
}
export function normalizeApprovalThresholds(input) {
    const LEGACY_USD = 0.25;
    const LEGACY_CHARS = 25_000;
    const rawUsd = input.rawUsd;
    const rawChars = input.rawChars;
    const rawUsdStr = typeof rawUsd === 'string' ? rawUsd.trim() : '';
    const rawCharsStr = typeof rawChars === 'string' ? rawChars.trim() : '';
    const legacyUsd = rawUsd === LEGACY_USD || rawUsdStr === String(LEGACY_USD);
    const legacyChars = rawChars === LEGACY_CHARS || rawCharsStr === String(LEGACY_CHARS);
    const approvalThresholdUsd = legacyUsd ? input.defaultUsd : parseNumberOr(rawUsd, input.defaultUsd);
    const approvalThresholdChars = legacyChars ? input.defaultChars : Math.floor(parseNumberOr(rawChars, input.defaultChars));
    const migratedUsd = legacyUsd;
    const migratedChars = legacyChars;
    const migrated = migratedUsd || migratedChars;
    return { approvalThresholdUsd, approvalThresholdChars, migrated, migratedUsd, migratedChars };
}
