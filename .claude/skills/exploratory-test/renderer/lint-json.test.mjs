/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatProblems, lintReportJson, readCheckedReport, schemaProblems } from './lint-json.mjs';
import { withTmpDir } from './shared/tmp-dirs.mjs';

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

const lint = j => lintReportJson(j, LEDGER).map(p => p.text);

test('a report that keeps to the ledger has no problems', () => {
	assert.deepEqual(lint(json()), []);
});

test('a step reworded but acting on the same values is the ledger\'s', () => {
	const j = json();
	j.findings[0].steps[0].text = 'Click the `email` row of the Object Explorer tree.';
	j.findings[0].steps[1].text = 'Press Ctrl+Shift+C';
	assert.deepEqual(lint(j), []);
});

test('a report need not repeat the ledger: the page takes coverage, logs, files and environment from it', () => {
	const j = json();
	for (const key of ['scenarios', 'logs', 'files', 'environment']) {
		delete j[key];
	}
	assert.deepEqual(lint(j), []);
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

test('steps out of the scenario\'s order are a problem', () => {
	const j = json();
	j.findings[0].steps.reverse();
	assert.equal(lint(j).filter(p => /out of order/.test(p)).length, 2);
});

test('a log line listed as both found and missing is a problem', () => {
	const j = json();
	j.findings[0].evidence.push({ kind: 'missing', path: 'logs/renderer.log', window: '22:00-22:01' });
	assert.deepEqual(lint(j), ['report.json: Finding 1 evidence lists logs/renderer.log as both a log line and missing']);
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

test('an empty header line or feature, a shot outside shots/ and an absolute link are problems', () => {
	const j = json();
	j.header = { result: 'It copies.', tested: '', notExercised: ' ', details: [{ title: 'Branch verification', body: 'See [the log](/tmp/run/out.log).' }] };
	Object.assign(j.findings[0], {
		title: 'Copy pastes the value', observed: 'The pasted text is `x`.', expected: 'The accessor.', tests: { cases: [], related: [] },
		feature: '', evidence: [{ kind: 'shot', path: 'https://cdn.example/x.png', step: 1 }],
	});
	assert.deepEqual(formatProblems(j, LEDGER).map(p => p.text).filter(p => /header\.|no feature|links the screenshot|relative to the run/.test(p)), [
		'report: header.tested is empty; write the Tested line',
		'report: header.notExercised is empty; write the Not exercised line',
		'report: Finding 1 has no feature; name the area of Positron it is in, such as "data explorer"',
		'report: Finding 1 links the screenshot https://cdn.example/x.png; link it as shots/<file>',
		'report: cite files relative to the run directory, not /tmp/run/out.log',
	]);
});

// fixtures/lint-scenes.expected.txt pins the other write-up rules on report.json's fields.
test('a report.json precondition with no name is a problem', () => {
	const j = json();
	Object.assign(j.findings[0], { title: 'Copy pastes the value', observed: 'The pasted text is `x`.', expected: 'The accessor.', preconditions: [{ text: 'A JSON file open' }] });
	assert.deepEqual(formatProblems(j, LEDGER).map(p => p.text).filter(p => /precondition/.test(p)), [
		'report: Finding 1 precondition "A JSON file open" needs a name, 2 to 4 words, for Coverage',
	]);
});

test('readCheckedReport returns the report and logs what the check still finds, or null with none that parses', () => {
	const lines = [];
	const log = line => lines.push(line);
	withTmpDir('checked-', dir => {
		assert.equal(readCheckedReport(dir, { log }), null);
		writeFileSync(join(dir, 'ledger.md'), LEDGER);
		writeFileSync(join(dir, 'report.json'), '{');
		assert.equal(readCheckedReport(dir, { log }), null);
		writeFileSync(join(dir, 'report.json'), JSON.stringify(json()));
		assert.deepEqual(readCheckedReport(dir, { log }), json());
		assert.match(lines[0], /does not parse/);
		assert.match(lines[1], /^\[json\] \d+ problems after the explorer: report\.header is missing/);
	});
});

test('schemaProblems checks header.headSha is a string', () => {
	const header = { title: 't', branch: 'b', sha: 'abc1234567', result: 'r', tested: 't', notExercised: 'n' };
	assert.deepEqual(schemaProblems({ header: { ...header, headSha: 'a'.repeat(40) }, findings: [] }).filter(p => /headSha/.test(p)), []);
	assert.ok(schemaProblems({ header: { ...header, headSha: 7 }, findings: [] }).some(p => /headSha/.test(p)));
});
