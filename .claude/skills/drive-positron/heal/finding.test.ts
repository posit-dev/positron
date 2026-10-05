/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { addFields, readFindings, readState, slug, validateFinding, writeFinding, writeState, type Finding } from './finding.ts';

const base = (): Finding => ({
	id: 'smoke-start-session-r', source: 'smoke', case: 'start-session r', helper: 'start-session.sh',
	steps: ['start-session.sh --language r'], observed: '2 rows match R', expected: 'one R session',
	reproductions: [
		{ at: '2026-10-06T03:40:00Z', by: 'smoke', result: 'fail', observed: '2 rows match R' },
		{ at: '2026-10-06T03:50:00Z', by: 'rerun', result: 'fail', observed: '2 rows match R' },
	],
});

test('slug makes a file-safe id', () => {
	assert.equal(slug('start-session python, one open already'), 'start-session-python-one-open-already');
});

test('a well-formed finding validates', () => {
	assert.deepEqual(validateFinding(base()), []);
});

test('validation names each missing or bad field', () => {
	const bad = { ...base(), helper: '', outcome: 'maybe', reproductions: [] } as unknown;
	const problems = validateFinding(bad);
	assert.ok(problems.some(p => p.includes('helper')));
	assert.ok(problems.some(p => p.includes('outcome')));
	assert.ok(problems.some(p => p.includes('reproductions')));
});

test('a finder finding needs two failing reproductions', () => {
	const f = { ...base(), id: 'finder-x', source: 'finder' as const, case: undefined, reproductions: [base().reproductions[0]] };
	assert.ok(validateFinding(f).some(p => p.includes('two failing reproductions')));
});

test('resolved needs resolvedBy', () => {
	assert.ok(validateFinding({ ...base(), outcome: 'resolved' }).some(p => p.includes('resolvedBy')));
});

test('addFields adds and appends reproductions', () => {
	const f = addFields(base(), { outcome: 'fixed', reason: 'selector', reproductions: [{ at: 'x', by: 'fixer', result: 'fail', observed: 'o' }] });
	assert.equal(f.outcome, 'fixed');
	assert.equal(f.reproductions.length, 3);
});

test('addFields refuses to change a field already written', () => {
	assert.throws(() => addFields(base(), { observed: 'something else' }), /append-only.*observed/);
	const fixed = addFields(base(), { outcome: 'fixed' });
	assert.throws(() => addFields(fixed, { outcome: 'resolved' }), /append-only.*outcome/);
});

test('write then read round-trips, sorted by id', () => {
	const dir = mkdtempSync(join(tmpdir(), 'heal-'));
	writeFinding(dir, { ...base(), id: 'smoke-b' });
	writeFinding(dir, { ...base(), id: 'smoke-a' });
	assert.deepEqual(readFindings(dir).map(f => f.id), ['smoke-a', 'smoke-b']);
	assert.deepEqual(readFindings(join(dir, 'missing')), []);
});

test('state merges', () => {
	const dir = mkdtempSync(join(tmpdir(), 'heal-'));
	writeState(dir, { wholesale: false });
	writeState(dir, { gate: 'pass' });
	assert.deepEqual(readState(dir), { wholesale: false, gate: 'pass' });
});
