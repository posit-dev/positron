/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Builds the page's report model from report.json, the writer's structured
// report, instead of parsing report.md. The model is parseReport's, so
// html.mjs renders either. Prose fields are markdown; everything else is data.

import {
	arrangeEvidence, basename, block, fillStepErrors, inline, isDefaultsOnly, leadHtml, parseLedger,
	parseLogField, plainText, safeUrl, scenarioCounts, scopeHtml, sentenceCase, stepText, verifyText,
	withEnvironment, withMetaHtml,
} from './report-parse.mjs';

const TEST_LEVEL = { unit: 'Unit', extension: 'Extension', e2e: 'E2E' };

/** A schema step as a typed step, the shape parseReport's steps have. */
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

/** A schema evidence item as parseReport's. */
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

/** A schema error as parseReport's. */
function errorFromJson(e) {
	const count = e.count ?? 1;
	const meta = [e.process, count > 1 ? `${count}x` : ''].filter(Boolean);
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
		const note = c.isNew ? 'new file' : '';
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
 * The report model from report.json and the run's ledger.
 * `pipeline` holds what later passes add (`verification`, `cost`), until
 * they write it into report.json themselves.
 */
export function reportFromJson(json, { ledger, pipeline = {} } = {}) {
	const header = json.header ?? {};
	const findings = (json.findings ?? []).map(findingFromJson);
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
		verification: pipeline.verification ?? null,
		cost: pipeline.cost ?? { passes: [], total: null, duration: null },
	};
}
