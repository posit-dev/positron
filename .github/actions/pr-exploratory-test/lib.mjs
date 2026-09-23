/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for run.mjs, kept separate so they can be unit tested without
// the Agent SDK or a live container.

import { parseReport } from './report-parse.mjs';

/** Pick the latest assistant message that looks like the report. */
export function pickReport(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (/\|\s*#\s*\|\s*Finding\s*\|/.test(messages[i])) {
			return messages[i];
		}
	}
	return null;
}

/**
 * Prefer the report the agent wrote to report.md; scrape chat text with
 * pickReport only when that file is missing or empty. A report that came
 * from the file is authoritative and must never be replaced by a scrape.
 */
export function resolveReport(fileReportContent, messages) {
	if (typeof fileReportContent === 'string' && fileReportContent.trim().length > 0) {
		return fileReportContent;
	}
	return pickReport(messages);
}

/** Flatten the SDK result message into the record written to cost.json. */
export function buildCostRecord(message) {
	return {
		total_cost_usd: message?.total_cost_usd ?? null,
		num_turns: message?.num_turns ?? null,
		duration_ms: message?.duration_ms ?? null,
		// input_tokens counts only the uncached input, which for a long run is a
		// small fraction of what is actually sent: a 142-turn run reported
		// 11,706. The cache reads are the context re-sent on every turn, and
		// they are what total_cost_usd is mostly paying for, so record them
		// too or the cost cannot be decomposed after the fact.
		input_tokens: message?.usage?.input_tokens ?? null,
		cache_read_input_tokens: message?.usage?.cache_read_input_tokens ?? null,
		cache_creation_input_tokens: message?.usage?.cache_creation_input_tokens ?? null,
		output_tokens: message?.usage?.output_tokens ?? null,
		// The Run tile names the model, and the alias the job asked for ("opus")
		// says nothing about which one answered.
		model: mainModel(message?.modelUsage),
	};
}

/** The model that billed most in a pass; a pass can call a small one on the side. */
function mainModel(modelUsage) {
	let best = null;
	for (const [id, usage] of Object.entries(modelUsage ?? {})) {
		const cost = typeof usage?.costUSD === 'number' ? usage.costUSD : 0;
		if (!best || cost > best.cost) {
			best = { id, cost };
		}
	}
	return best?.id ?? null;
}

/** `claude-opus-5-5` reads `Opus 5.5`. An id it does not recognise passes through. */
export function modelDisplayName(id) {
	if (!id) {
		return null;
	}
	const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id);
	if (!m) {
		return id;
	}
	return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

/**
 * Normalize the CDN base URL used to link screenshots, trimming a trailing
 * slash so `${base}/shots/<file>` never doubles up on `//`. Empty input
 * passes through unchanged (still an empty string); callers must check for
 * that themselves and omit any absolute-link instruction rather than embed
 * an empty URL.
 */
export function buildShotsBaseUrl(reportBaseUrl) {
	if (!reportBaseUrl) {
		return '';
	}
	return reportBaseUrl.endsWith('/') ? reportBaseUrl.slice(0, -1) : reportBaseUrl;
}

/**
 * Parse a positive-integer env var. Falls back to `fallback` (with a logged
 * warning) for unset, empty, NaN, non-integer, or non-positive values.
 */
export function parsePosIntEnv(name, fallback, rawValue) {
	if (rawValue === undefined || rawValue === '') { return fallback; }
	const n = Number(rawValue);
	if (!Number.isInteger(n) || n <= 0) {
		console.warn(`[exploratory] WARN: invalid ${name}=${rawValue}, falling back to default ${fallback}`);
		return fallback;
	}
	return n;
}

/** One-line footer for the step summary. */
function minutes(ms) {
	const m = Math.round(ms / 60000);
	// A pass that took forty seconds did happen; "0m" reads as though it did not.
	return m === 0 ? '<1m' : `${m}m`;
}

export function renderCostFooter(passes, maxTurns) {
	const lines = [];
	let total = null;
	let elapsed = 0;
	for (const pass of passes) {
		const c = pass?.cost;
		if (!c || typeof c.total_cost_usd !== 'number') {
			// A pass that did not run has nothing to bill and no line.
			continue;
		}
		const bits = [`$${c.total_cost_usd.toFixed(2)}`];
		const model = modelDisplayName(c.model);
		if (model) {
			bits.unshift(model);
		}
		if (typeof c.num_turns === 'number') {
			// Only the explore pass has a cap worth watching; showing one for
			// the others invites reading a limit nobody is near.
			bits.push(pass.main ? `${c.num_turns}/${maxTurns} turns` : `${c.num_turns} turns`);
		}
		if (typeof c.duration_ms === 'number') {
			bits.push(minutes(c.duration_ms));
			elapsed += c.duration_ms;
		}
		lines.push(`_${pass.label}: ${bits.join(' | ')}_`);
		total = (total === null ? 0 : total) + c.total_cost_usd;
	}
	if (lines.length === 0) {
		return '_cost unknown_';
	}
	if (lines.length > 1) {
		// The total covers every pass, in money and in time. Reporting the cost
		// of both passes beside the duration of one made the two figures on the
		// Run tile describe different runs.
		const bits = [`$${total.toFixed(2)}`];
		if (elapsed > 0) {
			bits.push(minutes(elapsed));
		}
		lines.push(`_total: ${bits.join(' | ')}_`);
	}
	return lines.join('\n');
}

/**
 * Parses the verifier's machine-readable verdict line.
 *
 * Expects `VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE` anywhere in the text.
 * Returns a Map of finding number to a short word for the table cell.
 */
export function parseVerdicts(text) {
	const out = new Map();
	if (typeof text !== 'string') {
		return out;
	}
	const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith('VERDICTS:'));
	if (!line) {
		return out;
	}
	for (const part of line.slice(line.indexOf(':') + 1).split(';')) {
		const m = part.trim().match(/^(\d+)\s*=\s*(.+)$/);
		if (!m) {
			continue;
		}
		const verdict = m[2].trim().toUpperCase();
		const word = verdict.startsWith('CONFIRMED') ? 'confirmed'
			: verdict.startsWith('FALSE') ? 'disputed'
				: verdict.startsWith('UNRESOLVED') ? 'unresolved'
					: null;
		if (word) {
			out.set(Number(m[1]), word);
		}
	}
	return out;
}

/**
 * Appends a `Verified` column to the findings table.
 *
 * Best effort by design: the table is written by an agent, and its shape has
 * drifted before. Anything unexpected returns the report untouched so a
 * cosmetic column can never cost the report its findings. The verdicts are
 * appended in full below regardless, so nothing is lost when this bails.
 */
export function annotateFindingsTable(report, verdicts) {
	if (typeof report !== 'string' || !(verdicts instanceof Map) || verdicts.size === 0) {
		return report;
	}
	const lines = report.split('\n');
	const header = lines.findIndex(l => /^\|\s*#\s*\|/.test(l));
	if (header === -1 || !/^\|[\s:|-]+\|$/.test(lines[header + 1] || '')) {
		return report;
	}
	lines[header] = `${lines[header].replace(/\s*$/, '')} Verified |`;
	lines[header + 1] = `${lines[header + 1].replace(/\s*$/, '')}---|`;
	for (let i = header + 2; i < lines.length; i++) {
		if (!lines[i].startsWith('|')) {
			break;
		}
		const n = Number((lines[i].match(/^\|\s*(\d+)\s*\|/) || [])[1]);
		lines[i] = `${lines[i].replace(/\s*$/, '')} ${verdicts.get(n) || '-'} |`;
	}
	return lines.join('\n');
}

/**
 * True when the report has a findings table with at least one numbered row.
 *
 * A run that found nothing has nothing to verify, and asking anyway produced a
 * page of prose auditing claims nobody disputed.
 */
export function hasFindings(report) {
	if (typeof report !== 'string') {
		return false;
	}
	const lines = report.split('\n');
	const header = lines.findIndex(l => /^\|\s*#\s*\|/.test(l));
	if (header === -1) {
		return false;
	}
	for (let i = header + 2; i < lines.length; i++) {
		if (!lines[i].startsWith('|')) {
			return false;
		}
		if (/^\|\s*\d+\s*\|/.test(lines[i])) {
			return true;
		}
	}
	return false;
}

/**
 * Parses the gate agent's machine-readable line.
 *
 * Expects `GATE: TESTABLE` or `GATE: NOT TESTABLE - <reason>`.
 *
 * Returns null when the line is absent or unparseable, which callers treat as
 * "explore anyway". A gate that fails closed would turn its own bugs into
 * silently skipped runs.
 */
export function parseGate(text) {
	if (typeof text !== 'string') {
		return null;
	}
	const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith('GATE:'));
	if (!line) {
		return null;
	}
	const rest = line.slice(line.indexOf(':') + 1).trim();
	if (/^NOT\s+TESTABLE/i.test(rest)) {
		const reason = rest.replace(/^NOT\s+TESTABLE\s*[-:]?\s*/i, '').trim();
		// A bail-out with no stated blocker is an excuse, not a decision.
		return reason ? { testable: false, reason } : null;
	}
	if (/^TESTABLE/i.test(rest)) {
		return { testable: true, reason: rest.replace(/^TESTABLE\s*[-:]?\s*/i, '').trim() };
	}
	return null;
}

/**
 * Renders the job's step summary.
 *
 * The whole report used to be pasted here, which made a reviewer scroll a
 * screenful of repro steps and log excerpts inside a page that cannot show a
 * screenshot properly. The report has its own rendered page now, so this is a
 * signpost: the verdict, and where to read the rest.
 *
 * `baseUrl` is the published run directory. Without one -- a local run, or an
 * upload that failed -- the links are omitted rather than written dead, and the
 * summary says where the report actually is.
 *
 * Nothing else belongs here. The links say what they are, and the cost of the
 * run is on the report's own Run tile; repeating either on the job page is a
 * second thing to read before getting to the one that matters.
 */
export function renderStepSummary(markdown, baseUrl) {
	const { findingCount, severityCounts } = parseReport(markdown);
	const breakdown = ['major', 'moderate', 'minor']
		.filter(severity => severityCounts[severity] > 0)
		.map(severity => `${severityCounts[severity]} ${severity}`);
	const tally = findingCount > 0
		? [`${findingCount} finding${findingCount === 1 ? '' : 's'}`, ...breakdown].join(' \u00b7 ')
		: 'No findings';

	const lines = [`**${tally}**`, ''];
	if (baseUrl) {
		lines.push(`\u{1F50D} [Exploratory Test Report](${baseUrl}/index.html)`);
		lines.push(`\u{1F916} [Agent Report](${baseUrl}/report.md)`);
	} else {
		lines.push('The report and its screenshots are in the workflow artifact.');
	}
	return `${lines.join('\n')}\n`;
}

/** Labels this workflow's PR comments. Each /test run owns its own comment. */
export const COMMENT_MARKER = '<!-- exploratory-test -->';

/**
 * How the explore pass ended. `partial` wins over a written report: a run cut
 * off at the turn cap covered less than it meant to, and a reviewer should
 * know that before trusting a short findings list.
 */
export function runOutcome({ report, numTurns, maxTurns }) {
	if (typeof numTurns === 'number' && numTurns >= maxTurns) {
		return 'partial';
	}
	return report ? 'complete' : 'no-report';
}

/**
 * The body of the PR comment. The same signpost as the job summary, plus the
 * head it tested: a push after `/test` makes the result stale, and the SHA is
 * how a reader tells.
 *
 * `state` is a runOutcome value, `running`, or empty when the agent never ran
 * (the build failed first). `model` is the /test argument; naming it makes a
 * typo that fell back to the default visible.
 */
export function renderPrComment({ state, markdown, baseUrl, runUrl, headSha, model }) {
	const target = headSha ? `\`${headSha.slice(0, 7)}\`` : 'the PR head';
	const title = model ? `Exploratory test (${model})` : 'Exploratory test';
	const run = `[Run](${runUrl})`;
	if (state === 'running') {
		return `${COMMENT_MARKER}\n### Exploratory test\n\nRunning${model ? ` with ${model}` : ''} against ${target}. ${run}\n`;
	}
	if (markdown && (state === 'complete' || state === 'partial')) {
		const note = state === 'partial'
			? '\n_Partial run: the agent hit the turn cap, so coverage is incomplete._\n'
			: '';
		return `${COMMENT_MARKER}\n### ${title} on ${target}\n\n${renderStepSummary(markdown, baseUrl)}${note}\n${run}\n`;
	}
	const reason = state === 'partial' ? 'The agent hit the turn cap before writing a report.'
		: state === 'no-report' ? 'The agent finished without writing a report.'
			: 'The run failed before the agent produced a report.';
	return `${COMMENT_MARKER}\n### ${title} on ${target}: no report\n\n${reason} ${run}\n`;
}

