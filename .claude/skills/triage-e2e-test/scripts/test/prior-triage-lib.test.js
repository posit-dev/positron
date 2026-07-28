import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyNamesSpec, extractDiagnosisFields, deriveVerdict } from '../find-prior-triage.js';

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
