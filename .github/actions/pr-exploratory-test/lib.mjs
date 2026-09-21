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
		input_tokens: message?.usage?.input_tokens ?? null,
		output_tokens: message?.usage?.output_tokens ?? null,
	};
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
