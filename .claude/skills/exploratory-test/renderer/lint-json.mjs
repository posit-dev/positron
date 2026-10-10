/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks report.json against the ledger it was written from. The ledger is
// the record of what the run did; the report may leave out, but not add or
// change. Usage: node lint-json.mjs <report.json> [ledger.md]
// Each run is logged to json-checks.jsonl beside the report.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateProblem } from './lint.mjs';
import { parseLedger, plainText, verifyText } from './report-parse.mjs';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
const FILLER = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'and', 'or', 'it', 'its', 'is', 'are', 'was', 'be', 'that', 'this']);
// A step's words, without filler or the ledger's file and action-log references.
const words = text => new Set((norm(text).replace(/\((?:actions\.log:\d+|files\/[^)]*)\)/g, '').toLowerCase().match(/[\w.:/'"-]+/g) ?? []).filter(w => !FILLER.has(w)));

/**
 * How far a report step is from a ledger step: 0 for the same text, else the
 * report's words the ledger lacks. Infinity past one in three: the report may
 * trim a step, but not add to what is done or checked.
 */
function stepDistance(ledgerText, reportText) {
	if (norm(ledgerText) === norm(reportText)) {
		return 0;
	}
	// Values in backticks are what the step acts on or checks; they never differ.
	const codes = text => [...String(text).matchAll(/`([^`]+)`/g)].map(m => m[1]).sort().join('\n');
	if (codes(ledgerText) !== codes(reportText)) {
		return Infinity;
	}
	const [ledger, report] = [words(ledgerText), words(reportText)];
	const added = [...report].filter(w => !ledger.has(w)).length;
	return report.size >= 3 && added <= Math.floor(report.size / 3) ? added + 0.5 : Infinity;
}
const failRate = scenario => /\bFails (\d+\/\d+)\b/.exec(plainText(scenario.resultHtml ?? ''))?.[1] ?? null;
const named = (scenario, n) => scenario.findings.includes(n) || scenario.steps.some(st => st.finding === n);

/** The finding's steps against one scenario's: each one the ledger's, in its order, with its result. */
function stepProblems(f, scenario) {
	const ledger = scenario.steps.map(st => ({ kind: st.kind, text: st.md, result: st.result, finding: st.finding }));
	const problems = [];
	let at = 0;
	f.steps.forEach((s, i) => {
		const text = norm(s.kind === 'verify' ? verifyText(s.text) : s.text);
		// The closest later step of the same kind, so a check reworded by one word is not taken for its neighbour.
		const distance = st => (st.kind === s.kind ? stepDistance(st.text, text) : Infinity);
		let found = -1;
		ledger.forEach((st, j) => {
			if (j >= at && distance(st) < (found < 0 ? Infinity : distance(ledger[found]))) {
				found = j;
			}
		});
		if (found < 0) {
			const anywhere = ledger.some(st => distance(st) < Infinity);
			problems.push(`Finding ${f.n} step ${i + 1} ${anywhere ? 'is out of order against' : 'is not a step of'} ${scenario.id}: "${text}"`);
			return;
		}
		at = found + 1;
		const want = ledger[found];
		const result = s.kind === 'verify' ? s.result ?? null : null;
		if (result !== want.result) {
			problems.push(`Finding ${f.n} step ${i + 1} is ${result ?? 'no result'}, but ${scenario.id} recorded ${want.result ?? 'no result'}`);
		} else if (result === 'fail' && s.finding !== want.finding) {
			problems.push(`Finding ${f.n} step ${i + 1} fails for Finding ${s.finding}, but ${scenario.id} recorded Finding ${want.finding}`);
		}
	});
	return problems;
}

/**
 * Problems with report.json against the ledger, each with the finding number
 * or scenario ID it is about, so a retry can be taken for those parts only.
 */
export function checkReportJson(json, ledgerText) {
	const ledger = parseLedger(ledgerText);
	if (!ledger) {
		return [{ text: 'no ledger to check against' }];
	}
	const problems = [];
	const onFinding = (n, text) => problems.push({ text, finding: n });
	const onScenario = (id, text) => problems.push({ text, scenario: id });
	const scenarios = new Map(ledger.exercised.map(s => [s.id, s]));
	const notRun = new Set(ledger.notExercised.map(s => s.id));

	// Findings: the same numbers the ledger fails.
	const ledgerFindings = new Set(ledger.exercised.flatMap(s => [...s.findings, ...s.steps.map(st => st.finding).filter(n => n !== null)]));
	const findings = json.findings ?? [];
	for (const f of findings) {
		if (!ledgerFindings.has(f.n)) {
			onFinding(f.n, `Finding ${f.n} is not in the ledger: no scenario fails for it`);
		}
	}
	for (const n of ledgerFindings) {
		if (!findings.some(f => f.n === n)) {
			onFinding(n, `the ledger's Finding ${n} is missing`);
		}
	}

	// Scenarios: each one the ledger's, with its status, rate and findings.
	for (const s of json.scenarios ?? []) {
		const own = scenarios.get(s.id);
		if (s.status === 'not-run') {
			if (!own && !notRun.has(s.id)) {
				onScenario(s.id, `${s.id} is not in the ledger`);
			} else if (own) {
				onScenario(s.id, `${s.id} is not run, but the ledger ran it`);
			}
			continue;
		}
		if (!own) {
			onScenario(s.id, `${s.id} is not in the ledger${notRun.has(s.id) ? ', which did not run it' : ''}`);
			continue;
		}
		if (s.status !== own.status) {
			onScenario(s.id, `${s.id} is ${s.status}, but the ledger has ${own.status}`);
		}
		const rate = /\bFails (\d+\/\d+)\b/.exec(s.result ?? '')?.[1];
		if (rate && failRate(own) && rate !== failRate(own)) {
			onScenario(s.id, `${s.id} fails ${rate}, but the ledger has ${failRate(own)}`);
		}
		const want = [...new Set(own.findings)].sort().join(',');
		const got = [...new Set(s.findings ?? [])].sort().join(',');
		if (own.status === 'fail' && want !== got) {
			onScenario(s.id, `${s.id} names findings [${got}], but the ledger has [${want}]`);
		}
	}

	// Each finding: one scenario's steps and its rate.
	for (const f of findings) {
		const owners = ledger.exercised.filter(s => named(s, f.n));
		if (!owners.length) {
			continue;
		}
		const tries = owners.map(s => ({ s, problems: stepProblems(f, s) }));
		const best = tries.reduce((a, b) => (b.problems.length < a.problems.length ? b : a));
		best.problems.forEach(text => onFinding(f.n, text));
		const rate = rateProblem(f.reproduced ? `${f.reproduced.n}/${f.reproduced.m}` : null, best.s, owners);
		if (rate) {
			onFinding(f.n, `Finding ${f.n}'s rate ${rate}`);
		}
		// A log line was either found or looked for and missing, not both.
		const kinds = new Map();
		for (const e of f.evidence ?? []) {
			if (e.kind === 'log' || e.kind === 'missing') {
				const path = String(e.path ?? '').replace(/:\d+$/, '');
				kinds.set(path, new Set([...(kinds.get(path) ?? []), e.kind]));
			}
		}
		for (const [path, k] of kinds) {
			if (k.size === 2) {
				onFinding(f.n, `Finding ${f.n} evidence lists ${path} as both a log line and missing`);
			}
		}
	}
	return problems;
}

const SCHEMA = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'report.schema.json'), 'utf8'));

/** Where json breaks report.schema.json: the subset of JSON Schema it uses. */
export function schemaProblems(json, schema = SCHEMA, at = 'report', root = schema) {
	if (schema.$ref) {
		return schemaProblems(json, root.$defs[schema.$ref.replace('#/$defs/', '')], at, root);
	}
	const kind = Array.isArray(json) ? 'array' : json === null ? 'null' : Number.isInteger(json) ? 'integer' : typeof json;
	if (schema.type && schema.type !== kind && !(schema.type === 'number' && kind === 'integer')) {
		return [`${at} is ${kind}, not ${schema.type}`];
	}
	if (schema.enum && !schema.enum.includes(json)) {
		return [`${at} is ${JSON.stringify(json)}, not one of ${schema.enum.join(', ')}`];
	}
	if (schema.pattern && typeof json === 'string' && !new RegExp(schema.pattern).test(json)) {
		return [`${at} "${json}" does not match ${schema.pattern}`];
	}
	if (schema.minimum !== undefined && typeof json === 'number' && json < schema.minimum) {
		return [`${at} is below ${schema.minimum}`];
	}
	if (kind === 'array' && schema.items) {
		return json.flatMap((x, i) => schemaProblems(x, schema.items, `${at}[${i}]`, root));
	}
	if (kind !== 'object') {
		return [];
	}
	return [
		...(schema.required ?? []).filter(k => json[k] === undefined).map(k => `${at}.${k} is missing`),
		...Object.entries(schema.properties ?? {}).filter(([k]) => json[k] !== undefined).flatMap(([k, s]) => schemaProblems(json[k], s, `${at}.${k}`, root)),
	];
}

/** Problems with report.json against the ledger, as `report.json: ...` lines. */
export function lintReportJson(json, ledgerText) {
	return checkReportJson(json, ledgerText).map(p => `report.json: ${p.text}`);
}

/** The writer's second chance: the problems, and what to fix them from. */
export function buildRetryPrompt(problems) {
	return [
		'A check compared the report you returned with ledger.md, the record of what the run did, and found these problems:',
		'',
		...problems.map(p => `- ${p.text}`),
		'',
		'Fix each one from ledger.md: a finding\'s steps and rate are the scenario\'s that failed for it, each step as the ledger words it (you may trim, not add), and each scenario\'s status and rate as the ledger records them. Where the ledger supports neither version, drop the claim. Change nothing else, and return the whole report again.',
	].join('\n');
}

/**
 * The first report with the retry's version of each finding and scenario the
 * check flagged, and nothing else of the retry's: a retry asked to fix one
 * thing rewords others, and those were already right. Returns the report and
 * the parts the retry changed that were not taken.
 */
export function mergeRetry(first, retry, problems) {
	const findings = new Set(problems.map(p => p.finding).filter(n => n !== undefined));
	const scenarios = new Set(problems.map(p => p.scenario).filter(Boolean));
	const take = (key, flagged, a = [], b = []) => {
		const theirs = new Map(b.map(x => [x[key], x]));
		const kept = a.filter(x => !flagged.has(x[key]) || theirs.has(x[key])).map(x => (flagged.has(x[key]) ? theirs.get(x[key]) : x));
		const added = b.filter(x => flagged.has(x[key]) && !a.some(y => y[key] === x[key]));
		const ignored = b.filter(x => !flagged.has(x[key]) && JSON.stringify(x) !== JSON.stringify(a.find(y => y[key] === x[key]))).map(x => x[key]);
		return { list: [...kept, ...added], ignored };
	};
	const f = take('n', findings, first.findings, retry.findings);
	const s = take('id', scenarios, first.scenarios, retry.scenarios);
	const order = x => [x.id[0] === 'N' ? 1 : 0, Number(x.id.slice(1))];
	s.list.sort((x, y) => order(x)[0] - order(y)[0] || order(x)[1] - order(y)[1]);
	f.list.sort((x, y) => x.n - y.n);
	return {
		report: { ...first, findings: f.list, scenarios: s.list },
		ignored: [...f.ignored.map(n => `Finding ${n}`), ...s.ignored],
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [input, ledgerPath] = process.argv.slice(2);
	if (!input) {
		console.error('usage: node lint-json.mjs <report.json> [ledger.md]');
		process.exit(2);
	}
	let problems;
	try {
		const json = JSON.parse(readFileSync(input, 'utf8'));
		const shape = schemaProblems(json);
		problems = shape.length ? shape.map(p => `report.json: ${p}`) : lintReportJson(json, readFileSync(ledgerPath ?? join(dirname(input), 'ledger.md'), 'utf8'));
	} catch (err) {
		problems = [`report.json: ${err.message}`];
	}
	// How many checks a report took to pass, and what each one found.
	appendFileSync(join(dirname(input), 'json-checks.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), problems })}\n`);
	for (const p of problems) {
		console.log(p);
	}
	process.exitCode = problems.length ? 1 : 0;
}
