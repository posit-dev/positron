import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTriageId, buildMetricRecord } from '../lib.js';

test('deriveTriageId is stable, slugged, and hash-suffixed', () => {
	const id = deriveTriageId('Data Explorer > opens a file|||data-explorer.test.ts');
	assert.match(id, /^opens-a-file-[0-9a-f]{8}$/);
	// Stable across calls.
	assert.equal(id, deriveTriageId('Data Explorer > opens a file|||data-explorer.test.ts'));
});

test('deriveTriageId does not collide when two tests share a leaf name', () => {
	// Same leaf ("opens a file"), different suite + spec -> must be distinct dirs.
	const a = deriveTriageId('Data Explorer > opens a file|||data-explorer.test.ts');
	const b = deriveTriageId('Plots > opens a file|||plots.test.ts');
	assert.notEqual(a, b);
});

test('buildMetricRecord merges process-tracked ctx with domain fields', () => {
	const rec = buildMetricRecord(
		{ phase: 'history', patternsFound: 3 },
		{ ts: '2026-07-23T00:00:00.000Z', script: 'triage-history', durationMs: 1200, stdoutBytes: 900, rawBytesWritten: 800000 },
	);
	assert.deepEqual(rec, {
		ts: '2026-07-23T00:00:00.000Z',
		script: 'triage-history',
		durationMs: 1200,
		stdoutBytes: 900,
		rawBytesWritten: 800000,
		phase: 'history',
		patternsFound: 3,
	});
});
