import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyNamesSpec, extractDiagnosisFields, deriveVerdict, assessSufficiency } from '../find-prior-triage.js';

test('bodyNamesSpec filters by exact spec path', () => {
	const body = 'blah\n- **Spec:** `test/e2e/tests/data-explorer.test.ts`\nblah';
	assert.equal(bodyNamesSpec(body, 'test/e2e/tests/data-explorer.test.ts'), true);
	assert.equal(bodyNamesSpec(body, 'test/e2e/tests/other.test.ts'), false);
	assert.equal(bodyNamesSpec(null, 'x'), false);
});

test('extractDiagnosisFields pulls hypothesis, targeted failure, and confidence', () => {
	const body = [
		'### E2E Triage Diagnosis',
		'<summary>🟢 <b>High confidence</b> -- interpreter selection races with disconnect</summary>',
		'- **Targeted failure:** `Test timeout of 120000ms exceeded`',
		'- **Hypothesis:** shared workspace state leak',
	].join('\n');
	const f = extractDiagnosisFields(body);
	assert.equal(f.confidence, 'high');
	assert.equal(f.targetedFailure, '`Test timeout of 120000ms exceeded`');
	assert.equal(f.hypothesis, 'shared workspace state leak');
});

test('extractDiagnosisFields falls back to the summary line when no Hypothesis bullet', () => {
	const body = '<summary>🟡 <b>Medium confidence</b> -- a fixture race</summary>';
	const f = extractDiagnosisFields(body);
	assert.equal(f.hypothesis, 'a fixture race');
	assert.equal(f.confidence, 'medium');
});

test('deriveVerdict prioritizes an open attempt', () => {
	assert.equal(deriveVerdict({ openAttempts: [{ number: 1 }], mergedAttempts: [], afterFixCount: 0, runsMeaningful: true }), 'open-attempt-in-flight');
});

test('deriveVerdict: recurrence after a merged fix', () => {
	assert.equal(deriveVerdict({ openAttempts: [], mergedAttempts: [{ number: 1 }], afterFixCount: 2, runsMeaningful: true }), 'recurred-after-fix');
});

test('deriveVerdict: fix holding vs too-recent', () => {
	assert.equal(deriveVerdict({ openAttempts: [], mergedAttempts: [{ number: 1 }], afterFixCount: 0, runsMeaningful: true }), 'fix-holding');
	assert.equal(deriveVerdict({ openAttempts: [], mergedAttempts: [{ number: 1 }], afterFixCount: 0, runsMeaningful: false }), 'too-recent-to-tell');
});

test('deriveVerdict: nothing found', () => {
	assert.equal(deriveVerdict({ openAttempts: [], mergedAttempts: [], afterFixCount: 0, runsMeaningful: true }), 'none');
});

test('assessSufficiency: no denominator is never meaningful', () => {
	// The regression this guards: a clean streak over an unknown number of runs
	// used to read as "fix-holding" off a single supplied occurrence SHA.
	assert.deepEqual(assessSufficiency({ postFixRuns: null, baselineRate: 0.5 }), {
		meaningful: false, postFixRuns: null, baselineRate: 0.5,
		environment: null, scopeWarning: null,
		probabilityIfUnfixed: null, runsNeeded: null,
	});
});

test('assessSufficiency: scores a clean streak against the baseline rate', () => {
	// 4 clean runs at a 50% baseline is ~6% -- suggestive, short of the 5% bar.
	const four = assessSufficiency({ postFixRuns: 4, baselineRate: 0.5 });
	assert.deepEqual(
		[four.meaningful, Number(four.probabilityIfUnfixed.toFixed(4)), four.runsNeeded],
		[false, 0.0625, 5]
	);
	assert.equal(assessSufficiency({ postFixRuns: 5, baselineRate: 0.5 }).meaningful, true);
	// A rare flake needs far more clean runs to clear the same bar.
	assert.equal(assessSufficiency({ postFixRuns: 5, baselineRate: 0.02 }).runsNeeded, 149);
});

test('assessSufficiency: warns when the numbers have no environment scope', () => {
	// Most flakes are lane-specific; an all-env run total inflates N and would
	// clear the bar on runs that never exercised the failing lane.
	assert.match(assessSufficiency({ postFixRuns: 5, baselineRate: 0.5 }).scopeWarning, /--environment/);
	assert.deepEqual(
		(({ environment, scopeWarning }) => ({ environment, scopeWarning }))(
			assessSufficiency({ postFixRuns: 5, baselineRate: 0.5, environment: 'ubuntu/chromium' })
		),
		{ environment: 'ubuntu/chromium', scopeWarning: null }
	);
	// Nothing to mis-scope when there is no denominator at all.
	assert.equal(assessSufficiency({ postFixRuns: null, baselineRate: 0.5 }).scopeWarning, null);
});

test('assessSufficiency: falls back to a run floor without a baseline', () => {
	assert.equal(assessSufficiency({ postFixRuns: 9, baselineRate: null }).meaningful, false);
	assert.equal(assessSufficiency({ postFixRuns: 10, baselineRate: null }).meaningful, true);
	// Out-of-range rates are treated as absent rather than trusted.
	assert.equal(assessSufficiency({ postFixRuns: 10, baselineRate: 1 }).baselineRate, null);
});
