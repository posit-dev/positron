/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks report.json against the ledger it was written from, and against the
// rules report.md is held to that are not its layout (lint.mjs). The ledger is
// the record of what the run did; the report may leave out, but not add or
// change. Usage: node lint-json.mjs <report.json> [ledger.md]
// Each run is logged to json-checks.jsonl beside the report.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKnownIssues } from './finish.mjs';
import { absolutePathProblems, findingProblems, modelProblems, rateProblem, rateProblems, resultProblems, runProblems, splitProblems } from './lint.mjs';
import { reportFromJson } from './report-json.mjs';
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
 * The finding's repro is the shortest way to its failure: it ends at its first
 * failing check, and no setup step (one before the first check) changes what a
 * precondition already set. A later change may be the trigger.
 */
function reproProblems(f) {
	const problems = [];
	const steps = f.steps ?? [];
	const fails = steps.findIndex(s => s.kind === 'verify' && s.result === 'fail' && (s.finding ?? f.n) === f.n);
	if (fails >= 0 && fails < steps.length - 1) {
		problems.push(`Finding ${f.n} goes on for ${steps.length - fails - 1} steps after its failure at step ${fails + 1}; end the steps there, and put a later sighting or other trigger in Observed`);
	}
	const codes = text => [...String(text ?? '').matchAll(/`([^`]+)`/g)].map(m => m[1]);
	const setup = steps.slice(0, Math.max(0, steps.findIndex(s => s.kind === 'verify')));
	for (const p of f.preconditions ?? []) {
		const set = new Set(codes(`${p.name ?? ''} ${p.text ?? ''}`));
		setup.forEach((s, i) => {
			const code = /^(?:set|change|turn|enable|disable|toggle)\b/i.test(norm(s.text)) && codes(s.text).find(c => set.has(c));
			if (code) {
				problems.push(`Finding ${f.n} step ${i + 1} changes \`${code}\`, which precondition "${p.name ?? p.text}" already sets; a precondition is the state before step 1, so give the value step 1 starts from`);
			}
		});
	}
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
		reproProblems(f).forEach(text => onFinding(f.n, text));
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

/** Every string in a value, for the files/ paths its prose names. */
const stringsOf = value => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(stringsOf) : []);

/**
 * The rules report.md is held to, on report.json's fields: its words, steps,
 * preconditions and evidence, and the run directory it was written from.
 * `options` are lintReport's. Layout rules have no counterpart: the schema
 * holds the shape.
 */
export function formatProblems(json, ledger, options = {}) {
	const header = json.header ?? {};
	const findings = json.findings ?? [];
	const problems = [...resultProblems(header.result ?? '')];
	for (const f of findings) {
		problems.push(...rateProblems(f.n, f.severity, f.reproduced ? `${f.reproduced.n}/${f.reproduced.m}` : ''));
		const steps = (f.steps ?? []).map((s, i) => ({ n: String(i + 1), verify: s.kind === 'verify', text: s.text, result: s.result?.toUpperCase() }));
		problems.push(...findingProblems(f.n, {
			title: f.title,
			feature: f.feature,
			observed: f.observed,
			expected: f.expected,
			preconditions: (f.preconditions ?? []).map(p => ({ name: p.name, text: p.text ?? '' })),
			steps,
			lines: [f.observed, f.expected, f.cause, ...steps.map(st => st.text)].filter(Boolean),
		}));
		const frame = (f.errors ?? []).flatMap(e => e.frames ?? []).find(fr => /\bout\/vs\/\S+\.js$/.test(fr.path ?? ''));
		if (frame) {
			problems.push(`report: map compiled frames to source paths: "${frame.path}:${frame.line}"`);
		}
		problems.push(...absolutePathProblems('report', (f.evidence ?? []).map(e => e.path ?? '')));
	}
	problems.push(...absolutePathProblems('report', [...(json.logs ?? []), ...(json.files ?? [])].map(x => x.path ?? '')));
	problems.push(...modelProblems(reportFromJson(json, { ledger }).findings, ledger, options));
	problems.push(...runProblems(stringsOf({ header, findings }).join('\n'), ledger, {
		...options,
		needs: findings.flatMap(f => (f.preconditions ?? []).map(p => [`Finding ${f.n}`, `${p.name ? `${p.name} | ` : ''}${p.text ?? ''}`])),
		findingNumbers: new Set(findings.map(f => f.n)),
		notExercised: header.notExercised,
	}));
	return problems;
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
		'Fix each one from ledger.md: a finding\'s rate is the scenario\'s that failed for it, and its steps the fewest of that scenario\'s that reach the finding\'s first failing check, ending there, each as the ledger words it (you may trim, not add); each scenario\'s status and rate are as the ledger records them. Where the ledger supports neither version, drop the claim. Change nothing else, and return the whole report again.',
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

/** lintReport's options for the run directory `dir`, as render.mjs builds them. */
function runDirOptions(dir) {
	const read = name => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined);
	const files = join(dir, 'files');
	// Test paths are relative to the checkout the explorer runs in.
	const repo = (() => {
		try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
	})();
	return {
		fileExists: path => existsSync(join(dir, path)),
		listFiles: () => (existsSync(files)
			? readdirSync(files, { recursive: true }).map(p => join(files, p)).filter(p => statSync(p).isFile()).map(p => relative(dir, p).split('\\').join('/'))
			: []),
		repoFileExists: repo ? path => existsSync(join(repo, path)) : undefined,
		knownIssues: readKnownIssues(dir) ?? undefined,
		actionsLog: read('actions.log'),
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
		if (shape.length) {
			problems = shape.map(p => `report.json: ${p}`);
		} else {
			const ledger = readFileSync(ledgerPath ?? join(dirname(input), 'ledger.md'), 'utf8');
			problems = [...lintReportJson(json, ledger), ...formatProblems(json, ledger, runDirOptions(dirname(input)))];
		}
	} catch (err) {
		problems = [`report.json: ${err.message}`];
	}
	const { errors, warnings } = splitProblems(problems);
	// How many checks a report took to pass, and what each one found.
	appendFileSync(join(dirname(input), 'json-checks.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), errors, warnings })}\n`);
	if (errors.length) {
		console.log(`errors, fix each one and check again:\n${errors.map(p => `  ${p}`).join('\n')}`);
	}
	if (warnings.length) {
		console.log(`warnings, fix any that are quick; they need no further check:\n${warnings.map(p => `  ${p}`).join('\n')}`);
	}
	process.exitCode = errors.length ? 1 : 0;
}
