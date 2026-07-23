import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock, deriveFrequency } from '../record-diagnosis.js';
import { extractDiagnosisFields } from '../find-prior-triage.js';

const meta = () => ({
	testName: 'Suite > case',
	testDetailViewUrl: 'https://dash/?test=x',
	frequency: null,
});

const diagnosis = () => ({
	confidence: 'high',
	summary: 'one-line hypothesis',
	targetedFailure: '`toBeVisible()` timed out',
	signal: 'markers render then disappear before the assertion',
	frequency: '5/313 runs (1.6%), ubuntu/electron',
	hypothesis: 'render/assert race',
});

test('renderBlock emits the heading, a linked Test line, and all fields', () => {
	const block = renderBlock(diagnosis(), meta());
	assert.match(block, /^### E2E Triage Diagnosis/);
	assert.match(block, /\[Suite > case\]\(https:\/\/dash\/\?test=x\)/);
	assert.match(block, /High confidence/);
	assert.match(block, /\u{1F7E2}/u); // green
});

test('renderBlock output is parseable by find-prior-triage extractor (round-trip)', () => {
	const block = renderBlock(diagnosis(), meta());
	const fields = extractDiagnosisFields(block);
	assert.equal(fields.confidence, 'high');
	assert.equal(fields.targetedFailure, '`toBeVisible()` timed out');
	assert.match(fields.hypothesis, /race/);
});

test('renderBlock includes a Supersedes line only when present', () => {
	assert.doesNotMatch(renderBlock(diagnosis(), meta()), /Supersedes/);
	const d = { ...diagnosis(), supersedes: '#123 (recurred 4x)' };
	assert.match(renderBlock(d, meta()), /\*\*Supersedes:\*\* #123 \(recurred 4x\)/);
});

test('renderBlock falls back to a plain title when no dashboard url', () => {
	const block = renderBlock(diagnosis(), { ...meta(), testDetailViewUrl: null });
	assert.match(block, /\*\*Test:\*\* Suite > case/);
	assert.doesNotMatch(block, /\]\(https/);
});

test('renderBlock maps confidence to emoji and defaults to medium', () => {
	assert.match(renderBlock({ ...diagnosis(), confidence: 'low' }, meta()), /\u{1F534}/u);
	assert.match(renderBlock({ hypothesis: 'x' }, meta()), /\u{1F7E1}/u); // medium default
});

test('deriveFrequency builds runs/percentage/env from the selected pattern', () => {
	const history = {
		branchSummary: { mainRuns: 317 },
		patterns: [
			{ id: 'A', count: 31, percentage: 9.8, environments: ['ubuntu/chromium'] },
			{ id: 'B', count: 1, percentage: 0.3, environments: ['ubuntu/electron'] },
		],
	};
	assert.equal(deriveFrequency(history, 'A'), '31/317 runs (9.8%), ubuntu/chromium');
	assert.equal(deriveFrequency(history, 'B'), '1/317 runs (0.3%), ubuntu/electron');
	assert.equal(deriveFrequency(null, 'A'), null);
});
