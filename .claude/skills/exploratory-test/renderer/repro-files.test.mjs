/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedger } from './report-parse.mjs';
import { renderReportHtml } from './html.mjs';
import { lintReport } from './lint.mjs';
import { PREVIEW_LINES, EMBED_BYTES, findFile } from './repro-files.mjs';

const DIR = new URL('./fixtures/logs-run/', import.meta.url);
const REPORT = readFileSync(new URL('report.md', DIR), 'utf8');
const LEDGER = readFileSync(new URL('ledger.md', DIR), 'utf8');
const SLOW = readFileSync(new URL('files/slow.py', DIR));
const readFixture = p => (existsSync(new URL(p, DIR)) ? readFileSync(new URL(p, DIR)) : null);
const render = (options = {}) => renderReportHtml(REPORT, { ledger: LEDGER, base: '/runs/r2', readFile: readFixture, ...options });

/** The page with one extra saved file, read from `extra` instead of disk. */
function renderWith(path, bytes, mention = path.replace(/^files\//, '')) {
	const ledger = LEDGER.replace('## Files\n', `## Files\n- ${path} | extra | S04\n`);
	const report = REPORT.replace('**Repro** -- starting state: `slow.py` loaded', `**Repro** -- starting state: \`${mention}\` open, \`slow.py\` loaded`);
	return renderReportHtml(report, { ledger, readFile: p => (p === path ? bytes : readFixture(p)) });
}

function card(html, n) {
	const start = html.indexOf(`<article id="f${n}"`);
	return html.slice(start, html.indexOf('</article>', start));
}

function viewer(html, id) {
	const start = html.indexOf(`<div class="lb fv" id="${id}"`);
	return start === -1 ? null : html.slice(start, html.indexOf('</div>\n</div>', start));
}

/** What the page's Copy and Download read: the embedded source, decoded the way the page does. */
function embedded(html, id) {
	const m = new RegExp(`<script type="text/plain" id="src-${id}"( data-enc="base64")?>([\\s\\S]*?)</script>`).exec(html);
	if (!m) { return null; }
	return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(m[2], 'utf8');
}

function promptText(html, n) {
	return new RegExp(`<script type="text/plain" id="prompt-f${n}">([\\s\\S]*?)</script>`).exec(html)[1];
}

test('files: the ledger reads its Files section', () => {
	const { files } = parseLedger(LEDGER);
	assert.deepEqual(files.map(f => [f.path, f.desc, f.uses]), [
		['files/slow.py', 'Python helper that builds the slow sources', 'S04, S08, S09; Findings 1, 2'],
	]);
});

test('files: a saved file named in a finding opens its viewer; a command naming it stays code', () => {
	const c = card(render(), 1);
	assert.match(c, /<a class="fn" href="files\/slow\.py" data-file="file-slow-py" title="Open slow\.py">slow\.py<\/a> loaded with <code>%run -i slow\.py<\/code>/);
	// Copy and Download live in the viewer, never on the card.
	assert.doesNotMatch(c, /f-copy|f-dl/);
});

test('files: the viewer shows every line numbered, with Copy and Download, and starts hidden', () => {
	const html = render();
	const v = viewer(html, 'file-slow-py');
	assert.match(v, /role="dialog" aria-modal="true" aria-label="slow\.py" hidden>/);
	assert.match(v, /<span class="fv-m">Python \u00b7 15 lines<\/span>/);
	assert.equal(v.match(/<span class="l">/g).length, 15);
	assert.match(v, /<button type="button" class="fv-b f-copy" data-src="src-file-slow-py">/);
	assert.match(v, /<a class="fv-b f-dl" href="files\/slow\.py" download="slow\.py" data-src="src-file-slow-py">/);
	assert.equal(html.match(/class="fv-b f-copy"/g).length, 1);
	assert.match(html, /<script>\(function\(\)\{\nfunction text\(id\)/);
});

test('files: the embedded source is the file byte for byte', () => {
	assert.ok(embedded(render(), 'file-slow-py').equals(SLOW));
	// A closing script tag or a carriage return would not survive as raw text.
	for (const text of ['<p>x</p>\r\n</script><script>alert(1)</script>\r\n', 'a <!-- b\n']) {
		const bytes = Buffer.from(text, 'utf8');
		const html = renderWith('files/page.html', bytes);
		assert.ok(embedded(html, 'file-page-html').equals(bytes));
		// The prompt carries the file too. Nothing in it can end its script
		// element early, and no comment opener is left raw to keep it open.
		const prompt = promptText(html, 1);
		assert.match(prompt, /### Files\npage\.html: /);
		assert.match(prompt, /Please investigate this finding/);
		assert.ok(!html.includes('<!--'));
	}
});

test('files: a listed file that is missing renders as code, with no viewer and no dead link', () => {
	const html = render({ readFile: () => null });
	assert.match(card(html, 1), /<code>slow\.py<\/code> loaded/);
	assert.equal(viewer(html, 'file-slow-py'), null);
	assert.doesNotMatch(html, /href="files\//);
	assert.doesNotMatch(html, /function text\(id\)/);
});

test('files: a binary file downloads but is not shown or copied', () => {
	const html = renderWith('files/data.parquet', Buffer.from([0x50, 0x41, 0x52, 0x31, 0, 0, 0x50]));
	const v = viewer(html, 'file-data-parquet');
	assert.match(v, /Parquet \u00b7 7 B/);
	assert.match(v, /Binary file: not shown/);
	assert.doesNotMatch(v, /f-copy|data-src/);
	assert.match(v, /<a class="fv-b f-dl" href="files\/data\.parquet" download="data\.parquet">/);
	assert.equal(embedded(html, 'file-data-parquet'), null);
});

test('files: a long file previews its first lines; one over the cap is not embedded', () => {
	const long = Buffer.from(Array.from({ length: PREVIEW_LINES + 50 }, (_, i) => `x${i}`).join('\n') + '\n');
	const v = viewer(renderWith('files/long.txt', long), 'file-long-txt');
	assert.equal(v.match(/<span class="l">/g).length, PREVIEW_LINES);
	assert.match(v, new RegExp(`Showing the first ${PREVIEW_LINES} of ${PREVIEW_LINES + 50} lines`));
	assert.match(v, /f-copy/);

	const huge = Buffer.from('y'.repeat(EMBED_BYTES) + '\n');
	const html = renderWith('files/huge.txt', huge);
	assert.equal(embedded(html, 'file-huge-txt'), null);
	assert.doesNotMatch(viewer(html, 'file-huge-txt'), /f-copy|data-src/);
});

test('files: the agent prompt carries each named file with its path and text, before the steps', () => {
	const text = promptText(render(), 1);
	const files = text.indexOf('### Files');
	assert.ok(files > text.indexOf('### Preconditions') && files < text.indexOf('### Reproduction'));
	assert.ok(text.includes(`### Files\nslow.py: /runs/r2/files/slow.py\n\`\`\`python\n${SLOW.toString('utf8').trimEnd()}\n\`\`\`\n`));
	// A finding that names no file has no Files section.
	assert.doesNotMatch(promptText(render({ readFile: () => null }), 1), /### Files/);
});

test('files: Run details lists every test file by its name, with type, use and findings', () => {
	const html = render();
	const folds = html.slice(html.indexOf('id="run-details"'));
	assert.ok(folds.includes('<div class="fold-label">Test files</div>'));
	assert.match(folds, /<li><a class="fn" href="files\/slow\.py"[^>]*>slow\.py<\/a> <span class="log-sep" aria-hidden="true">&middot;<\/span> <span class="log-note">Python \u00b7 15 lines<\/span>.*Python helper that builds the slow sources.*S04, S08, S09; Findings 1, 2<\/span><\/li>/);
});

test('files: nothing about files renders when the ledger lists none', () => {
	const html = renderReportHtml(REPORT, { ledger: LEDGER.replace(/## Files[\s\S]*?\n---/, '---') });
	assert.doesNotMatch(html, /<a class="fn"|<div class="lb fv"|fold-label">Test files/);
});

/** The fixture's lint lines about files, with the files it saved on disk. */
function fileProblems(report, ledger, { exists = p => Boolean(readFixture(p)), list = () => ['files/slow.py'] } = {}) {
	return lintReport(report, ledger, { fileExists: exists, listFiles: list })
		.filter(p => /files\/|not saved/.test(p));
}

test('lint: the fixture saves and lists every file it names', () => {
	assert.deepEqual(fileProblems(REPORT, LEDGER), []);
});

test('lint: a file a setup names but nobody saved is one line naming every setup that needs it', () => {
	// A run that saved nothing: no Files section, and no files/ path in its preconditions.
	const ledger = LEDGER.replace(/## Files[\s\S]*?\n---/, '---').replaceAll('files/slow.py, then run', 'Run');
	assert.deepEqual(fileProblems(REPORT, ledger, { list: () => [] }), [
		'slow.py is named by Finding 1, Finding 2, S04, S08, S09 but not saved; save it to files/ as it was when used and list it under ## Files in the ledger',
	]);
});

test('lint: Files and files/ have to agree', () => {
	assert.deepEqual(fileProblems(REPORT, LEDGER, { exists: () => false }), ['ledger: ## Files lists files/slow.py, which is not in the run directory']);
	assert.deepEqual(fileProblems(REPORT, LEDGER, { list: () => ['files/slow.py', 'files/extra.csv'] }), ['ledger: files/extra.csv is saved but not listed in ## Files']);
	const named = REPORT.replace('## Coverage', 'See files/other.qmd too.\n\n## Coverage');
	assert.deepEqual(fileProblems(named, LEDGER), ['ledger: files/other.qmd is named but not listed in ## Files']);
	assert.ok(fileProblems(REPORT, LEDGER.replace('- files/slow.py |', '- slow.py |'))
		.includes('ledger: ## Files lists slow.py; save it under files/ and list that path'));
});

test('lint: a bare name two saved files share is flagged, not linked to the first', () => {
	const ledger = LEDGER.replace('- files/slow.py |', '- files/a/slow.py | copy | S04\n- files/b/slow.py |').replaceAll('files/slow.py, then run', 'Run');
	const problems = fileProblems(REPORT, ledger, { exists: () => true, list: () => ['files/a/slow.py', 'files/b/slow.py'] });
	assert.ok(problems.includes('Finding 1 names slow.py, which matches files/a/slow.py and files/b/slow.py; name it by its files/ path'));
	assert.ok(!problems.some(p => /not saved/.test(p)));
});

test('lint: setting keys, the app\'s own config files and prose are not test files', () => {
	const report = REPORT.replace('**Repro** -- starting state: `slow.py` loaded',
		'**Repro** -- starting state: `positron.r.interpreters.default` set in user settings.json, R 4.5.2 running, and `slow.py` loaded');
	assert.deepEqual(fileProblems(report.replace('## Coverage', 'Points to specific files/lines.\n\n## Coverage'), LEDGER), []);
});

test('files: render.mjs fails the run when a listed file was not saved', () => {
	const dir = mkdtempSync(join(tmpdir(), 'files-run-'));
	cpSync(fileURLToPath(DIR), dir, { recursive: true });
	const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)), join(dir, 'report.md')], { encoding: 'utf8' });
	assert.equal(run().status, 0);
	rmSync(join(dir, 'files', 'slow.py'));
	const failed = run();
	assert.equal(failed.status, 1);
	assert.match(failed.stderr, /missing test files, listed in ## Files but not beside the report:\n {2}files\/slow\.py/);
	// A saved file the ledger never listed is a lint line, not a failure.
	writeFileSync(join(dir, 'files', 'slow.py'), SLOW);
	writeFileSync(join(dir, 'files', 'stray.py'), 'x = 1\n');
	const stray = run();
	assert.equal(stray.status, 0);
	assert.match(stray.stderr, /ledger: files\/stray\.py is saved but not listed in ## Files/);
	rmSync(dir, { recursive: true, force: true });
});

const NOTEBOOK = Buffer.from(JSON.stringify({
	cells: [
		{ cell_type: 'markdown', metadata: {}, source: ['# Load\n', 'Read the data.'] },
		{ cell_type: 'code', metadata: {}, execution_count: 1, outputs: [{ output_type: 'stream', text: ['secret output'] }], source: ['import pandas as pd\n', '\n', 'df = pd.read_csv("x.csv")'] },
		{ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: 'df.head()' },
	],
	metadata: { kernelspec: { name: 'python3', language: 'python', display_name: 'Python 3' } },
	nbformat: 4, nbformat_minor: 5,
}, null, 1));

test('notebook: the viewer shows cells with their type, not the JSON, and leaves outputs out', () => {
	const html = renderWith('files/load.ipynb', NOTEBOOK);
	const v = viewer(html, 'file-load-ipynb');
	assert.match(v, /<span class="fv-m">Notebook \u00b7 3 cells<\/span>/);
	assert.deepEqual([...v.matchAll(/<div class="fv-ct">([^<]+)<\/div>/g)].map(m => m[1]), ['Markdown', 'Python', 'Python']);
	assert.equal(v.match(/<div class="fv-cell fv-code">/g).length, 2);
	// Numbered per cell: the code cell's blank line is its own line.
	assert.match(v, /<div class="fv-cell fv-code"><div class="fv-ct">Python<\/div><pre class="fv-src"><span class="l">import pandas as pd\n<\/span><span class="l">\n<\/span><span class="l">df = pd\.read_csv\(&quot;x\.csv&quot;\)\n<\/span><\/pre>/);
	assert.doesNotMatch(v, /nbformat|&quot;cells&quot;|secret output/);
	// Copy and Download are still the notebook itself.
	assert.ok(embedded(html, 'file-load-ipynb').equals(NOTEBOOK));
});

test('notebook: an R kernel labels its code cells R, and a file that is not a notebook shows as text', () => {
	const r = Buffer.from(JSON.stringify({ cells: [{ cell_type: 'code', source: 'x <- 1' }], metadata: { kernelspec: { language: 'R' } } }));
	assert.match(viewer(renderWith('files/r.ipynb', r), 'file-r-ipynb'), /<div class="fv-ct">R<\/div>/);
	const broken = viewer(renderWith('files/bad.ipynb', Buffer.from('{ "cells": [\n')), 'file-bad-ipynb');
	assert.match(broken, /Notebook \u00b7 1 line/);
	assert.doesNotMatch(broken, /fv-cell/);
});

test('notebook: the viewer stops at the preview budget and says how many cells it showed', () => {
	const cells = Array.from({ length: 5 }, (_, i) => ({ cell_type: 'code', source: Array.from({ length: 150 }, (_, j) => `x${i}_${j} = 1\n`) }));
	const v = viewer(renderWith('files/big.ipynb', Buffer.from(JSON.stringify({ cells, metadata: {} }))), 'file-big-ipynb');
	assert.equal(v.match(/<span class="l">/g).length, PREVIEW_LINES);
	assert.match(v, /Showing the first 3 of 5 cells\. Download for the full notebook\./);
});

test('notebook: a last cell cut at the budget still gets a notice', () => {
	const cells = Array.from({ length: 3 }, (_, i) => ({ cell_type: 'code', source: Array.from({ length: 150 }, (_, j) => `x${i}_${j} = 1\n`) }));
	const v = viewer(renderWith('files/cut.ipynb', Buffer.from(JSON.stringify({ cells, metadata: {} }))), 'file-cut-ipynb');
	assert.equal(v.match(/<div class="fv-cell /g).length, 3);
	assert.match(v, new RegExp(`Showing the first ${PREVIEW_LINES} lines\\. Download for the full notebook\\.`));
});

test('notebook: the agent prompt carries the cells as a percent-format script', () => {
	const text = promptText(renderWith('files/load.ipynb', NOTEBOOK), 1);
	assert.ok(text.includes([
		'load.ipynb: files/load.ipynb (its cells in percent format; the file is the notebook)',
		'```python', '# %% [markdown]', '# # Load', '# Read the data.', '', '# %%', 'import pandas as pd', '', 'df = pd.read_csv("x.csv")', '', '# %%', 'df.head()', '```',
	].join('\n')));
});

test('coverage: a precondition popover links the file it names, and its code name opens it too', () => {
	const html = render();
	const cov = html.slice(html.indexOf('id="coverage"'), html.indexOf('id="run-details"'));
	assert.match(cov, /<span class="pre-i"><b><a class="fn" href="files\/slow\.py" data-file="file-slow-py"[^>]*>slow\.py<\/a> loaded<\/b><a class="fn-view" href="files\/slow\.py" data-file="file-slow-py">view slow\.py<\/a>, then run <code>%run -i slow\.py<\/code>/);
	// Nothing to open, nothing linked.
	const bare = render({ readFile: () => null });
	const cov2 = bare.slice(bare.indexOf('id="coverage"'), bare.indexOf('id="run-details"'));
	assert.doesNotMatch(cov2, /fn-view|class="fn"/);
	assert.match(cov2, /files\/slow\.py, then run/);
});

test('table: a CSV shows its header and first rows, with the total, and copies as the raw file', () => {
	const rows = Array.from({ length: 1234 }, (_, i) => `${i},"v, ${i}","say ""hi"""`);
	const csv = Buffer.from(['id,label,quote', ...rows].join('\n') + '\n');
	const html = renderWith('files/data.csv', csv);
	const v = viewer(html, 'file-data-csv');
	assert.match(v, /<span class="fv-m">CSV · 1,234 rows<\/span>/);
	assert.match(v, /<thead><tr><th>id<\/th><th>label<\/th><th>quote<\/th><\/tr><\/thead>/);
	assert.equal(v.match(/<tr><td>/g).length, 20);
	// Quoted delimiters and doubled quotes are one field.
	assert.match(v, /<tr><td>0<\/td><td>v, 0<\/td><td>say &quot;hi&quot;<\/td><\/tr>/);
	assert.match(v, /Showing the first 20 of 1,234 rows\. Download for the full file\./);
	assert.ok(embedded(html, 'file-data-csv').equals(csv));
});

test('table: a TSV splits on tabs, and a quoted field may span lines', () => {
	const v = viewer(renderWith('files/t.tsv', Buffer.from('a\tb\r\n1\t"two\nlines"\r\n')), 'file-t-tsv');
	assert.match(v, /TSV · 1 row</);
	assert.match(v, /<tr><td>1<\/td><td>two\nlines<\/td><\/tr>/);
	assert.doesNotMatch(v, /Showing the first/);
});

test('files: a nested file shows its workspace folder in the viewer and Test files, and its name on the card', () => {
	const html = renderWith('files/ws-off/.vscode/settings.json', Buffer.from('{ "quarto.embeddedLanguageFeatures.native": false }\n'), 'settings.json');
	const id = 'file-ws-off-vscode-settings-json';
	assert.match(card(html, 1), new RegExp(`<a class="fn" href="files/ws-off/\\.vscode/settings\\.json" data-file="${id}" title="Open ws-off/\\.vscode/settings\\.json">settings\\.json</a> open`));
	const v = viewer(html, id);
	assert.match(v, /aria-label="ws-off\/\.vscode\/settings\.json" hidden>/);
	assert.match(v, /<span class="fv-n" title="ws-off\/\.vscode\/settings\.json"><span class="fv-dir">ws-off\/\.vscode\/<\/span><span class="fv-f">settings\.json<\/span><\/span>/);
	assert.match(v, /download="settings\.json"/);
	const folds = html.slice(html.indexOf('id="run-details"'));
	assert.match(folds, new RegExp(`<li><a class="fn" href="files/ws-off/\\.vscode/settings\\.json" data-file="${id}"[^>]*>ws-off/\\.vscode/settings\\.json</a>`));
	// A file at the top of files/ has no folder to show.
	assert.doesNotMatch(viewer(html, 'file-slow-py'), /fv-dir/);
});

test('findFile: a bare name resolves only when one saved file has it', () => {
	const files = [{ path: 'files/a/app.py', name: 'app.py' }, { path: 'files/b/app.py', name: 'app.py' }, { path: 'files/x.R', name: 'x.R' }];
	assert.equal(findFile(files, 'app.py'), null);
	assert.equal(findFile(files, 'files/b/app.py'), files[1]);
	assert.equal(findFile(files, 'x.R'), files[2]);
});
