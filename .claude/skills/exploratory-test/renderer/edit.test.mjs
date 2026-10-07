/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyEdits, buildEditPrompt, buildRetryPrompt, editorFindings, factsOf, parseEdits, reviewEdits } from './edit.mjs';

// What was rejected and why, without the rejected text.
const reasons = rejected => rejected.map(({ n, field, reason }) => ({ n, field, reason }));

const REPORT = [
	'# Exploratory test: Shiny',
	'',
	'**Result:** Python apps preview and reload on edit. **Run Shiny App on an R app never previews it after 30 s.**',
	'**Tested:** Run App',
	'',
	'## Findings',
	'',
	'| # | Finding | Severity | Reproduction | Verified |',
	'|---|---------|----------|--------------|---|',
	'| 1 | Run Shiny App on an R app never previews it | major | 2/2 | confirmed |',
	'',
	'### Finding 1: Run Shiny App on an R app never previews it',
	'',
	'**Feature:** Viewer',
	'',
	'1. Click Run Shiny App.',
	'2. VERIFY the Viewer shows the app -> FAIL - Finding 1',
	'',
	'**Observed:** The console prints `Listening on http://127.0.0.1:<port>`, but the Viewer never shows it after 30 s, though a toast says "will preview it".',
	'',
	'**Expected:** The Viewer opens on the app (S10).',
	'',
	'**Evidence**',
	'',
	'**Cause (hypothesis):** `executeVerifiedFragments` drops the execution ID.',
	'',
	'<details>',
	'<summary>Verification details</summary>',
	'',
	'**Observed:** not part of a finding',
	'</details>',
].join('\n');

test('editorFindings keeps each card through Expected and leaves out Cause', () => {
	const findings = editorFindings(REPORT);
	assert.ok(findings.startsWith('### Finding 1:'));
	assert.ok(findings.endsWith('**Expected:** The Viewer opens on the app (S10).'));
	assert.ok(!findings.includes('executeVerifiedFragments'));
});

test('buildEditPrompt fills the Result and findings, or returns null when there is neither', () => {
	const template = '{{RESULT}}\n\n{{FINDINGS}}';
	assert.equal(buildEditPrompt(template, '# No findings\n'), null);
	assert.ok(buildEditPrompt(template, REPORT).startsWith('**Result:** Python apps'));
	assert.ok(buildEditPrompt(template, REPORT).includes('### Finding 1:'));
	assert.equal(buildEditPrompt(template, '# x\n\n**Result:** Loads.\n\n## Findings\n\nNone.'), '**Result:** Loads.\n\nNo findings.');
	assert.throws(() => buildEditPrompt('{{FINDINGS}}', REPORT), /RESULT/);
});

test('editor.md has the placeholder buildEditPrompt fills', () => {
	const template = readFileSync(fileURLToPath(new URL('../editor.md', import.meta.url)), 'utf8');
	assert.ok(buildEditPrompt(template, REPORT).includes('### Finding 1:'));
});

test('parseEdits reads one field per line and ignores the rest', () => {
	const edits = parseEdits('Here you go:\nRESULT: Python works.\nTITLE: 1=Viewer stays empty\nEXPECTED: 1=The Viewer opens on the app.\nEDITS: none');
	assert.deepEqual([...edits], [[0, { result: 'Python works.' }], [1, { title: 'Viewer stays empty', expected: 'The Viewer opens on the app.' }]]);
});

test('factsOf collects code spans, quoted strings and numbers, but not scenario IDs', () => {
	assert.deepEqual(factsOf('Prints `x <- 1` after 30 s and 1,234 rows, says "Done", as in S10.'), ['`x <- 1`', '"Done"', '30', '1,234']);
});

test('reviewEdits keeps a rewrite that holds every fact and rejects one that drops one', () => {
	const { kept, rejected } = reviewEdits(REPORT, parseEdits([
		'TITLE: 1=Viewer stays empty after Run Shiny App starts an R app',
		'OBSERVED: 1=The console prints `Listening on http://127.0.0.1:<port>`. The Viewer never shows the app, though a toast says "will preview it".',
		'EXPECTED: 1=The Viewer opens on the app.',
		'TITLE: 2=No such finding',
	].join('\n')));
	assert.deepEqual([...kept], [[1, { title: 'Viewer stays empty after Run Shiny App starts an R app', expected: 'The Viewer opens on the app.' }]]);
	assert.deepEqual(reasons(rejected), [
		{ n: 1, field: 'observed', reason: 'loses 30' },
		{ n: 2, field: 'title', reason: 'Finding 2 has no title' },
	]);
});

test('reviewEdits rejects a title that drops a name the finding needs', () => {
	const { kept, rejected } = reviewEdits(REPORT, parseEdits('TITLE: 1=Viewer stays empty after Run Shiny App starts'));
	assert.deepEqual([kept.size, reasons(rejected)], [0, [{ n: 1, field: 'title', reason: 'loses R' }]]);
});

test('reviewEdits lets a Result shrink what worked, but not lose a name, a number or the bold', () => {
	const review = result => reviewEdits(REPORT, parseEdits(`RESULT: ${result}`));
	const kept = 'Python apps work. **The Viewer stays empty after Run Shiny App starts an R app, even after 30 s.**';
	assert.deepEqual([...review(kept).kept], [[0, { result: kept }]]);
	assert.deepEqual(reasons(review('Python apps work. **The Viewer stays empty after Run Shiny App starts an app, even after 30 s.**').rejected), [{ n: 0, field: 'result', reason: 'loses R' }]);
	assert.deepEqual(reasons(review('Python apps work. The Viewer stays empty after Run Shiny App starts an R app, even after 30 s.').rejected), [{ n: 0, field: 'result', reason: 'drops the bold' }]);
	assert.deepEqual(reasons(review(`${Array.from({ length: 52 }, () => 'word').join(' ')} **The Viewer stays empty after Run Shiny App starts an R app, even after 30 s.**`).rejected), [{ n: 0, field: 'result', reason: 'is 68 words, over 60' }]);
	assert.deepEqual(reasons(reviewEdits('# x\n', parseEdits('RESULT: Works.')).rejected), [{ n: 0, field: 'result', reason: 'the report has no Result' }]);
});

test('reviewEdits rejects a title that would break the table', () => {
	const { rejected } = reviewEdits(REPORT, parseEdits('TITLE: 1=Run Shiny App on an R app | never previews it'));
	assert.equal(rejected[0].reason, 'has a | or ;');
});

test('applyEdits rewrites the heading, the table row and the card, and nothing in Verification', () => {
	const after = applyEdits(REPORT, new Map([[1, { title: 'Viewer stays empty', observed: 'New observed.', expected: 'New expected.' }]]));
	assert.ok(after.includes('| 1 | Viewer stays empty | major | 2/2 | confirmed |'));
	assert.ok(after.includes('### Finding 1: Viewer stays empty'));
	assert.ok(after.includes('**Observed:** New observed.'));
	assert.ok(after.includes('**Expected:** New expected.'));
	assert.ok(after.includes('**Observed:** not part of a finding'));
});

test('applyEdits rewrites the Result line and only that', () => {
	const after = applyEdits(REPORT, new Map([[0, { result: 'Python works. **R does not.**' }]]));
	assert.deepEqual(after.split('\n').filter((line, i) => line !== REPORT.split('\n')[i]), ['**Result:** Python works. **R does not.**']);
});

test('buildRetryPrompt asks again for each rejected field with its reason, or returns null', () => {
	const { rejected } = reviewEdits(REPORT, parseEdits('TITLE: 1=Viewer stays empty after Run Shiny App starts\nTITLE: 2=No such finding'));
	const retry = buildRetryPrompt('{{RESULT}}\n\n{{FINDINGS}}', REPORT, rejected);
	assert.ok(retry.includes('### Finding 1:'));
	assert.ok(retry.endsWith('- Finding 1 title: "Viewer stays empty after Run Shiny App starts" loses R.'));
	assert.ok(!retry.includes('No such finding'));
	assert.equal(buildRetryPrompt('{{RESULT}}\n\n{{FINDINGS}}', REPORT, []), null);
});
