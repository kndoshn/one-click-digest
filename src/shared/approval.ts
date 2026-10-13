import { parseNumberOr } from './utils.ts';

type NormalizeApprovalInput = {
  rawUsd: unknown;
  rawChars: unknown;
  defaultUsd: number;
  defaultChars: number;
};

export type ApprovalThresholds = {
  approvalThresholdUsd: number;
  approvalThresholdChars: number;
  migrated: boolean;
  migratedUsd: boolean;
  migratedChars: boolean;
};

export function normalizeApprovalThresholds(input: NormalizeApprovalInput): ApprovalThresholds {
  const LEGACY_USD = 0.25;
  const LEGACY_CHARS = 25_000;

  const rawUsd = input.rawUsd;
  const rawChars = input.rawChars;
  const rawUsdStr = typeof rawUsd === 'string' ? rawUsd.trim() : '';
  const rawCharsStr = typeof rawChars === 'string' ? rawChars.trim() : '';

  const legacyUsd = rawUsd === LEGACY_USD || rawUsdStr === String(LEGACY_USD);
  const legacyChars = rawChars === LEGACY_CHARS || rawCharsStr === String(LEGACY_CHARS);

  const approvalThresholdUsd = legacyUsd ? input.defaultUsd : parseNumberOr(rawUsd, input.defaultUsd);
  const approvalThresholdChars = legacyChars
    ? input.defaultChars
    : Math.floor(parseNumberOr(rawChars, input.defaultChars));

  return {
    approvalThresholdUsd,
    approvalThresholdChars,
    migrated: legacyUsd || legacyChars,
    migratedUsd: legacyUsd,
    migratedChars: legacyChars
  };
}
