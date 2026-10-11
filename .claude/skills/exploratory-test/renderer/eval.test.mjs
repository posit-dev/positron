/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ablate, fill, loadCase, parseGrade, summarize } from './eval.mjs';

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals');

test('ablate cuts each span, and throws when the rule text is gone', () => {
	const text = 'One.\n\nCut from here. Middle. To here.\n\nTwo.\n';
	assert.equal(ablate(text, [{ from: 'Cut from', to: 'To here.' }]), 'One.\n\nTwo.\n');
	assert.throws(() => ablate(text, [{ from: 'Reworded', to: 'To here.' }]), /not in the prompt: "Reworded"/);
	assert.throws(() => ablate(text, [{ from: 'Cut from', to: 'Gone.' }]), /not in the prompt: "Gone\."/);
});

// A rule reworded in its prompt would otherwise surface only when someone pays for a run.
test('every eval case still finds its rule in its prompt', () => {
	for (const name of readdirSync(EVALS_DIR).filter(n => !n.startsWith('.'))) {
		const c = loadCase(join(EVALS_DIR, name));
		assert.ok(c.without.length < c.with.length, name);
	}
});

test('parseGrade reads the first word, and summarize counts passes per arm', () => {
	assert.deepEqual(['PASS - it runs a baseline', '**FAIL**\nno control', 'Maybe'].map(parseGrade), ['pass', 'fail', null]);
	assert.deepEqual(summarize([
		{ case: 'c', arm: 'with', grade: 'pass', costUsd: 0.5, gradeCostUsd: 0.01 },
		{ case: 'c', arm: 'with', grade: 'fail', costUsd: 0.5, gradeCostUsd: 0.01 },
		{ case: 'c', arm: 'without', error: 'boom' },
	]), [
		{ case: 'c', arm: 'with', pass: 1, graded: 2, costUsd: 1.02 },
		{ case: 'c', arm: 'without', pass: 0, graded: 0, costUsd: 0 },
	]);
});

test('fill takes a value for each placeholder, else points to the fixture', () => {
	assert.equal(fill('Report: `{{REPORT}}` and {{CHANGE_SCOPE}}', { CHANGE_SCOPE: 'No base.' }), 'Report: `(given below)` and No base.');
});
