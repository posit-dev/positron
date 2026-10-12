/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks report.json against the ledger it was written from, and against the
// write-up rules in lint-wording.mjs and lint-ledger.mjs. The ledger is the
// record of what the run did; the report may leave out, but not add or
// change. Usage:
//   node lint-json.mjs <report.json> [ledger.md]
// Each check is logged to format-checks.jsonl beside the report, for the run's
// stats. readCheckedReport is the same check once the explorer is done, logged.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKnownIssues } from './agents/finish.mjs';
import { absolutePathProblems, modelProblems, rateProblem, runProblems } from './lint/lint-ledger.mjs';
import { problem, splitProblems } from './lint/lint-rules.mjs';
import { findingProblems, rateProblems, resultProblems } from './lint/lint-wording.mjs';
import { reportFromJson } from './page/report-json.mjs';
import { recordCheck } from './stats.mjs';
import { parseLedger, verifyText } from './shared/ledger.mjs';

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
			problems.push(problem(anywhere ? 'finding-step-out-of-order' : 'finding-step-not-in-scenario', `Finding ${f.n} step ${i + 1} ${anywhere ? 'is out of order against' : 'is not a step of'} ${scenario.id}: "${text}"`));
			return;
		}
		at = found + 1;
		const want = ledger[found];
		const result = s.kind === 'verify' ? s.result ?? null : null;
		if (result !== want.result) {
			problems.push(problem('finding-step-result', `Finding ${f.n} step ${i + 1} is ${result ?? 'no result'}, but ${scenario.id} recorded ${want.result ?? 'no result'}`));
		} else if (result === 'fail' && s.finding !== want.finding) {
			problems.push(problem('finding-step-finding', `Finding ${f.n} step ${i + 1} fails for Finding ${s.finding}, but ${scenario.id} recorded Finding ${want.finding}`));
		}
	});
	return problems;
}

/**
 * Problems with report.json's findings against the ledger, each with the
 * finding number it is about, so a retry can be taken for those parts only.
 */
export function checkReportJson(json, ledgerText) {
	const ledger = parseLedger(ledgerText);
	if (!ledger) {
		return [problem('no-ledger', 'no ledger to check against')];
	}
	const problems = [];
	const onFinding = (n, rule, text) => problems.push(problem(rule, text, { finding: n }));

	// Findings: the same numbers the ledger fails.
	const ledgerFindings = new Set(ledger.exercised.flatMap(s => [...s.findings, ...s.steps.map(st => st.finding).filter(n => n !== null)]));
	const findings = json.findings ?? [];
	for (const f of findings) {
		if (!ledgerFindings.has(f.n)) {
			onFinding(f.n, 'finding-not-in-ledger', `Finding ${f.n} is not in the ledger: no scenario fails for it`);
		}
	}
	for (const n of ledgerFindings) {
		if (!findings.some(f => f.n === n)) {
			onFinding(n, 'ledger-finding-missing', `the ledger's Finding ${n} is missing`);
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
		best.problems.forEach(p => problems.push({ ...p, finding: f.n }));
		const rate = rateProblem(f.reproduced ? `${f.reproduced.n}/${f.reproduced.m}` : null, best.s, owners);
		if (rate) {
			onFinding(f.n, 'finding-rate', `Finding ${f.n}'s rate ${rate}`);
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
				onFinding(f.n, 'evidence-found-and-missing', `Finding ${f.n} evidence lists ${path} as both a log line and missing`);
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
	const types = [schema.type ?? []].flat();
	if (types.length && !types.includes(kind) && !(types.includes('number') && kind === 'integer')) {
		return [`${at} is ${kind}, not ${types.join(' or ')}`];
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
 * The write-up rules on report.json's fields: its words, steps, preconditions
 * and evidence, and the run directory it was written from. `options` are
 * runDirOptions'. The schema holds the shape.
 */
export function formatProblems(json, ledger, options = {}) {
	const header = json.header ?? {};
	const findings = json.findings ?? [];
	const problems = [...resultProblems(header.result ?? '')];
	// The schema asks only that they are there; the page has nothing to show for an empty one.
	for (const [key, label] of [['result', 'Result'], ['tested', 'Tested'], ['notExercised', 'Not exercised']]) {
		if (!String(header[key] ?? '').trim()) {
			problems.push(problem('header-empty', `report: header.${key} is empty; write the ${label} line`));
		}
	}
	for (const f of findings) {
		if (!String(f.feature ?? '').trim()) {
			problems.push(problem('feature-missing', `report: Finding ${f.n} has no feature; name the area of Positron it is in, such as "data explorer"`));
		}
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
			problems.push(problem('compiled-frames', `report: map compiled frames to source paths: "${frame.path}:${frame.line}"`));
		}
		problems.push(...absolutePathProblems('report', [...(f.evidence ?? []).map(e => e.path ?? ''), ...(f.steps ?? []).map(s => String(s.log?.source ?? '').split(/[\s|]/)[0])]));
		const outside = (f.evidence ?? []).find(e => e.kind === 'shot' && !/^shots\//.test(e.path ?? ''));
		if (outside) {
			problems.push(problem('shot-outside-shots', `report: Finding ${f.n} links the screenshot ${outside.path}; link it as shots/<file>`));
		}
		if (options.fileExists) {
			const shots = [...(f.steps ?? []).flatMap(s => s.shots ?? []), ...(f.evidence ?? []).filter(e => e.kind === 'shot').map(e => e.path)];
			for (const p of [...new Set(shots)].filter(p => p && !options.fileExists(p))) {
				problems.push(problem('shot-missing', `report: Finding ${f.n} cites ${p}, which is not in the run directory`));
			}
		}
	}
	// A markdown link anywhere in the prose is a file the reader opens.
	const links = stringsOf({ header, findings }).flatMap(t => [...t.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]));
	problems.push(...absolutePathProblems('report', links));
	problems.push(...modelProblems(reportFromJson(json, { ledger }).findings, ledger, options));
	problems.push(...runProblems(stringsOf({ header, findings }).join('\n'), ledger, {
		...options,
		needs: findings.flatMap(f => (f.preconditions ?? []).map(p => [`Finding ${f.n}`, p.text ?? '', p.name])),
		findingNumbers: new Set(findings.map(f => f.n)),
		notExercised: header.notExercised,
	}));
	return problems;
}

/** Problems with report.json against the ledger, as `report.json: ...` lines. */
export function lintReportJson(json, ledgerText) {
	return checkReportJson(json, ledgerText).map(p => ({ ...p, text: `report.json: ${p.text}` }));
}

/** Schema problems first: the ledger check reads fields the schema requires. */
function problemsOf(json, ledger) {
	const shape = schemaProblems(json);
	return shape.length ? shape.map(text => problem('schema', text)) : checkReportJson(json, ledger);
}

/**
 * report.json once the explorer is done, or null when it wrote none that
 * parses. What the check still finds is logged: the explorer runs it until it
 * passes, so a problem here is one it left on purpose or ran out of time for.
 */
export function readCheckedReport(workDir, { log = console.log } = {}) {
	const path = join(workDir, 'report.json');
	if (!existsSync(path)) {
		return null;
	}
	let json;
	try {
		json = JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		log(`[json] report.json does not parse: ${err.message}`);
		return null;
	}
	const ledger = existsSync(join(workDir, 'ledger.md')) ? readFileSync(join(workDir, 'ledger.md'), 'utf8') : '';
	const problems = problemsOf(json, ledger);
	log(`[json] ${problems.length} problems after the explorer${problems.length ? `: ${problems.map(p => p.text).join(' | ')}` : ''}`);
	return json;
}

/** formatProblems' options for the run directory `dir`. */
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
			problems = shape.map(p => problem('schema', `report.json: ${p}`));
		} else {
			const ledger = readFileSync(ledgerPath ?? join(dirname(input), 'ledger.md'), 'utf8');
			problems = [...lintReportJson(json, ledger), ...formatProblems(json, ledger, runDirOptions(dirname(input)))];
		}
	} catch (err) {
		problems = [problem('schema', `report.json: ${err.message}`)];
	}
	const { errors, warnings } = splitProblems(problems);
	// How many checks a report took to pass, and what each one found.
	recordCheck(dirname(input), problems, errors.length);
	if (errors.length) {
		console.log(`errors, fix each one and check again:\n${errors.map(p => `  ${p.text}`).join('\n')}`);
	}
	if (warnings.length) {
		console.log(`warnings, fix any that are quick; they need no further check:\n${warnings.map(p => `  ${p.text}`).join('\n')}`);
	}
	process.exitCode = errors.length ? 1 : 0;
}
