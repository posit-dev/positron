import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckpoint, applyPatch, coerce, PHASES, PHASE_NEXT_ACTION, applyMutations, defaultNextAction } from '../checkpoint.js';

const valid = () => ({ version: 1, triageId: 'x', testKey: 'A > b|||spec.ts', phase: 'awaiting-pattern-selection' });

test('validateCheckpoint accepts a well-formed checkpoint', () => {
	assert.deepEqual(validateCheckpoint(valid()), { ok: true, errors: [] });
});

test('validateCheckpoint rejects bad version, missing key, unknown phase', () => {
	assert.equal(validateCheckpoint({ ...valid(), version: 2 }).ok, false);
	assert.equal(validateCheckpoint({ ...valid(), testKey: 'no-separator' }).ok, false);
	assert.equal(validateCheckpoint({ ...valid(), phase: 'bogus' }).ok, false);
	assert.equal(validateCheckpoint(null).ok, false);
});

test('every declared phase validates', () => {
	for (const phase of PHASES) {
		assert.equal(validateCheckpoint({ ...valid(), phase }).ok, true, phase);
	}
});

test('applyPatch deep-merges objects and replaces scalars/arrays', () => {
	const state = { phase: 'p', diagnosis: { a: 1, b: 2 }, patterns: ['A'] };
	const out = applyPatch(state, { phase: 'q', diagnosis: { b: 3, c: 4 }, patterns: ['A', 'B'] });
	assert.equal(out.phase, 'q');
	assert.deepEqual(out.diagnosis, { a: 1, b: 3, c: 4 });
	assert.deepEqual(out.patterns, ['A', 'B']);
});

test('coerce turns obvious strings into typed values', () => {
	assert.equal(coerce('true'), true);
	assert.equal(coerce('false'), false);
	assert.equal(coerce('null'), null);
	assert.equal(coerce('14'), 14);
	assert.equal(coerce('A'), 'A');
});

test('every phase has a default nextAction', () => {
	for (const phase of PHASES) {
		assert.ok(PHASE_NEXT_ACTION[phase], `missing nextAction for ${phase}`);
		assert.equal(defaultNextAction(phase), PHASE_NEXT_ACTION[phase]);
	}
	assert.equal(defaultNextAction('bogus'), null);
});

test('applyMutations derives nextAction when phase advances without one', () => {
	const state = { phase: 'awaiting-pattern-selection', nextAction: PHASE_NEXT_ACTION['awaiting-pattern-selection'], selectedPattern: null };
	// The bug: advancing phase used to leave the stale init nextAction behind.
	const out = applyMutations(state, null, [['phase', 'done']]);
	assert.equal(out.phase, 'done');
	assert.equal(out.nextAction, PHASE_NEXT_ACTION['done']);
});

test('applyMutations respects an explicit nextAction set alongside phase', () => {
	const out = applyMutations({ phase: 'x' }, null, [['phase', 'implementation'], ['nextAction', 'custom step']]);
	assert.equal(out.nextAction, 'custom step');
});

test('applyMutations leaves nextAction untouched when phase does not change', () => {
	const out = applyMutations({ phase: 'evidence-gathered', nextAction: 'keep me' }, { selectedPattern: 'B' }, []);
	assert.equal(out.selectedPattern, 'B');
	assert.equal(out.nextAction, 'keep me');
});

test('applyMutations derives nextAction from a phase set via --patch too', () => {
	const out = applyMutations({ phase: 'x', nextAction: 'stale' }, { phase: 'hypothesis-ready' }, []);
	assert.equal(out.nextAction, PHASE_NEXT_ACTION['hypothesis-ready']);
});
