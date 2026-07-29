import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlock, deriveFrequency, validateDiagnosis } from '../record-diagnosis.js';
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

test('validateDiagnosis accepts a clean diagnosis', () => {
	assert.equal(validateDiagnosis(diagnosis()), null);
});

test('validateDiagnosis rejects a confidence outside high/medium/low', () => {
	// The exact bug that shipped: a whole phrase as confidence renders 🟡 + a
	// title-cased dump instead of a level.
	assert.match(validateDiagnosis({ ...diagnosis(), confidence: 'high-root-cause-supervisor-ordering-race' }), /confidence must be one of/);
	assert.match(validateDiagnosis({ ...diagnosis(), confidence: undefined }), /confidence must be one of/);
});

test('validateDiagnosis requires a summary', () => {
	assert.match(validateDiagnosis({ ...diagnosis(), summary: '' }), /summary is required/);
	assert.match(validateDiagnosis({ ...diagnosis(), summary: '   ' }), /summary is required/);
});

test('validateDiagnosis rejects a multi-line or overlong summary', () => {
	// The other half of the shipped bug: the full mechanism dumped into the
	// one-line <summary> header.
	assert.match(validateDiagnosis({ ...diagnosis(), summary: 'line one\nline two' }), /single line/);
	assert.match(validateDiagnosis({ ...diagnosis(), summary: 'x'.repeat(601) }), /chars; keep it under/);
});

test('deriveFrequency renders one clause per branch, scoped to matching environments (never blended)', () => {
	const history = {
		branchSummary: { mainRuns: 317 },
		patterns: [
			{
				id: 'A', count: 34, environments: ['ubuntu/chromium'],
				rates: [
					{ branch: 'feature/x', count: 4, environmentRuns: 4, ratePercent: 100 },
					{ branch: 'main', count: 30, environmentRuns: 157, ratePercent: 19.1 },
				],
			},
			{ id: 'B', count: 1, environments: ['ubuntu/electron'], rates: [{ branch: 'main', count: 1, environmentRuns: 317, ratePercent: 0.3 }] },
		],
	};
	assert.equal(deriveFrequency(history, 'A'), '4/4 runs (100%) on feature/x; 30/157 runs (19.1%) on main, ubuntu/chromium');
	assert.equal(deriveFrequency(history, 'B'), '1/317 runs (0.3%) on main, ubuntu/electron');
	assert.equal(deriveFrequency(null, 'A'), null);
	// A selected-but-unmatched pattern returns null, never the dominant pattern's numbers.
	assert.equal(deriveFrequency(history, 'Z'), null);
	// No selection falls back to the dominant (first) pattern.
	assert.equal(deriveFrequency(history, null), '4/4 runs (100%) on feature/x; 30/157 runs (19.1%) on main, ubuntu/chromium');
	// Missing environment_breakdown data (environmentRuns null) still renders a count, no bogus rate.
	const noBreakdown = { patterns: [{ id: 'C', count: 2, environments: [], rates: [{ branch: 'main', count: 2, environmentRuns: null, ratePercent: null }] }] };
	assert.equal(deriveFrequency(noBreakdown, 'C'), '2 runs on main');
});
