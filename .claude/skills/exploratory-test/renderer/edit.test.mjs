/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyEdits, buildEditPrompt, buildRetryPrompt, editorFindings, factsOf, parseEdits, reviewEdits } from './edit.mjs';
import { parseReport } from './report-parse.mjs';

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
	'1. Create `app.R`:',
	'   ```r',
	'   shinyApp(ui, server)',
	'   ```',
	'2. Click Run Shiny App.',
	'3. VERIFY the Viewer shows the app -> FAIL - Finding 1',
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

// A writer reply for Finding 1, with its fields swapped by `with`.
const reply = (fields = {}) => {
	const f = {
		title: 'Run Shiny App on an R app leaves the Viewer empty',
		summary: 'When you run an R Shiny app, the Viewer stays empty, though a toast says "will preview it".',
		steps: ['1. Create `app.R`:', '   ```r', '   shinyApp(ui, server)', '   ```', '2. Click Run Shiny App. The Viewer stays empty.'],
		where: 'Python apps preview as expected.',
		...fields,
	};
	return ['RESULT: Python apps work. **Run Shiny App on an R app never previews it after 30 s.**', '', '=== Finding 1', `TITLE: ${f.title}`, `SUMMARY: ${f.summary}`, 'STEPS:', ...f.steps, `WHERE: ${f.where}`].join('\n');
};

test('editorFindings keeps each card through Expected, without Cause or an opening written before', () => {
	const findings = editorFindings(REPORT);
	assert.ok(findings.startsWith('### Finding 1:'));
	assert.ok(findings.endsWith('**Expected:** The Viewer opens on the app (S10).'));
	assert.ok(!findings.includes('executeVerifiedFragments'));
	const written = applyEdits(REPORT, reviewEdits(REPORT, parseEdits(reply())).kept);
	assert.equal(editorFindings(written), findings.replace('never previews it', 'leaves the Viewer empty'));
});

test('buildEditPrompt fills the Result and findings, or returns null when there is neither', () => {
	const template = '{{RESULT}}\n\n{{FINDINGS}}';
	assert.equal(buildEditPrompt(template, '# No findings\n'), null);
	assert.ok(buildEditPrompt(template, REPORT).startsWith('**Result:** Python apps'));
	assert.ok(buildEditPrompt(template, REPORT).includes('### Finding 1:'));
	assert.equal(buildEditPrompt(template, '# x\n\n**Result:** Loads.\n\n## Findings\n\nNone.'), '**Result:** Loads.\n\nNo findings.');
	assert.throws(() => buildEditPrompt('{{FINDINGS}}', REPORT), /RESULT/);
});

test('editor.md has the placeholders buildEditPrompt fills', () => {
	const template = readFileSync(fileURLToPath(new URL('../editor.md', import.meta.url)), 'utf8');
	assert.ok(buildEditPrompt(template, REPORT).includes('### Finding 1:'));
});

test('parseEdits reads the Result and each finding block, with a step\'s code block', () => {
	assert.deepEqual([...parseEdits(reply())], [
		[0, { result: 'Python apps work. **Run Shiny App on an R app never previews it after 30 s.**' }],
		[1, {
			title: 'Run Shiny App on an R app leaves the Viewer empty',
			opening: {
				summary: 'When you run an R Shiny app, the Viewer stays empty, though a toast says "will preview it".',
				steps: ['Create `app.R`:\n```r\nshinyApp(ui, server)\n```', 'Click Run Shiny App. The Viewer stays empty.'],
				where: 'Python apps preview as expected.',
			},
		}],
	]);
	assert.deepEqual([...parseEdits('EDITS: none')], []);
});

test('factsOf collects code spans, quoted strings and numbers, but not scenario IDs', () => {
	assert.deepEqual(factsOf('Prints `x <- 1` after 30 s and 1,234 rows, says "Done", as in S10.'), ['`x <- 1`', '"Done"', '30', '1,234']);
});

test('reviewEdits keeps a title and opening that cite only what the record has', () => {
	const { kept, rejected } = reviewEdits(REPORT, parseEdits(reply({ title: 'Viewer: Run Shiny App on an R app leaves the Viewer empty' })));
	assert.deepEqual(rejected, []);
	assert.equal(kept.get(1).title, 'Run Shiny App on an R app leaves the Viewer empty');
	assert.equal(kept.get(1).opening.steps.length, 2);
});

test('a step\'s ```` block holding a ```{r} cell is code, not prose, and survives the round trip', () => {
	const cell = ['   ````', '   ```{r}', '   cat("inserted cell\\n")', '   ```', '   ````'];
	const report = REPORT.replace(['   ```r', '   shinyApp(ui, server)', '   ```'].join('\n'), cell.join('\n'));
	const edits = parseEdits(reply({ steps: ['1. Create `app.R`:', ...cell, '2. Click Run Shiny App. The Viewer stays empty.'] }));
	const { kept, rejected } = reviewEdits(report, edits);
	assert.deepEqual(reasons(rejected), []);
	assert.deepEqual(parseReport(applyEdits(report, kept)).findings[0].text.opening.steps, edits.get(1).opening.steps);
});

test('reviewEdits rejects an opening or title that invents a fact, drops the code, or reads like the run', () => {
	const review = fields => reasons(reviewEdits(REPORT, parseEdits(reply(fields))).rejected.filter(r => r.n === 1));
	assert.deepEqual(review({ summary: 'The Viewer stays empty for 45 s.' }), [{ n: 1, field: 'opening', reason: 'cites 45, which the record does not have' }]);
	assert.deepEqual(review({ steps: ['1. Create an R Shiny app.', '2. Click Run Shiny App.'] }), [{ n: 1, field: 'opening', reason: 'leaves out the code the record has the reader run: "shinyApp(ui, server)"' }]);
	assert.deepEqual(review({ where: 'Seen in S10.' }), [{ n: 1, field: 'opening', reason: 'names the scenario ID S10' }]);
	assert.deepEqual(review({ title: 'Run Shiny App on an R app never shows the running app in the Viewer pane at all' }), [{ n: 1, field: 'title', reason: 'is 18 words, over 15; cut filler, never a word that narrows the bug' }]);
	assert.deepEqual(review({ title: 'Run Shiny App on an R app leaves the Viewer empty after the app starts' }), []);
	assert.deepEqual(review({ title: 'Viewer | empty' }), [{ n: 1, field: 'title', reason: 'has a |, ; or code' }]);
	assert.deepEqual(reasons(reviewEdits(REPORT, parseEdits('=== Finding 2\nTITLE: No such finding')).rejected), [{ n: 2, field: 'title', reason: 'Finding 2 is not in the report' }]);
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

test('applyEdits writes the title in heading and table and the opening atop the card, which the parser reads back', () => {
	const after = applyEdits(REPORT, reviewEdits(REPORT, parseEdits(reply())).kept);
	assert.ok(after.includes('| 1 | Run Shiny App on an R app leaves the Viewer empty | major | 2/2 | confirmed |'));
	assert.ok(after.includes([
		'### Finding 1: Run Shiny App on an R app leaves the Viewer empty',
		'',
		'**Summary:** When you run an R Shiny app, the Viewer stays empty, though a toast says "will preview it".',
		'',
		'**Hand steps:**',
		'',
		'1. Create `app.R`:',
		'   ```r',
		'   shinyApp(ui, server)',
		'   ```',
		'2. Click Run Shiny App. The Viewer stays empty.',
		'',
		'**Where:** Python apps preview as expected.',
		'',
		'**Feature:** Viewer',
	].join('\n')));
	// The rest of the card parses as it did before.
	const [f] = parseReport(after).findings;
	const [before] = parseReport(REPORT).findings;
	assert.deepEqual([f.text.opening.steps.length, f.text.summary, f.text.observed, f.feature], [2, before.text.summary, before.text.observed, 'Viewer']);
	// Applied again, it replaces the opening rather than stacking a second.
	const again = applyEdits(after, reviewEdits(after, parseEdits(reply({ where: 'Only R.' }))).kept);
	assert.deepEqual([again.match(/\*\*Summary:\*\*/g).length, again.includes('**Where:** Only R.')], [1, true]);
});

test('buildRetryPrompt asks again for each rejected field with its reason, or returns null', () => {
	const { rejected } = reviewEdits(REPORT, parseEdits(reply({ summary: 'The Viewer stays empty for 45 s.' }) + '\n=== Finding 2\nTITLE: No such finding'));
	const retry = buildRetryPrompt('{{RESULT}}\n\n{{FINDINGS}}', REPORT, rejected);
	assert.ok(retry.includes('### Finding 1:'));
	assert.ok(retry.endsWith('- Finding 1 opening: cites 45, which the record does not have.'));
	assert.ok(!retry.includes('No such finding'));
	assert.equal(buildRetryPrompt('{{RESULT}}\n\n{{FINDINGS}}', REPORT, []), null);
});
