import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeApprovalThresholds } from '../dist/shared/approval.js';

test('normalizeApprovalThresholds migrates legacy defaults', () => {
  const result = normalizeApprovalThresholds({
    rawUsd: 0.25,
    rawChars: 25000,
    defaultUsd: 1.0,
    defaultChars: 100000
  });

  assert.equal(result.approvalThresholdUsd, 1.0);
  assert.equal(result.approvalThresholdChars, 100000);
  assert.equal(result.migrated, true);
  assert.equal(result.migratedUsd, true);
  assert.equal(result.migratedChars, true);
});

test('normalizeApprovalThresholds migrates legacy defaults stored as strings', () => {
  const result = normalizeApprovalThresholds({
    rawUsd: '0.25',
    rawChars: '25000',
    defaultUsd: 1.0,
    defaultChars: 100000
  });

  assert.equal(result.approvalThresholdUsd, 1.0);
  assert.equal(result.approvalThresholdChars, 100000);
  assert.equal(result.migrated, true);
  assert.equal(result.migratedUsd, true);
  assert.equal(result.migratedChars, true);
});

test('normalizeApprovalThresholds preserves custom values', () => {
  const result = normalizeApprovalThresholds({
    rawUsd: 0.5,
    rawChars: 50000,
    defaultUsd: 1.0,
    defaultChars: 100000
  });

  assert.equal(result.approvalThresholdUsd, 0.5);
  assert.equal(result.approvalThresholdChars, 50000);
  assert.equal(result.migrated, false);
  assert.equal(result.migratedUsd, false);
  assert.equal(result.migratedChars, false);
});

test('normalizeApprovalThresholds falls back to defaults when missing', () => {
  const result = normalizeApprovalThresholds({
    rawUsd: undefined,
    rawChars: undefined,
    defaultUsd: 1.0,
    defaultChars: 100000
  });

  assert.equal(result.approvalThresholdUsd, 1.0);
  assert.equal(result.approvalThresholdChars, 100000);
  assert.equal(result.migrated, false);
});
