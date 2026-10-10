/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReportJson, lintReportJson, mergeRetry, schemaProblems } from './lint-json.mjs';

const LEDGER = [
	'# Scenario ledger',
	'',
	'## S01 - Copy with the shortcut',
	'Status: fail - Finding 1',
	'Result: Fails 2/2',
	'',
	'Steps:',
	'1. Click the `email` row in the Object Explorer.',
	'2. Press Ctrl+Shift+C.',
	'3. VERIFY the pasted text is the accessor `cfg[\'email\']` (actions.log:12) -> FAIL - Finding 1',
	'   Observed: The pasted text is `x@y.z`',
	'4. Overwrite `people.json` on disk with `broken.json` (files/broken.json).',
	'5. VERIFY the explorer shows the parse error -> PASS',
	'',
	'## S02 - Copy from the menu',
	'Status: pass',
	'Result: The menu copies the accessor.',
	'',
	'Steps:',
	'1. Click `Copy Accessor` in the context menu.',
	'2. VERIFY the pasted text is `cfg[\'email\']` -> PASS',
	'',
	'## Not run',
	'- N01 - The web build - no web build',
	'',
].join('\n');

function json() {
	return {
		findings: [{
			n: 1,
			reproduced: { n: 2, m: 2 },
			steps: [
				{ kind: 'action', text: 'Click the `email` row in the Object Explorer.' },
				{ kind: 'action', text: 'Press Ctrl+Shift+C.' },
				{ kind: 'verify', text: 'the pasted text is the accessor `cfg[\'email\']`', result: 'fail', finding: 1, observed: 'The pasted text is `x@y.z`' },
			],
			evidence: [{ kind: 'log', path: 'logs/renderer.log:12', quote: 'copied' }],
		}],
		scenarios: [
			{ id: 'S01', name: 'Copy with the shortcut', status: 'fail', result: 'Fails 2/2', findings: [1] },
			{ id: 'S02', name: 'Copy from the menu', status: 'pass', result: 'The menu copies the accessor.' },
			{ id: 'N01', name: 'The web build', status: 'not-run', reason: 'no web build' },
		],
	};
}

const lint = j => lintReportJson(j, LEDGER);

test('a report that keeps to the ledger has no problems', () => {
	assert.deepEqual(lint(json()), []);
});

test('a step reworded but acting on the same values is the ledger\'s', () => {
	const j = json();
	j.findings[0].steps[0].text = 'Click the `email` row of the Object Explorer tree.';
	j.findings[0].steps[1].text = 'Press Ctrl+Shift+C';
	assert.deepEqual(lint(j), []);
});

test('a scenario the ledger does not have, or under another rate, is a problem', () => {
	const j = json();
	j.scenarios[0].result = 'Fails 1/1';
	j.scenarios.push({ id: 'S09', name: 'Invented', status: 'fail', result: 'Fails 1/1', findings: [1] });
	assert.deepEqual(lint(j), [
		'report.json: S01 fails 1/1, but the ledger has 2/2',
		'report.json: S09 is not in the ledger',
	]);
});

test('a finding no scenario fails for, or one left out, is a problem', () => {
	const j = json();
	j.findings[0].n = 2;
	j.findings[0].steps[2].finding = 2;
	assert.deepEqual(lint(j), [
		'report.json: Finding 2 is not in the ledger: no scenario fails for it',
		'report.json: the ledger\'s Finding 1 is missing',
	]);
});

test('a step with another value, or a check the run did not make, is not the ledger\'s', () => {
	const j = json();
	j.findings[0].steps[0].text = 'Click the `version` row in the Object Explorer.';
	j.findings[0].steps[2].text = 'the pasted text is the accessor `cfg[\'email\']`, and a notification says it was copied with Show logs';
	assert.deepEqual(lint(j).map(p => p.replace(/: ".*$/, '')), [
		'report.json: Finding 1 step 1 is not a step of S01',
		'report.json: Finding 1 step 3 is not a step of S01',
	]);
});

test('a check whose result differs from the ledger\'s is a problem', () => {
	const j = json();
	j.findings[0].steps.push(
		{ kind: 'action', text: 'Overwrite `people.json` on disk with `broken.json`.' },
		{ kind: 'verify', text: 'the explorer shows the parse error', result: 'fail', finding: 1 },
	);
	assert.deepEqual(lint(j), ['report.json: Finding 1 step 5 is fail, but S01 recorded pass']);
});

test('steps out of the scenario\'s order are a problem', () => {
	const j = json();
	j.findings[0].steps.reverse();
	assert.equal(lint(j).filter(p => /out of order/.test(p)).length, 2);
});

test('a rate past the tries of the scenarios that failed for the finding is a problem', () => {
	const j = json();
	j.findings[0].reproduced = { n: 3, m: 3 };
	assert.deepEqual(lint(j), ['report.json: Finding 1\'s rate is 3/3, but S01, whose steps the repro shows, fails 2/2; give that rate']);
});

test('a log line listed as both found and missing is a problem', () => {
	const j = json();
	j.findings[0].evidence.push({ kind: 'missing', path: 'logs/renderer.log', window: '22:00-22:01' });
	assert.deepEqual(lint(j), ['report.json: Finding 1 evidence lists logs/renderer.log as both a log line and missing']);
});

test('a retry is taken only for the findings and scenarios the check flagged', () => {
	const first = json();
	first.findings[0].reproduced = { n: 3, m: 3 };
	first.scenarios.push({ id: 'S09', name: 'Invented', status: 'fail', result: 'Fails 1/1', findings: [1] });
	const retry = json();
	// The flagged finding is taken whole; the unflagged scenario's rewording is not.
	retry.scenarios[1].result = 'The menu copies it.';
	retry.findings[0].observed = 'Reworded';
	const problems = checkReportJson(first, LEDGER);
	assert.deepEqual(problems.map(p => p.finding ?? p.scenario), ['S09', 1]);
	const { report, ignored } = mergeRetry(first, retry, problems);
	assert.deepEqual(
		{ rate: report.findings[0].reproduced, observed: report.findings[0].observed, scenarios: report.scenarios.map(s => [s.id, s.result ?? s.reason]), ignored },
		{ rate: { n: 2, m: 2 }, observed: 'Reworded', scenarios: [['S01', 'Fails 2/2'], ['S02', 'The menu copies the accessor.'], ['N01', 'no web build']], ignored: ['S02'] },
	);
	assert.deepEqual(lintReportJson(report, LEDGER), []);
});

test('a retry can add the finding the check found missing', () => {
	const first = json();
	const retry = json();
	first.findings = [];
	const { report } = mergeRetry(first, retry, checkReportJson(first, LEDGER));
	assert.deepEqual(report.findings.map(f => f.n), [1]);
});

test('the schema check names each field that is missing or of the wrong kind', () => {
	const schema = { type: 'object', required: ['findings', 'logs'], $defs: { int: { type: 'integer', minimum: 1 } }, properties: { findings: { type: 'array', items: { type: 'object', properties: { n: { $ref: '#/$defs/int' }, severity: { enum: ['major', 'minor'] } } } } } };
	assert.deepEqual(schemaProblems({ findings: [{ n: 0, severity: 'big' }, { n: '2' }] }, schema), [
		'report.logs is missing',
		'report.findings[0].n is below 1',
		'report.findings[0].severity is "big", not one of major, minor',
		'report.findings[1].n is string, not integer',
	]);
});
