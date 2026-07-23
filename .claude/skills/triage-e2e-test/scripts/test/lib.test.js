import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTriageId } from '../lib.js';

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
