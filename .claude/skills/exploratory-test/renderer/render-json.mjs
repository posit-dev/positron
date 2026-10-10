/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders a run's report.json as index.html beside it, through the same page
// as render.mjs. Usage:
//   node render-json.mjs <path/to/report.json> [--pipeline <report.md>] [--out <file>] [--base <url>]
// --pipeline takes the verifier's verdicts and the cost footer from a
// report.md, until those passes write into report.json.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readRunDir, skillVersion, writeRunPage } from './html.mjs';
import { reportFromJson } from './report-json.mjs';
import { parseReport } from './report-parse.mjs';

const { values: flags, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		pipeline: { type: 'string' },
		out: { type: 'string' },
		base: { type: 'string' },
	},
});
const input = positionals[0];
if (!input) {
	console.error('usage: node render-json.mjs <path/to/report.json> [--pipeline <report.md>] [--out <file>] [--base <url>]');
	process.exit(1);
}

const dir = dirname(resolve(input));
const json = JSON.parse(readFileSync(input, 'utf8'));
const { ledger, knownIssues, issueRefs, changeBase, fileExists, readFile } = readRunDir(dir);

const pipeline = {};
if (flags.pipeline) {
	const md = parseReport(readFileSync(flags.pipeline, 'utf8'), { ledger });
	pipeline.verification = md.verification;
	pipeline.cost = md.cost;
	const byNumber = new Map(md.findings.map(f => [f.n, f]));
	for (const f of json.findings ?? []) {
		const from = byNumber.get(f.n);
		if (from) {
			f.verified ??= from.verified;
			f.known ??= from.known;
			f.intended ??= from.intended;
		}
	}
}

const report = reportFromJson(json, { ledger, pipeline });
const out = flags.out ? resolve(flags.out) : join(dir, 'index.html');
await writeRunPage(out, '', report, {
	report,
	ledger,
	base: flags.base || dir,
	skillVersion: skillVersion(),
	fileExists,
	readFile,
	knownIssues,
	issueRefs,
	changeBase,
});
console.log(out);
