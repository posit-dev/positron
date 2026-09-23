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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
	},
});
const input = positionals[0];
if (!input) {
	console.error('usage: node render.mjs <path/to/report.md> [--model <id>] [--duration-ms <n>] [--turns <n>] [--no-agent-prompts]');
	process.exit(1);
}

// A fresh checkout has never installed this action's dependencies, and the
// renderer needs `marked`. Imported after the install so it can resolve.
if (!existsSync(join(here, 'node_modules', 'marked'))) {
	execFileSync('npm', ['ci', '--silent', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit' });
}
const { renderReportHtml } = await import('./html.mjs');
const { modelDisplayName } = await import('./lib.mjs');

let markdown = readFileSync(input, 'utf8');
if (flags['duration-ms']) {
	// Written here rather than by lib.mjs's renderCostFooter, which CI shares:
	// a local run has no bill, and that footer drops any pass without one.
	const minutes = Math.round(Number(flags['duration-ms']) / 60000);
	const bits = [
		modelDisplayName(flags.model),
		flags.turns && `${flags.turns} turns`,
		minutes === 0 ? '<1m' : `${minutes}m`,
	].filter(Boolean);
	const footer = `_explore: ${bits.join(' | ')}_`;
	// Re-rendering must not stack a second footer under the first.
	const body = markdown.split('\n').filter(l => !/^_[a-z]+:.*_$/.test(l.trim())).join('\n').trimEnd();
	markdown = `${body}\n\n${footer}\n`;
	writeFileSync(input, markdown);
}

const out = join(dirname(resolve(input)), 'index.html');
writeFileSync(out, renderReportHtml(markdown, {
	agentPrompts: !flags['no-agent-prompts'],
	// Evidence in the prompt has to open from wherever it is pasted.
	base: dirname(resolve(input)),
}));
console.log(out);
