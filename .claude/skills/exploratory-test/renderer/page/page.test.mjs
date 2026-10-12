/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pins the whole page for two saved runs, so a change to html.mjs shows
// exactly what it does to the page. The stylesheet and the page's scripts are
// left out: they are the same on every page, and their own files show a change. After a change you meant, rewrite the
// saved pages and review their diff:
//   UPDATE_PAGES=1 node --test page.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readRunDir, renderReportHtml } from './html.mjs';
import { reportFromJson } from './report-json.mjs';

process.env.EXPLORATORY_TEST_NO_USAGE = '1';

/** The run in `fixtures/<name>/` as the page, with everything that varies by machine or day held fixed; logs-run as published, uv-run as a local run. */
function renderFixture(name) {
	const dir = fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));
	const run = readRunDir(dir);
	const json = JSON.parse(readFileSync(`${dir}report.json`, 'utf8'));
	return renderReportHtml(reportFromJson(json, { ledger: run.ledger }), {
		...run, base: name === 'logs-run' ? 'https://cdn.example/logs-run' : `/runs/${name}`, skillVersion: '1.0', startedAt: new Date('2026-10-11T12:00:00Z'),
	});
}

for (const name of ['logs-run', 'uv-run']) {
	test(`the ${name} page is unchanged`, () => {
		const path = fileURLToPath(new URL(`../fixtures/${name}/index.expected.html`, import.meta.url));
		const html = renderFixture(name)
			.replace(/(<style[^>]*>)[\s\S]*?(<\/style>)/g, '$1$2')
			.replace(/(<script(?![^>]*text\/plain)[^>]*>)[\s\S]*?(<\/script>)/g, '$1$2');
		if (process.env.UPDATE_PAGES || !existsSync(path)) {
			writeFileSync(path, html);
		}
		// Line by line, so a failure names the first line that moved.
		const want = readFileSync(path, 'utf8').split('\n');
		const got = html.split('\n');
		const at = Array.from({ length: Math.max(got.length, want.length) }, (_, i) => i).find(i => got[i] !== want[i]);
		assert.equal(at, undefined, `line ${at + 1} differs; if the change is meant, run UPDATE_PAGES=1 node --test page.test.mjs and review the diff`);
	});
}
