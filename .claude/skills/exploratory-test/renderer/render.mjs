/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders a local run's report.md as index.html beside it, the same page CI
// publishes. Usage:
//   node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>]
//     [--verify-model <id> --verify-duration-ms <n> --verify-turns <n>]
//     [--isolate-model <id> --isolate-duration-ms <n> --isolate-turns <n>] [--no-agent-prompts] [--base <url> --out <file>]
// The flags record the explore agent's run, and the verifier's when there was
// one, on the Run tile, as CI's cost footer does. Given --duration-ms, they replace the report's footer lines.
// --no-agent-prompts leaves out the findings' copy-for-agent buttons.
// --base renders the page for where it will be published, so issues link back
// to it; --out writes that page elsewhere, leaving the local one as it is.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
		'isolate-model': { type: 'string' },
		'isolate-duration-ms': { type: 'string' },
		'isolate-turns': { type: 'string' },
		'no-agent-prompts': { type: 'boolean' },
		check: { type: 'boolean' },
		base: { type: 'string' },
		out: { type: 'string' },
	},
});
const input = positionals[0];
if (!input) {
	console.error('usage: node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>] [--verify-model <id> --verify-duration-ms <n> --verify-turns <n>] [--isolate-model <id> --isolate-duration-ms <n> --isolate-turns <n>] [--no-agent-prompts] [--base <url> --out <file>] [--check]');
	process.exit(1);
}

// A fresh checkout has never installed the renderer's dependencies, and an
// older install can predate one. Imported after the install so they resolve.
const { dependencies } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
if (Object.keys(dependencies).some(name => !existsSync(join(here, 'node_modules', name)))) {
	execFileSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit' });
}
const { missingFiles, readRunDir, skillVersion, writeRunPage } = await import('./html.mjs');
const { formatMinutes, modelDisplayName, parseReport } = await import('./report-parse.mjs');
const { lintReport, untaggedShots } = await import('./lint.mjs');
const { loadIssueRefs } = await import('./known-issues.mjs');
const { buildStats, readChecks, recordCheck } = await import('./stats.mjs');
const { reportUsageOnce } = await import('./usage.mjs');

let markdown = readFileSync(input, 'utf8');
const dir = dirname(resolve(input));
const { ledger, actionsLog, knownIssues, fileExists, readFile } = readRunDir(dir);
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
// The explorer's own checks are counted, to see what the prose did not teach;
// the renders the harness does afterwards (the Run tile's, a publish's) are not.
const byExplorer = !flags['duration-ms'] && !flags.out && !flags.base;
const printProblems = () => {
	const problems = lintReport(markdown, ledger, { fileExists, listFiles, repoFileExists, knownIssues, actionsLog });
	if (byExplorer) {
		recordCheck(dir, problems);
	}
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
	const line = (label, model, turns, ms) => `_${label}: ${[modelDisplayName(model), turns && `${turns} turns`, formatMinutes(ms)].filter(Boolean).join(' | ')}_`;
	const explore = Number(flags['duration-ms']);
	const verify = Number(flags['verify-duration-ms']);
	const isolate = Number(flags['isolate-duration-ms']);
	// The total covers every pass, as CI's does; with one pass there is none.
	// Its flag, not its value, says there was a pass: 0 ms is still one.
	const later = [
		flags['verify-duration-ms'] !== undefined && line('verify', flags['verify-model'], flags['verify-turns'], verify),
		flags['isolate-duration-ms'] !== undefined && line('isolate', flags['isolate-model'], flags['isolate-turns'], isolate),
	].filter(Boolean);
	const footer = later.length
		? [line('explore', flags.model, flags.turns, explore), ...later, `_total: ${formatMinutes(explore + (verify || 0) + (isolate || 0))}_`].join('\n')
		: line('explore', flags.model, flags.turns, explore);
	// Re-rendering must not stack a second footer under the first; only the
	// labels a footer is written with, so a body line like `_note: x_` survives.
	const body = markdown.split('\n').filter(l => !/^_(explore|verify|isolate|total):.*_$/.test(l.trim())).join('\n').trimEnd();
	markdown = `${body}\n\n${footer}\n`;
	writeFileSync(input, markdown);
}

// The run directory is made when the run starts. A filesystem with no birth
// time reports the epoch, and the footer falls back to now.
const born = statSync(dir).birthtime;

const parsed = parseReport(markdown, { ledger });

// The Run tile's render is the run's last: record its stats, as CI's run.mjs
// does, before the page is written, so the page can link them.
const stats = flags['duration-ms'] ? buildStats({
	where: 'local',
	date: (born.getTime() > 0 ? born : new Date()).toISOString(),
	version: skillVersion(),
	model: flags.model,
	// A subagent's tool_uses, which is what the footer calls turns here.
	turns: flags.turns ? Number(flags.turns) : null,
	durationMs: Number(flags['duration-ms']) + (Number(flags['verify-duration-ms']) || 0) + (Number(flags['isolate-duration-ms']) || 0),
	// Isolation is the one pass whose cost is a choice, so it is kept apart to judge it.
	isolate: flags['isolate-duration-ms'] !== undefined
		? { durationMs: Number(flags['isolate-duration-ms']), turns: flags['isolate-turns'] ? Number(flags['isolate-turns']) : null }
		: null,
	parsed,
	checks: readChecks(dir),
}) : null;
if (stats) {
	writeFileSync(join(dir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
}

/** Who a local page's feedback says ran it; none when git has no email. */
function gitEmail() {
	try {
		return execFileSync('git', ['config', 'user.email'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
	} catch {
		return null;
	}
}

// Every issue or PR the report names gets its preview card. Not under test, which must not reach GitHub.
const issueRefs = await loadIssueRefs(dir, markdown, knownIssues, { offline: Boolean(process.env.NODE_TEST_CONTEXT) });

const out = flags.out ? resolve(flags.out) : join(dir, 'index.html');
await writeRunPage(out, markdown, parsed, {
	// Coverage is built from the run's ledger when it wrote one.
	ledger,
	agentPrompts: !flags['no-agent-prompts'],
	// Evidence in the prompt has to open from wherever it is pasted.
	base: flags.base || dir,
	// Sent with feedback.
	skillVersion: skillVersion(),
	author: gitEmail(),
	fileExists,
	readFile,
	startedAt: born.getTime() > 0 ? born : undefined,
	knownIssues,
	issueRefs,
});
console.log(out);

// Printed, not fatal: the page still renders. Fix each line and render again.
const problems = printProblems();

// A listed log that was never copied is a dead link; the page shows it unlinked,
// and the run fails so it gets copied rather than shipped.
const { logs: missing, files: missingTestFiles } = missingFiles(parsed, fileExists);
if (missing.length) {
	console.error(`missing log files, listed but not beside the report:\n${missing.map(p => `  ${p}`).join('\n')}`);
}
// The same for test files: a finding that names one nobody can open cannot be reproduced.
if (missingTestFiles.length) {
	console.error(`missing test files, listed in ## Files but not beside the report:\n${missingTestFiles.map(p => `  ${p}`).join('\n')}`);
}
// Evidence groups by step, so a shot with none has nowhere to go; lint names it.
const untagged = untaggedShots(parsed.findings);
// Sent last, so the row says whether the render failed the run.
if (stats) {
	const final = { problems: problems.length, missingLogs: missing.length, missingFiles: missingTestFiles.length, untaggedShots: untagged.length };
	await reportUsageOnce(dir, { email: gitEmail(), event: 'finished', runId: basename(dir), stats: { ...stats, final } });
}
if (missing.length || missingTestFiles.length || untagged.length) {
	process.exit(1);
}
