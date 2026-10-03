/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run statistics, for judging a change to the skill by what runs did after it:
// turns, cost, findings, verdicts, and how much format fixing the explorer had
// to do before its report linted clean. A run records one stats.json in its
// run directory, and CI also prints it as one `[exploratory] stats:` log line,
// which GitHub keeps for 90 days when the artifact is long gone.
//
// Usage:
//   node stats.mjs [--since YYYY-MM-DD] [--limit N] [--repo owner/name]
//                  [--local-dir <dir>] [--no-ci] [--no-local] [--json]

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Where the explorer's own format checks are recorded, one JSON line each. */
export const CHECKS_FILE = 'format-checks.jsonl';

/**
 * A lint message with its run-specific parts masked, so the same rule counts as
 * one across runs: quoted text, scenario IDs, paths and numbers.
 */
export function ruleKey(message) {
	return String(message)
		.replace(/"[^"]*"/g, '"…"')
		// Paths before IDs, so `S02-foo.png` is a path, not an ID and a path.
		.replace(/(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:png|jpe?g|webp|md|log|py|r|qmd|rmd|csv|json|txt|ipynb|ts|tsx|js|mjs)\b/gi, '<path>')
		.replace(/\b[SN]\d+\b/g, 'S#')
		.replace(/\b\d+\b/g, '#')
		// A list of places is one rule however long it is.
		.replace(/(?:Finding #|S#)(?: step #)?(?:(?:, | and )(?:Finding #|S#)(?: step #)?)+/g, '<places>');
}

/** Records one format check the explorer ran: how many problems, and which rules. */
export function recordCheck(runDir, problems) {
	const rules = {};
	for (const p of problems) {
		const key = ruleKey(p);
		rules[key] = (rules[key] ?? 0) + 1;
	}
	appendFileSync(join(runDir, CHECKS_FILE), `${JSON.stringify({ at: new Date().toISOString(), problems: problems.length, rules })}\n`);
}

/**
 * The run's format checks, summed up: how many rounds, and what the first and
 * last found. The first is the one that says what the prose did not teach; the
 * last should be 0. Null when the explorer never checked.
 */
export function summarizeChecks(text) {
	const checks = String(text ?? '').split('\n').filter(l => l.trim()).map(l => {
		try {
			return JSON.parse(l);
		} catch {
			return null;
		}
	}).filter(Boolean);
	if (!checks.length) {
		return null;
	}
	return {
		rounds: checks.length,
		first: { problems: checks[0].problems, rules: checks[0].rules ?? {} },
		last: checks.at(-1).problems,
		lastRules: checks.at(-1).rules ?? {},
	};
}

export function readChecks(runDir) {
	const path = join(runDir, CHECKS_FILE);
	return summarizeChecks(existsSync(path) ? readFileSync(path, 'utf8') : '');
}

function clip(text, max) {
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * One run's stats record. `parsed` is parseReport's result for the finished
 * report, so findings and verdicts are counted the way the page shows them.
 */
export function buildStats({ where, date, run, version, model, turns, maxTurns, costUsd, durationMs, isolate, parsed, checks, timeLimit }) {
	const verdicts = {};
	for (const f of parsed?.findings ?? []) {
		if (f.verified) {
			verdicts[f.verified] = (verdicts[f.verified] ?? 0) + 1;
		}
	}
	return {
		where,
		date,
		...(run ? { run } : {}),
		branch: parsed?.chips?.[0] ?? null,
		commit: parsed?.chips?.[1] ?? null,
		version: version ?? null,
		model: model ?? null,
		turns: turns ?? null,
		maxTurns: maxTurns ?? null,
		costUsd: typeof costUsd === 'number' ? Math.round(costUsd * 100) / 100 : null,
		durationMs: durationMs ?? null,
		// `{ durationMs, turns }` when an isolation pass ran, else null.
		isolate: isolate ?? null,
		findings: parsed?.findings?.length ?? 0,
		severity: parsed?.severityCounts ?? null,
		verdicts,
		// What the run meant to test and did not, and why: often a setup problem.
		notRun: parsed?.coverage?.notExercised?.length ?? 0,
		notRunReasons: (parsed?.coverage?.notExercised ?? []).map(r => clip(r.reason ?? '', 100)),
		checks: checks ?? null,
		// `{ minutes, reached, stopped }`: whether time ran out, and whether the
		// run then had to be stopped. Null without a limit.
		timeLimit: timeLimit ?? null,
	};
}

const STATS_LINE = /\[exploratory\] stats: (\{.*\})\s*$/m;

/** The stats record a CI job printed, or null for a job from before it did. */
export function statsFromLog(text) {
	const m = STATS_LINE.exec(String(text ?? ''));
	if (!m) {
		return null;
	}
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

function median(values) {
	const v = values.filter(x => typeof x === 'number').sort((a, b) => a - b);
	if (!v.length) {
		return null;
	}
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Per skill version: how many runs, the medians, and the rules that fired on
 * the first check most often, counted once per run.
 */
export function summarizeByVersion(records) {
	const groups = new Map();
	for (const r of records) {
		const key = r.version ?? 'unknown';
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	return [...groups].sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(([version, rs]) => {
		const fired = new Map();
		for (const r of rs) {
			for (const key of Object.keys(r.checks?.first?.rules ?? {})) {
				fired.set(key, (fired.get(key) ?? 0) + 1);
			}
		}
		return {
			version,
			runs: rs.length,
			checked: rs.filter(r => r.checks).length,
			medianTurns: median(rs.map(r => r.turns)),
			medianCost: median(rs.map(r => r.costUsd)),
			medianRounds: median(rs.map(r => r.checks?.rounds)),
			medianFirstProblems: median(rs.map(r => r.checks?.first?.problems)),
			topRules: [...fired].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([rule, runs]) => ({ rule, runs })),
		};
	});
}

function table(rows) {
	const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
	return rows.map(r => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

const dash = v => (v === null || v === undefined ? '-' : v);

export function formatReport(records, summary) {
	const rows = [['date', 'where', 'branch', 'ver', 'model', 'turns', 'cost', 'findings', 'rounds', 'first-check problems']];
	for (const r of records) {
		rows.push([
			String(r.date ?? '').slice(0, 10), r.where, dash(r.branch), dash(r.version), dash(r.model),
			r.turns == null ? '-' : (r.maxTurns ? `${r.turns}/${r.maxTurns}` : r.turns),
			r.costUsd == null ? '-' : `$${r.costUsd.toFixed(2)}`,
			r.findings, dash(r.checks?.rounds), dash(r.checks?.first?.problems),
		]);
	}
	const out = [table(rows), ''];
	for (const s of summary) {
		out.push(`version ${s.version}: ${s.runs} runs (${s.checked} with format checks) | median turns ${dash(s.medianTurns)} | median cost ${s.medianCost == null ? '-' : `$${s.medianCost.toFixed(2)}`} | median rounds ${dash(s.medianRounds)} | median first-check problems ${dash(s.medianFirstProblems)}`);
		for (const { rule, runs } of s.topRules) {
			out.push(`  ${runs}x  ${rule}`);
		}
	}
	return out.join('\n');
}

function gh(args) {
	return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Stats records from CI's explore jobs, newest first. Runs from before the line existed are skipped. */
function ciRecords({ repo, since, limit }) {
	const query = `repos/${repo}/actions/workflows/test-exploratory.yml/runs?per_page=100${since ? `&created=%3E%3D${since}` : ''}`;
	const runs = JSON.parse(gh(['api', query])).workflow_runs.filter(r => r.conclusion !== 'skipped').slice(0, limit);
	const records = [];
	for (const run of runs) {
		const jobs = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`])).jobs.filter(j => j.name.startsWith('explore'));
		for (const job of jobs) {
			try {
				const record = statsFromLog(gh(['api', `repos/${repo}/actions/jobs/${job.id}/logs`]));
				if (record) {
					records.push(record);
				}
			} catch {
				// Logs expire after 90 days; an expired job has nothing to add.
			}
		}
	}
	return records;
}

function localRecords(dir, since) {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.map(name => join(dir, name, 'stats.json'))
		.filter(existsSync)
		.map(p => {
			try {
				return JSON.parse(readFileSync(p, 'utf8'));
			} catch {
				return null;
			}
		})
		.filter(r => r && (!since || String(r.date) >= since));
}

function main(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			since: { type: 'string' },
			limit: { type: 'string', default: '50' },
			repo: { type: 'string', default: 'posit-dev/positron' },
			'local-dir': { type: 'string', default: join(homedir(), '.claude', 'skills', 'exploratory-test', 'output') },
			'no-ci': { type: 'boolean' },
			'no-local': { type: 'boolean' },
			json: { type: 'boolean' },
		},
	});
	const limit = Number(values.limit);
	if (!Number.isInteger(limit) || limit < 1) {
		console.error(`stats: --limit must be a positive whole number, got "${values.limit}"`);
		return 2;
	}
	const records = [
		...(values['no-ci'] ? [] : ciRecords({ repo: values.repo, since: values.since, limit })),
		...(values['no-local'] ? [] : localRecords(values['local-dir'], values.since)),
	].sort((a, b) => String(b.date).localeCompare(String(a.date)));
	if (!records.length) {
		console.log('No runs with stats yet. Runs record them from skill version 1.1 on.');
		return 0;
	}
	const summary = summarizeByVersion(records);
	console.log(values.json ? JSON.stringify({ records, summary }, null, 2) : formatReport(records, summary));
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
