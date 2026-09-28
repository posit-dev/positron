/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders a local run's report.md as index.html beside it, the same page CI
// publishes. Usage:
//   node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>]
//     [--verify-model <id> --verify-duration-ms <n> --verify-turns <n>] [--no-agent-prompts] [--base <url> --out <file>]
// The flags record the explore agent's run, and the verifier's when there was
// one, on the Run tile, as CI's cost footer does. Given --duration-ms, they replace the report's footer lines.
// --no-agent-prompts leaves out the findings' copy-for-agent buttons.
// --base renders the page for where it will be published, so issues link back
// to it; --out writes that page elsewhere, leaving the local one as it is.

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
		'verify-model': { type: 'string' },
		'verify-duration-ms': { type: 'string' },
		'verify-turns': { type: 'string' },
		'no-agent-prompts': { type: 'boolean' },
		check: { type: 'boolean' },
		base: { type: 'string' },
		out: { type: 'string' },
	},
});
const input = positionals[0];
if (!input) {
	console.error('usage: node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>] [--verify-model <id> --verify-duration-ms <n> --verify-turns <n>] [--no-agent-prompts] [--base <url> --out <file>] [--check]');
	process.exit(1);
}

// A fresh checkout has never installed the renderer's dependencies, and an
// older install can predate one. Imported after the install so they resolve.
const { dependencies } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
if (Object.keys(dependencies).some(name => !existsSync(join(here, 'node_modules', name)))) {
	execFileSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit' });
}
const { renderReportHtml, linkedLogs, skillVersion } = await import('./html.mjs');
const { modelDisplayName, parseReport } = await import('./report-parse.mjs');
const { lintReport, untaggedShots } = await import('./lint.mjs');

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
// Test paths in the report are relative to the checkout the explorer runs in.
const repoRoot = (() => {
	try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
})();
const repoFileExists = repoRoot ? path => existsSync(join(repoRoot, path)) : undefined;
const printProblems = () => {
	const problems = lintReport(markdown, ledger, { fileExists, listFiles, repoFileExists });
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
	const time = ms => {
		const minutes = Math.round(ms / 60000);
		return minutes === 0 ? '<1m' : `${minutes}m`;
	};
	const line = (label, model, turns, ms) => `_${label}: ${[modelDisplayName(model), turns && `${turns} turns`, time(ms)].filter(Boolean).join(' | ')}_`;
	const explore = Number(flags['duration-ms']);
	const verify = Number(flags['verify-duration-ms']);
	// The total covers both passes, as CI's does; with one pass there is none.
	const footer = verify
		? [line('explore', flags.model, flags.turns, explore), line('verify', flags['verify-model'], flags['verify-turns'], verify), `_total: ${time(explore + verify)}_`].join('\n')
		: line('explore', flags.model, flags.turns, explore);
	// Re-rendering must not stack a second footer under the first; only the
	// labels a footer is written with, so a body line like `_note: x_` survives.
	const body = markdown.split('\n').filter(l => !/^_(explore|verify|total):.*_$/.test(l.trim())).join('\n').trimEnd();
	markdown = `${body}\n\n${footer}\n`;
	writeFileSync(input, markdown);
}

const out = flags.out ? resolve(flags.out) : join(dir, 'index.html');
// The run directory is made when the run starts. A filesystem with no birth
// time reports the epoch, and the footer falls back to now.
const born = statSync(dir).birthtime;
writeFileSync(out, renderReportHtml(markdown, {
	ledger,
	agentPrompts: !flags['no-agent-prompts'],
	// Evidence in the prompt has to open from wherever it is pasted.
	base: flags.base || dir,
	// Sent with feedback, which only a published page (--base) asks for.
	skillVersion: skillVersion(),
	fileExists,
	readFile,
	startedAt: born.getTime() > 0 ? born : undefined,
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
// Evidence groups by step, so a shot with none has nowhere to go; lint names it.
const untagged = untaggedShots(parsed.findings);
if (missing.length || missingFiles.length || untagged.length) {
	process.exit(1);
}
