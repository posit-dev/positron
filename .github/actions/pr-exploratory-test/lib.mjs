/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for run.mjs, kept separate so they can be unit tested without
// the Agent SDK or a live container.

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
	};
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
export function renderCostFooter(cost, maxTurns) {
	const dollars = typeof cost.total_cost_usd === 'number'
		? `$${cost.total_cost_usd.toFixed(2)}`
		: 'unknown cost';
	const turns = typeof cost.num_turns === 'number'
		? `${cost.num_turns}/${maxTurns} turns`
		: 'unknown turns';
	const clock = typeof cost.duration_ms === 'number'
		? `${Math.round(cost.duration_ms / 60000)}m`
		: 'unknown duration';
	return `_${dollars} | ${turns} | ${clock}_`;
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
