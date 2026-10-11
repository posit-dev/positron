/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Builds the page's report model from report.json, the explorer's structured
// report, for html.mjs to render. Prose fields are markdown; everything else
// is data.

import { join } from 'node:path';
import { readRunDir, writeRunPage } from './html.mjs';
import { skillVersion } from './page-common.mjs';
import { parseLedger, parseLogField, verifyText } from './ledger.mjs';
import { basename, block, formatMinutes, inline, isDefaultsOnly, modelDisplayName, plainText, safeUrl, sentenceCase } from './text.mjs';

const TEST_LEVEL = { unit: 'Unit', extension: 'Extension', e2e: 'E2E' };

/** A schema step as the page's typed step. */
function stepFromJson(s) {
	const md = s.kind === 'verify' ? verifyText(s.text) : s.text;
	const result = s.kind === 'verify' ? s.result ?? null : null;
	const observed = result === 'fail' ? s.observed ?? '' : '';
	const evidence = (s.shots ?? []).map(p => safeUrl(p)).filter(Boolean).map(href => ({ href, file: basename(href) }));
	// `none found` is a looked-for log line, not a log to show.
	const found = s.log?.source && !/^none found\b/i.test(s.log.body ?? '');
	const log = !s.log?.source ? '' : found ? s.log.source : `none found in ${s.log.source}`;
	const logBody = found ? String(s.log.body ?? '').split('\n').filter(l => l.trim()) : [];
	return {
		kind: s.kind,
		md,
		result,
		finding: result === 'fail' ? s.finding ?? null : null,
		observed,
		evidence,
		log,
		logBody,
		error: parseLogField(log, logBody),
		rest: s.code ? s.code.split('\n') : [],
		html: inline(md),
		blockHtml: s.code ? block(s.code) : '',
		observedHtml: observed ? inline(observed) : '',
	};
}

/** A schema evidence item as the page lays it out. */
function evidenceFromJson(e) {
	if (e.kind === 'shot') {
		const src = safeUrl(e.path);
		return src ? {
			kind: 'shot',
			src,
			file: basename(src),
			step: Number.isInteger(e.step) ? { label: `Step ${e.step}`, order: e.step } : null,
			...(e.scenario ? { scenario: e.scenario } : {}),
			caption: e.caption || basename(src),
			...(e.featured ? { featured: true } : {}),
		} : null;
	}
	if (e.kind === 'log') {
		return { kind: 'log', path: e.path ?? '', process: e.process ?? '', when: e.when ?? '', quote: e.quote ?? '', note: '' };
	}
	if (e.kind === 'missing') {
		return { kind: 'missing', path: e.path ?? '', window: e.window ?? e.when ?? '', quote: e.quote ?? '', note: '' };
	}
	return { kind: 'note', text: e.caption ?? e.quote ?? '' };
}

/** A schema error as the page lays it out. */
function errorFromJson(e) {
	const count = e.count ?? 1;
	// "Logged 2x (after each Retry)": the count, and when it was logged.
	const logged = [count > 1 ? `${count}x` : '', e.note ? `(${e.note})` : ''].filter(Boolean).join(' ');
	const meta = [e.process, logged ? `Logged ${logged}` : ''].filter(Boolean);
	const frames = (e.frames ?? []).map(f => ({ fn: f.fn ?? '', path: f.path ?? '', line: f.line ?? 0 }));
	const raw = [e.message, ...frames.map(f => `at ${f.fn ? `${f.fn} (${f.path}:${f.line})` : `${f.path}:${f.line}`}`)].join('\n');
	return withMetaHtml({ source: e.source, meta, count, message: e.message, frames, raw });
}

function findingFromJson(f) {
	const steps = (f.steps ?? []).map(stepFromJson);
	const named = (f.preconditions ?? [])
		.filter(p => p.text && !isDefaultsOnly(p.text))
		.map(p => ({ name: p.name ?? '', text: sentenceCase(p.text) }));
	const preconditions = named.map(p => p.text);
	const reproduced = f.reproduced ? `${f.reproduced.n}/${f.reproduced.m}` : '';
	const cases = (f.tests?.cases ?? []).map(c => {
		const note = c.isNew ? 'new file' : c.note ?? '';
		return { text: c.text ?? '', level: TEST_LEVEL[c.level] ?? null, path: c.path ?? '', note, textHtml: inline(c.text), noteHtml: note ? inline(note) : '' };
	});
	const related = (f.tests?.related ?? []).filter(r => r.path).map(r => (
		{ path: r.path, level: TEST_LEVEL[r.level] ?? null, note: r.note ?? '', noteHtml: r.note ? inline(r.note) : '' }));
	return {
		n: f.n,
		title: f.title,
		feature: f.feature ?? '',
		rowTitle: inline(f.title),
		severity: f.severity,
		reproduced,
		confirmed: f.reproduced?.n === 0 ? 'Unproven' : 'Confirmed',
		// Set by the verifier; absent on a report it has not seen.
		verified: f.verified ?? null,
		known: f.known ?? [],
		intended: f.intended ?? [],
		// The edit pass's opening, when it has run.
		summaryHtml: f.summary ? inline(f.summary) : '',
		observedHtml: f.observed ? inline(f.observed) : '',
		expectedHtml: f.expected ? inline(f.expected) : '',
		preconditions: preconditions.map(t => (t.includes('\n') ? block(t) : inline(t))),
		preconditionNames: named.map(p => (p.name ? inline(p.name) : '')),
		steps,
		evidence: arrangeEvidence(steps, (f.evidence ?? []).map(evidenceFromJson).filter(Boolean), f.n),
		causeHtml: f.cause ? inline(f.cause) : '',
		errors: (f.errors ?? []).map(errorFromJson),
		tests: { cases, related },
		hero: null,
		text: {
			observed: f.observed ?? '',
			expected: f.expected ?? '',
			preconditions,
			steps: steps.map(stepText),
			cause: f.cause ?? '',
			summary: f.summary ?? '',
			opening: f.summary ? { summary: f.summary, where: f.where ?? '' } : null,
			prose: '',
		},
		proseHtml: '',
	};
}

/** Coverage from the report's scenarios, for a run with no ledger. */
function coverageFromJson(scenarios) {
	const rows = s => ({ id: s.id, scenarioHtml: inline(s.name), scenario: plainText(s.name), issues: s.issues ?? [] });
	return {
		exercised: scenarios.filter(s => s.status !== 'not-run').map(s => ({
			...rows(s),
			resultHtml: inline(sentenceCase(s.result ?? '')),
			status: s.status,
			finding: s.findings?.[0] ?? null,
			findings: s.findings ?? [],
			shot: null,
			pre: [],
			steps: [],
		})),
		notExercised: scenarios.filter(s => s.status === 'not-run').map(s => ({
			...rows(s),
			reasonHtml: inline(sentenceCase(s.reason ?? '')),
			reason: plainText(s.reason ?? ''),
		})),
		notExercisedListed: true,
	};
}

/**
 * The Run tile's cost from report.json's `cost.passes`, each
 * `{ label, model, costUsd, turns, maxTurns, durationMs }`, as the markdown
 * footer gives it: a total only over several passes, and only when each has a cost.
 */
function costFromJson(cost) {
	const passes = cost?.passes ?? [];
	const dollars = n => (typeof n === 'number' ? `$${n.toFixed(2)}` : null);
	const ms = passes.reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
	return {
		passes: passes.map(p => ({
			label: p.label,
			model: modelDisplayName(p.model),
			cost: dollars(p.costUsd),
			turns: typeof p.turns === 'number' ? String(p.turns) : null,
			maxTurns: typeof p.maxTurns === 'number' ? String(p.maxTurns) : null,
			duration: typeof p.durationMs === 'number' ? formatMinutes(p.durationMs) : null,
		})),
		total: passes.length && passes.every(p => typeof p.costUsd === 'number') ? dollars(passes.reduce((sum, p) => sum + p.costUsd, 0)) : null,
		duration: ms ? formatMinutes(ms) : null,
	};
}

/**
 * The report model from report.json and the run's ledger. The pipeline writes
 * `verification` and `cost` into report.json; `pipeline` stands in for a report
 * without them.
 */
export function reportFromJson(json, { ledger, pipeline = {} } = {}) {
	const header = json.header ?? {};
	// Worst first, then by number, so the numbers run in order within a severity.
	const rank = { major: 0, moderate: 1, minor: 2 };
	const findings = (json.findings ?? []).map(findingFromJson)
		.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || a.n - b.n);
	const fromLedger = parseLedger(ledger);
	const coverage = fromLedger && (fromLedger.exercised.length || fromLedger.notExercised.length)
		? fromLedger
		: coverageFromJson(json.scenarios ?? []);
	fillStepErrors(findings, coverage);
	const severityCounts = { major: 0, moderate: 0, minor: 0 };
	for (const f of findings) {
		if (f.severity in severityCounts) { severityCounts[f.severity]++; }
	}
	const pr = header.pr?.number && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(header.pr.repo ?? '')
		? { number: header.pr.number, url: `https://github.com/${header.pr.repo}/pull/${header.pr.number}` }
		: undefined;
	const details = (header.details ?? []).map(d => ({ title: d.title, html: block(d.body) })).filter(d => d.html);
	return {
		title: String(header.title ?? 'Exploratory test').replace(/^Exploratory test:\s*/i, ''),
		chips: [header.branch, header.sha].filter(Boolean),
		pr,
		leadHtml: leadHtml(header.result ?? ''),
		scopeHtml: scopeHtml(header.tested ?? ''),
		findings,
		severityCounts,
		findingCount: findings.length,
		coverage,
		scenarios: scenarioCounts(coverage),
		runDetails: withEnvironment(details.length ? details : null, fromLedger?.environment),
		logs: fromLedger?.logs ?? (json.logs ?? []).map(l => ({ path: l.path, source: l.source ?? '', note: l.note ?? '', sourceHtml: inline(l.source), noteHtml: inline(l.note) })),
		files: fromLedger?.files ?? (json.files ?? []).map(f => ({ path: f.path, desc: f.desc ?? '', uses: f.uses ?? '', descHtml: inline(f.desc), usesHtml: inline(f.uses) })),
		environment: fromLedger?.environment ?? [],
		verification: json.verification?.text ? verificationFromJson(json) : pipeline.verification ?? null,
		cost: json.cost ? costFromJson(json.cost) : pipeline.cost ?? { passes: [], total: null, duration: null },
	};
}

/** Renders report.json as the run's index.html. */
export async function writeJsonPage(workDir, json, options) {
	const { ledger, knownIssues, issueRefs, changeBase, fileExists, readFile } = readRunDir(workDir);
	const report = reportFromJson(json, { ledger });
	await writeRunPage(join(workDir, 'index.html'), report, {
		ledger, fileExists, readFile, knownIssues, issueRefs, changeBase, skillVersion: skillVersion(), ...options,
	});
}

/** A step as the agent prompt writes it: `Verify ... \u2192 FAIL (observed: ...)`. */
function stepText(step) {
	const result = !step.result ? ''
		: ` \u2192 ${step.result.toUpperCase()}${step.observed ? ` (observed: ${step.observed})` : ''}`;
	// The card has no place for a log line, so the prompt is where it goes.
	const log = step.log ? [`Log: ${step.log}`, ...step.logBody.map(l => `  ${l}`)] : [];
	return [step.md + result, ...step.rest, ...log].join('\n');
}

/**
 * Verification details: the preamble, a chip per verdict, the verifier's
 * notes, the findings it marked related to the change, and its severity for
 * each linked issue the run ran into.
 */
function verificationFromJson(json) {
	const v = json.verification;
	const lines = String(v.text ?? '').split('\n');
	const at = lines.findIndex(l => l.trim() && !l.trim().startsWith('#'));
	return {
		preambleHtml: at === -1 ? '' : inline(lines[at].trim()),
		verdicts: (json.findings ?? []).filter(f => f.verified).map(f => ({ n: f.n, word: f.verified })),
		linked: new Map((v.linked ?? []).map(l => [l.issue, l.severity])),
		change: new Set(v.related ?? []),
		bodyHtml: block(lines.slice(at + 1).join('\n')),
	};
}

function withMetaHtml(e) {
	// A letter x sits on the baseline where a multiplication sign floats; the
	// span keeps it lowercase inside an uppercase label.
	return { ...e, metaHtml: e.meta.map(m => inline(m).replace(/(\d+)\s*(?:x\b|\u00d7)/g, '<span class="n-x">$1x</span>')) };
}

/** Scenario tallies for the tile, from Coverage rows. */
function scenarioCounts({ exercised, notExercised }) {
	const issue = r => r.status === 'fail' || Boolean(r.finding);
	return {
		exercised: exercised.length,
		pass: exercised.filter(r => !issue(r)).length,
		issues: exercised.filter(issue).length,
		notRun: notExercised.length,
	};
}

/**
 * A finding's evidence as the card shows it. `steps` are typed steps, each
 * citing `{ href, file }` shots; shot items are `{ kind, src, file, step,
 * scenario?, caption, featured? }`. Returns a new array.
 */
function arrangeEvidence(steps, evidence, n) {
	evidence = evidence.map(e => ({ ...e }));
	const stepOf = new Map();
	steps.forEach((step, k) => step.evidence.forEach(e => {
		if (!stepOf.has(e.file)) { stepOf.set(e.file, { label: `Step ${k + 1}`, order: k + 1 }); }
	}));
	// Another scenario's shot of the bug, captioned with that scenario and no
	// step on this card, shows the failure again: it opens from the step that fails.
	const failing = steps.findIndex(st => st.result === 'fail' && st.finding === n);
	const failAt = failing !== -1 ? failing : steps.findIndex(st => st.result === 'fail');
	for (const e of evidence.filter(e => e.kind === 'shot' && e.scenario && !stepOf.has(e.file))) {
		const order = e.step?.order;
		if (failAt !== -1 && !(Number.isInteger(order) && order >= 1 && order <= steps.length)) {
			e.step = { label: `Step ${failAt + 1}`, order: failAt + 1 };
		}
	}
	// A shot a step cites is evidence whether or not a bullet repeats it, so
	// every check's picture reaches the gallery.
	const cited = new Set(evidence.filter(e => e.kind === 'shot').map(e => e.file));
	for (const step of steps) {
		for (const e of step.evidence.filter(e => !cited.has(e.file))) {
			cited.add(e.file);
			evidence.push({ kind: 'shot', src: e.href, file: e.file, caption: plainText(step.md) });
		}
	}
	// Screenshots in step order, so they read like the repro. Within a step,
	// the shots its own Evidence: line cites come first, in that order: the
	// step's icon opens on the one that shows its check, and any extra follows.
	// Logs and notes keep their order after them. Sort is stable.
	const order = e => (stepOf.get(e.file) ?? e.step)?.order ?? Number.MAX_SAFE_INTEGER;
	const citedAt = e => {
		const k = steps[order(e) - 1]?.evidence.findIndex(x => x.file === e.file) ?? -1;
		return k === -1 ? Number.MAX_SAFE_INTEGER : k;
	};
	const shots = evidence.filter(e => e.kind === 'shot').sort((a, b) => order(a) - order(b) || citedAt(a) - citedAt(b));
	// A shot a step names is that step's, whatever its caption says.
	return [...shots, ...evidence.filter(e => e.kind !== 'shot')].map(e => (e.kind === 'shot'
		? { ...e, step: stepOf.get(e.file) ?? e.step, caption: sentenceCase(e.caption), captionHtml: inline(sentenceCase(e.caption)) }
		: e));
}

/**
 * A finding whose report wrote no Error output takes the errors its ledger
 * checks logged, so the log a check cited reaches the card and the prompt.
 */
function fillStepErrors(findings, coverage) {
	for (const f of findings) {
		if (f.errors.length) { continue; }
		const logged = [...f.steps, ...coverage.exercised.flatMap(r => r.steps).filter(st => st.finding === f.n)]
			.map(st => st.error).filter(Boolean);
		// The finding's repro usually repeats the ledger step, Log and all.
		const seen = new Set();
		f.errors = logged.filter(e => !seen.has(`${e.source}\n${e.message}`) && seen.add(`${e.source}\n${e.message}`))
			.map(withMetaHtml);
	}
}

/**
 * The lead's emphasis is the agent's: it is the only thing in the pipeline
 * that watched the run, so it is the only thing that knows which clause is
 * the point. A `**...**` covering most of the sentence emphasises nothing,
 * so it is dropped rather than rendered.
 */
function leadHtml(result) {
	const emphasised = [...result.matchAll(/\*\*([\s\S]+?)\*\*/g)]
		.reduce((sum, m) => sum + m[1].length, 0);
	const lead = emphasised > result.replace(/\*/g, '').length * 0.8
		? result.replace(/\*\*/g, '')
		: result;
	return lead ? inline(lead) : '';
}

/**
 * The scope sentence introduces Coverage, where the scenario count is the
 * row count of the table directly below it. Repeating the number in the
 * sentence made the reader check one against the other for no reason.
 *
 * `Tested` is written as a phrase completing its label; standing on its own
 * above the table it has to read as a sentence, so it gets a capital and a
 * full stop.
 */
function scopeHtml(tested) {
	const phrase = tested.replace(/,\s*\d+\s+scenarios?\s*$/i, '').trim();
	return phrase ? inline(sentenceCase(phrase) + (/[.!?]$/.test(phrase) ? '' : '.')) : '';
}

/** Run details' sections with the ledger's Environment after Change under test, unless the report wrote its own. */
function withEnvironment(runDetails, environment) {
	const html = environment?.length ? block(environment.join('\n')) : '';
	if (!html || runDetails?.some(s => /^environment$/i.test(s.title))) {
		return runDetails;
	}
	const sections = runDetails ?? [];
	const at = sections.findIndex(s => /^change under test$/i.test(s.title)) + 1;
	sections.splice(at, 0, { title: 'Environment', html });
	return sections;
}
