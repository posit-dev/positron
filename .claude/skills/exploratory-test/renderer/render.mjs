/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders a local run's report.md as index.html beside it, the same page CI
// publishes. Usage:
//   node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>] [--no-agent-prompts]
// The flags record the explore agent's run on the Run tile, as CI's cost
// footer does. Given --duration-ms, they replace the report's footer lines.
// --no-agent-prompts leaves out the findings' copy-for-agent buttons.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values: flags, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		model: { type: 'string' },
		'duration-ms': { type: 'string' },
		turns: { type: 'string' },
		'no-agent-prompts': { type: 'boolean' },
		check: { type: 'boolean' },
	},
});
const input = positionals[0];
if (!input) {
	console.error('usage: node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>] [--no-agent-prompts] [--check]');
	process.exit(1);
}

// A fresh checkout has never installed the renderer's dependencies, and it
// needs `marked`. Imported after the install so it can resolve.
if (!existsSync(join(here, 'node_modules', 'marked'))) {
	execFileSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit' });
}
const { renderReportHtml, linkedLogs } = await import('./html.mjs');
const { modelDisplayName, parseReport } = await import('./report-parse.mjs');
const { lintReport } = await import('./lint.mjs');

let markdown = readFileSync(input, 'utf8');
// Coverage is built from the run's ledger when it wrote one.
const dir = dirname(resolve(input));
const ledgerPath = join(dir, 'ledger.md');
const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : undefined;
const fileExists = path => existsSync(join(dir, path));
const readFile = path => (existsSync(join(dir, path)) && statSync(join(dir, path)).isFile() ? readFileSync(join(dir, path)) : null);
// Every file saved under files/, so lint can find one the ledger never listed.
const listFiles = () => {
	const root = join(dir, 'files');
	return existsSync(root)
		? readdirSync(root, { recursive: true }).map(p => join(root, p)).filter(p => statSync(p).isFile()).map(p => relative(dir, p).split('\\').join('/'))
		: [];
};
const printProblems = () => {
	const problems = lintReport(markdown, ledger, { fileExists, listFiles });
	if (problems.length) {
		console.error(`format problems:\n${problems.map(p => `  ${p}`).join('\n')}`);
	}
	return problems;
};

// Lint only, for a run that renders elsewhere.
if (flags.check) {
	const problems = printProblems();
	if (!problems.length) {
		console.log('no format problems');
	}
	process.exit(problems.length ? 1 : 0);
}
if (flags['duration-ms']) {
	// Written here rather than by the action's renderCostFooter (lib.mjs):
	// a local run has no bill, and that footer drops any pass without one.
	const minutes = Math.round(Number(flags['duration-ms']) / 60000);
	const bits = [
		modelDisplayName(flags.model),
		flags.turns && `${flags.turns} turns`,
		minutes === 0 ? '<1m' : `${minutes}m`,
	].filter(Boolean);
	const footer = `_explore: ${bits.join(' | ')}_`;
	// Re-rendering must not stack a second footer under the first; only the
	// labels a footer is written with, so a body line like `_note: x_` survives.
	const body = markdown.split('\n').filter(l => !/^_(explore|verify|total):.*_$/.test(l.trim())).join('\n').trimEnd();
	markdown = `${body}\n\n${footer}\n`;
	writeFileSync(input, markdown);
}

const out = join(dir, 'index.html');
writeFileSync(out, renderReportHtml(markdown, {
	ledger,
	agentPrompts: !flags['no-agent-prompts'],
	// Evidence in the prompt has to open from wherever it is pasted.
	base: dir,
	fileExists,
	readFile,
}));
console.log(out);

// Printed, not fatal: the page still renders. Fix each line and render again.
printProblems();

// A listed log that was never copied is a dead link; the page shows it unlinked,
// and the run fails so it gets copied rather than shipped.
const parsed = parseReport(markdown, { ledger });
const missing = linkedLogs(parsed).filter(p => !fileExists(p));
if (missing.length) {
	console.error(`missing log files, listed but not beside the report:\n${missing.map(p => `  ${p}`).join('\n')}`);
}
// The same for test files: a finding that names one nobody can open cannot be reproduced.
const missingFiles = parsed.files.map(f => f.path).filter(p => !fileExists(p));
if (missingFiles.length) {
	console.error(`missing test files, listed in ## Files but not beside the report:\n${missingFiles.map(p => `  ${p}`).join('\n')}`);
}
if (missing.length || missingFiles.length) {
	process.exit(1);
}
