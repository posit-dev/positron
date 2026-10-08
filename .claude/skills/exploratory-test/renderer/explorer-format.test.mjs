/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The report and ledger formats live twice: as templates in explorer.md, which
// is what the agent copies, and as the parser and lint here. Nothing else ties
// the two, so this fills explorer.md's own templates in and checks that they
// parse and lint clean. Edit a template the parser cannot read, or change the
// parser so a template no longer passes, and this fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintReport } from './lint.mjs';
import { parseLedger, parseReport } from './report-parse.mjs';

const EXPLORER = readFileSync(new URL('../explorer.md', import.meta.url), 'utf8');

/** explorer.md's fenced blocks, each as the lines between its fences. */
function fencedBlocks(markdown) {
	const blocks = [];
	let fence = null;
	let lines = [];
	for (const line of markdown.split('\n')) {
		const m = /^(`{3,})\s*\S*\s*$/.exec(line);
		if (m && !fence) {
			fence = m[1];
			lines = [];
		} else if (fence && line.trim() === fence) {
			blocks.push(lines.join('\n'));
			fence = null;
		} else if (fence) {
			lines.push(line);
		}
	}
	return blocks;
}

function template(firstLine) {
	const block = fencedBlocks(EXPLORER).find(b => firstLine.test(b.split('\n')[0]));
	assert.ok(block, `explorer.md has no template starting ${firstLine}; update this test if it moved`);
	return block;
}

const REPORT = template(/^# Exploratory test:/);
const TABLE = template(/^\| # \| Finding \|/);
const FINDING = template(/^### Finding N:/);
const LEDGER = template(/^# Test ledger/);

// Placeholders whose value the parser or lint reads. Every other placeholder
// is prose to them and gets filler text. An array is used up in order.
const VALUES = {
	'<version>': ['2026.10.0', '1.105.0', '22.04', '0.1.252', '0.1.71', '3.12.3'],
	'<n>': '12',
	'<why it is worse than the title suggests, in one sentence; leave the line out when nothing is>': 'Nothing on screen says the view is unfinished.',
	'<M>': '3',
	'<dev build | release build>': 'dev build',
	'<OS>': 'Ubuntu',
	'<platform>': 'Linux',
	'<arch>': 'x64',
	'<Python or R>': 'Python',
	'<short sha>': 'abc1234567',
	'<owner>': 'posit-dev',
	'<repo>': 'positron',
	'<number>': '123',
	'<path>': 'data.csv',
	'<scenario IDs>': 'S02',
	'<Finding N, if any>': 'Finding 1',
	'<ID of the scenario that creates it, or empty>': '',
	'<how to set it up, with the files/ path of any file it needs>': 'Open `data.csv`.',
	'<what exists before step 1, naming each test file in backticks>': '`data.csv` open in an editor',
	'<surfaces the change touches that you did not reach, or `none`>': 'the web build',
	'<Renderer process, Extension host, Main process, Python kernel or R kernel>': 'Renderer process',
	'<Unit, Extension, or E2E>': 'Unit',
	'<exists, covers ... | new file>': 'new file',
	'<repo-relative test file, or leave out when unsure>': 'src/vs/example/test/example.vitest.ts',
	'<repo-relative test file>': 'src/vs/example/test/other.vitest.ts',
	'<repo-relative path>': 'src/vs/example/example.ts',
	'<log path>': 'logs/renderer.log',
	'<line>': '12',
	'<N>': '2',
};

// HTML the templates use as-is, not placeholders.
const LITERAL = new Set(['<details>', '<summary>', '</summary>', '</details>']);

// `shots` names each `Evidence: <file>` in order, `<scenario>-<step>.png` as
// explorer.md has it. The finding's are its own: the ledger template's S02 is
// shorter than the finding template, so they cannot share shots.
function fill(text, shots) {
	const pools = Object.fromEntries(Object.entries(VALUES).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
	const names = [...shots];
	let filler = 0;
	return text
		// `[, <file>]` and `[ (<when>)]` mark optional parts; leave them out.
		.replace(/\[([^\]\n]*<[^\]\n]*)\](?!\()/g, '')
		// One screenshot per check, never cited twice, as explorer.md requires.
		.replace(/\[shots\/<file>\]\(shots\/<file>\)/g, `[shots/${shots.at(-1)}](shots/${shots.at(-1)})`)
		// The embedded shot is the one that shows the failure best: the last check's.
		.replace(/!\[\]\(shots\/<file>\)/g, `![](shots/${shots.at(-1)})`)
		.replace(/Step <N>:/g, 'Step 4:')
		.replace(/logs\/<file>/g, 'logs/renderer.log')
		.replace(/Evidence: <file>/g, () => {
			assert.ok(names.length, 'the template has more Evidence lines than this test names shots for');
			return `Evidence: ${names.shift()}`;
		})
		.replace(/<[^<>]+>/g, p => {
			if (LITERAL.has(p)) {
				return p;
			}
			const v = pools[p];
			if (Array.isArray(v)) {
				assert.ok(v.length, `ran out of values for ${p}`);
				return v.shift();
			}
			return v ?? `Filler ${++filler}`;
		});
}

function filledReport() {
	// The report template leaves its Findings section as a description.
	const findings = `${TABLE}\n\n${FINDING.replace(/Finding N\b/g, 'Finding 1')}`;
	return fill(REPORT.replace(/^<the table, then one .*>$/m, findings), ['F1-02.png', 'F1-04.png']);
}

const report = filledReport();
const ledger = fill(LEDGER, ['S01-02.png', 'S02-02.png']);

test('explorer.md report and ledger templates lint clean when filled in', () => {
	const problems = lintReport(report, ledger, {
		fileExists: () => true,
		listFiles: () => ['files/data.csv'],
	});
	assert.deepEqual(problems, [], `filled templates:\n\n${report}\n\n${ledger}`);
});

test('explorer.md finding template parses into one finding with its steps and evidence', () => {
	const { findings } = parseReport(report, { ledger });
	assert.equal(findings.length, 1);
	const [f] = findings;
	assert.equal(f.n, 1);
	// A step the parser does not read as a check comes back as an action, and
	// lint does not flag that, so the step kinds are checked here.
	assert.deepEqual(f.steps.map(s => [s.kind, s.result, s.finding, s.evidence.map(e => e.file)]), [
		['action', null, null, []],
		['verify', 'pass', null, ['F1-02.png']],
		['action', null, null, []],
		['verify', 'fail', 1, ['F1-04.png']],
	]);
	assert.ok(f.steps[3].observed, 'the failing check keeps its Observed line');
	assert.ok(f.feature, 'the Feature line is read');
	assert.ok(f.evidence.some(e => e.kind === 'shot' && e.step), 'a captioned screenshot');
});

test('explorer.md ledger template parses into its scenarios, files and not-run list', () => {
	const parsed = parseLedger(ledger);
	assert.ok(parsed, 'the ledger parsed');
	assert.deepEqual(parsed.exercised.map(s => s.id), ['S01', 'S02']);
	assert.deepEqual(parsed.exercised.map(s => s.steps.map(st => [st.kind, st.result, st.finding])), [
		[['action', null, null], ['verify', 'pass', null]],
		[['action', null, null], ['verify', 'fail', 1]],
	]);
	assert.deepEqual(parsed.files.map(f => f.path), ['files/data.csv']);
	assert.equal(parsed.notExercised.length, 2, 'a Not run entry and an already-filed skip');
});
