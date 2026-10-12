/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks whether one rule in an agent's prompt changes what the agent does.
// Each case under ../evals/ names the prompt, the rule's text, a fixture that
// puts the agent at the point the rule matters, and what a plan must do to
// pass. The agent answers with a plan and no tools, once with the prompt as it
// is and once with the rule cut out, and Haiku grades each plan. Usage:
//   node eval.mjs [case ...] [--samples N] [--model opus] [--dry-run]
// A case may name its own model, and values for its prompt's {{NAME}} placeholders.
// A case whose rule text is no longer in the prompt fails before anything is
// spent: update its `remove` when the rule is reworded.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runClaude } from './agents/claude-cli.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVALS_DIR = join(SKILL_DIR, 'evals');
const OUTPUT_DIR = join(homedir(), '.local', 'state', 'exploratory-test', 'evals');
const CONCURRENCY = 4;

/** A case from its folder: the prompt with and without the rule, the fixture and the criterion. */
export function loadCase(dir, { readFile = p => readFileSync(p, 'utf8') } = {}) {
	const spec = JSON.parse(readFile(join(dir, 'case.json')));
	const agent = readFile(join(SKILL_DIR, spec.agent));
	return {
		rule: spec.rule,
		criterion: spec.criterion,
		model: spec.model ?? null,
		with: fill(agent, spec.fill),
		without: fill(ablate(agent, spec.remove), spec.fill),
		fixture: readFile(join(dir, spec.fixture)),
	};
}

/**
 * `text` with its `{{NAME}}` placeholders filled, as the pipeline fills the
 * verifier's: from `values`, else with a pointer to the fixture, which holds
 * what the files would.
 */
export function fill(text, values = {}) {
	return text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '(given below)');
}

/**
 * `text` less each `{ from, to }` span: from the start of `from` through the
 * end of the first `to` after it. Throws when either is missing, so a
 * reworded rule cannot pass for one that was cut.
 */
export function ablate(text, remove) {
	let out = text;
	for (const { from, to } of remove) {
		const start = out.indexOf(from);
		const end = start === -1 ? -1 : out.indexOf(to, start);
		if (start === -1 || end === -1) {
			throw new Error(`the rule text is not in the prompt: "${start === -1 ? from : to}"`);
		}
		out = out.slice(0, start) + out.slice(end + to.length);
	}
	return out.replace(/\n{3,}/g, '\n\n');
}

/** The agent's prompt with the fixture after it, as the pipeline puts a brief after explorer.md. */
export function agentPrompt(prompt, fixture) {
	return `${prompt.trim()}\n\n---\n\n${fixture.trim()}\n`;
}

/** The grader's prompt: the criterion, then the plan. */
export function gradePrompt(criterion, plan) {
	return [
		'You grade a plan an agent wrote. Judge only what the plan says it will do, against this criterion:',
		'',
		criterion,
		'',
		'Reply with PASS or FAIL on the first line, then one sentence saying which part of the plan decided it.',
		'',
		'The plan:',
		'',
		'"""',
		plan.trim(),
		'"""',
	].join('\n');
}

/** 'pass', 'fail', or null when the grader's reply opens with neither. */
export function parseGrade(text) {
	const m = /^\W*(PASS|FAIL)\b/i.exec(String(text ?? '').trim());
	return m ? m[1].toLowerCase() : null;
}

/** Pass counts per case and arm, from result rows. */
export function summarize(rows) {
	const out = new Map();
	for (const r of rows) {
		const key = `${r.case}\t${r.arm}`;
		const s = out.get(key) ?? { case: r.case, arm: r.arm, pass: 0, graded: 0, costUsd: 0 };
		s.pass += r.grade === 'pass' ? 1 : 0;
		s.graded += r.grade ? 1 : 0;
		s.costUsd += (r.costUsd ?? 0) + (r.gradeCostUsd ?? 0);
		out.set(key, s);
	}
	return [...out.values()];
}

/** Runs `tasks` with at most `limit` going at once. */
async function pool(tasks, limit) {
	const results = [];
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
		while (next < tasks.length) {
			const i = next++;
			results[i] = await tasks[i]();
		}
	}));
	return results;
}

async function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: { samples: { type: 'string', default: '4' }, model: { type: 'string', default: 'opus' }, 'dry-run': { type: 'boolean', default: false } },
	});
	const names = positionals.length ? positionals : readdirSync(EVALS_DIR).filter(n => !n.startsWith('.'));
	const cases = names.map(name => ({ name, ...loadCase(join(EVALS_DIR, name)) }));
	const samples = Number(values.samples);
	for (const c of cases) {
		console.log(`${c.name}: the rule cuts ${c.with.length - c.without.length} characters`);
	}
	if (values['dry-run']) {
		return 0;
	}
	const out = join(OUTPUT_DIR, new Date().toISOString().replace(/[:.]/g, '-'));
	mkdirSync(out, { recursive: true });
	const resultsPath = join(out, 'results.jsonl');
	// Outside any checkout, so no project instructions reach the agent.
	const cwd = mkdtempSync(join(tmpdir(), 'exploratory-eval-'));
	const quiet = () => { };
	const tasks = cases.flatMap(c => ['with', 'without'].flatMap(arm => Array.from({ length: samples }, (_, i) => async () => {
		const model = c.model ?? values.model;
		const row = { case: c.name, arm, sample: i + 1, model };
		try {
			const plan = await runClaude({ prompt: agentPrompt(c[arm], c.fixture), model, cwd, feed: quiet });
			const grade = await runClaude({ prompt: gradePrompt(c.criterion, plan.text), model: 'haiku', cwd, feed: quiet });
			Object.assign(row, { plan: plan.text, costUsd: plan.costUsd, grade: parseGrade(grade.text), why: grade.text, gradeCostUsd: grade.costUsd });
		} catch (e) {
			row.error = String(e.message ?? e);
		}
		appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
		console.log(`${c.name} ${arm} #${row.sample}: ${row.grade ?? row.error}`);
		return row;
	})));
	console.log(`results: ${resultsPath}`);
	const rows = await pool(tasks, CONCURRENCY);
	rmSync(cwd, { recursive: true, force: true });
	const summary = summarize(rows);
	for (const s of summary) {
		console.log(`${s.case}\t${s.arm}\t${s.pass}/${s.graded} pass\t$${s.costUsd.toFixed(2)}`);
	}
	writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, '\t')}\n`);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(code => process.exit(code), e => {
		console.error(`eval: ${e.message}`);
		process.exit(1);
	});
}
