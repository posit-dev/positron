/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders a run's report.json as index.html beside it, the same page CI
// publishes. Usage:
//   node render.mjs <path/to/report.json> [--no-agent-prompts] [--base <url> --out <file>]
//   node render.mjs --check <path/to/ledger.md>
// --no-agent-prompts leaves out the findings' copy-for-agent buttons.
// --base renders the page for where it will be published, so issues link back
// to it; --out writes that page elsewhere, leaving the local one as it is.
// --check lints the ledger alone, for a mid-run check, and exits 1 only on
// errors; lint-json.mjs checks the report.
// A local run's first render, with the passes' cost in report.json, records
// its stats.json and usage.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values: flags, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		'no-agent-prompts': { type: 'boolean' },
		check: { type: 'boolean' },
		base: { type: 'string' },
		out: { type: 'string' },
	},
});
const input = positionals[0];
if (!input) {
	console.error('usage: node render.mjs <path/to/report.json> [--no-agent-prompts] [--base <url> --out <file>]\n       node render.mjs --check <path/to/ledger.md>');
	process.exit(1);
}

// A fresh checkout has never installed the renderer's dependencies, and an
// older install can predate one. Imported after the install so they resolve.
const { dependencies } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
if (Object.keys(dependencies).some(name => !existsSync(join(here, 'node_modules', name)))) {
	execFileSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit' });
}
const { missingFiles, readRunDir, writeRunPage } = await import('./page/html.mjs');
const { skillVersion } = await import('./page/page-common.mjs');
const { lintLedgerOnly, untaggedShots } = await import('./lint/lint-ledger.mjs');
const { splitProblems } = await import('./lint/lint-rules.mjs');
const { reportFromJson } = await import('./page/report-json.mjs');
const { loadIssueRefs } = await import('./known-issues.mjs');
const { buildStats, passStats, readChecks } = await import('./stats.mjs');
const { ranInCi, reportUsageOnce } = await import('./shared/usage.mjs');

const dir = dirname(resolve(input));
const { ledger, actionsLog, knownIssues, changeBase, fileExists, readFile } = readRunDir(dir);

// The ledger alone, while the run is still exploring.
if (flags.check) {
	if (ledger === undefined) {
		console.error(`no ledger.md in ${dir}`);
		process.exit(1);
	}
	// Every file saved under files/, so lint can find one the ledger never listed.
	const root = join(dir, 'files');
	const listFiles = () => (existsSync(root)
		? readdirSync(root, { recursive: true }).map(p => join(root, p)).filter(p => statSync(p).isFile()).map(p => relative(dir, p).split('\\').join('/'))
		: []);
	const { errors, warnings } = splitProblems(lintLedgerOnly(ledger, { fileExists, listFiles, knownIssues, actionsLog }));
	if (errors.length) {
		console.error(`format errors, fix each one and check again:\n${errors.map(p => `  ${p.text}`).join('\n')}`);
	}
	if (warnings.length) {
		console.error(`format warnings, fix any that are quick:\n${warnings.map(p => `  ${p.text}`).join('\n')}`);
	}
	if (!errors.length) {
		console.log('no format errors');
	}
	process.exit(errors.length ? 1 : 0);
}

const json = JSON.parse(readFileSync(input, 'utf8'));
const parsed = reportFromJson(json, { ledger });

// The run directory is made when the run starts. A filesystem with no birth
// time reports the epoch, and the footer falls back to now.
const born = statSync(dir).birthtime;

// The pipeline's render is a local run's last: record its stats, as CI's
// run.mjs does, before the page is written, so the page can link them. A
// replayed CI run keeps the stats CI recorded, and a publish's render records none.
const passes = json.cost?.passes ?? [];
const stats = passes.length && !flags.out && !ranInCi(dir) ? buildStats({
	where: 'local',
	date: (born.getTime() > 0 ? born : new Date()).toISOString(),
	version: skillVersion(),
	...passStats(passes),
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
const issueRefs = await loadIssueRefs(dir, JSON.stringify(json), knownIssues, { offline: Boolean(process.env.NODE_TEST_CONTEXT) });

const out = flags.out ? resolve(flags.out) : join(dir, 'index.html');
await writeRunPage(out, parsed, {
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
	changeBase,
});
console.log(out);

// A listed log that was never copied is a dead link; the page shows it unlinked,
// and the run fails so it gets copied rather than shipped.
const { logs: missing, files: missingTestFiles } = missingFiles(parsed, fileExists);
if (missing.length) {
	console.error(`missing log files, listed but not beside the report:\n${missing.map(p => `  ${p}`).join('\n')}`);
}
// The same for test files: a finding that names one nobody can open cannot be reproduced.
if (missingTestFiles.length) {
	console.error(`missing test files, listed in files but not beside the report:\n${missingTestFiles.map(p => `  ${p}`).join('\n')}`);
}
// Evidence groups by step, so a shot with none has nowhere to go; lint names it.
const untagged = untaggedShots(parsed.findings);
// Sent last, so the row says whether the render failed the run.
if (stats) {
	const final = { missingLogs: missing.length, missingFiles: missingTestFiles.length, untaggedShots: untagged.length };
	await reportUsageOnce(dir, { email: gitEmail(), event: 'finished', runId: basename(dir), stats: { ...stats, final } });
}
if (missing.length || missingTestFiles.length || untagged.length) {
	process.exit(1);
}
