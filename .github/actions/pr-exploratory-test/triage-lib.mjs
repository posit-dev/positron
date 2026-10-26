/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The pure half of triage.mjs: one row per issue from a report finding, from the
// issue, its report and the run's stats.

const SEVERITIES = ['major', 'moderate', 'minor'];

/** The report and finding an issue's provenance line links to, or null when it has none. */
export function reportLink(body) {
	const m = String(body ?? '').match(/Reported by \[exploratory test\]\((https:\/\/[^)\s]+?)\/index\.html#f(\d+)\)/);
	return m ? { base: m[1], finding: Number(m[2]) } : null;
}

/**
 * Issues the outcomes job matched to a finding that also mention its PR, as `{ number, link }`, leaving out those
 * already linked from their body. The model match alone isn't enough: someone could find the same bug on their own.
 */
export function matchedLinks(outcomeRows, linked) {
	const byIssue = new Map();
	for (const r of outcomeRows) {
		const number = Number(r.issue?.number);
		if (r.issue?.mentionsPr === true && !r.dupOf && number && !linked.has(number) && !byIssue.has(number)) {
			byIssue.set(number, { base: String(r.reportUrl).replace(/\/index\.html$/, ''), finding: Number(r.finding) });
		}
	}
	return [...byIssue].map(([number, link]) => ({ number, link }));
}

/** Where the issue stands, in this order: closed as completed, closed another way, no milestone, Future, any other milestone. */
export function outcomeOf({ state, state_reason, milestone }) {
	if (state === 'closed') {
		return state_reason === 'completed' ? 'completed' : 'closed';
	}
	return !milestone ? 'awaiting' : milestone.title === 'Future' ? 'future' : 'active';
}

/** Feature names from `area: ...` labels. */
export function areasOf(labels = []) {
	return labels.map(l => typeof l === 'string' ? l : l.name).filter(n => n?.startsWith('area: ')).map(n => n.slice(6)).sort();
}

/** When the issue last entered milestone `title`, from its events; null when the events don't say. */
export function milestonedAt(events = [], title) {
	return events.filter(e => e.event === 'milestoned' && e.milestone?.title === title).map(e => e.created_at).sort().at(-1) ?? null;
}

/**
 * One row for the page. `report` is the run's report (or null), `stats` its stats.json (or null), `events` the issue's
 * events, `via` 'linked' for a body link to the finding or 'matched' for one the outcomes job matched.
 */
export function issueRow(issue, link, { report, stats, events, via = 'linked' } = {}) {
	const out = outcomeOf(issue);
	const finding = report?.findings?.find(f => Number(f.n) === link.finding);
	return {
		num: issue.number,
		title: issue.title,
		filed: issue.created_at.slice(0, 10),
		closed: issue.closed_at?.slice(0, 10) ?? null,
		reportUrl: `${link.base}/index.html`,
		findingUrl: `${link.base}/index.html#f${link.finding}`,
		sev: SEVERITIES.includes(finding?.severity) ? finding.severity : null,
		out,
		milestone: issue.milestone?.title ?? null,
		futureSince: out === 'future' ? milestonedAt(events, 'Future')?.slice(0, 10) ?? null : null,
		type: issue.type?.name ?? null,
		areas: areasOf(issue.labels),
		source: link.base.includes('-local-') ? 'local' : 'pr',
		skillVersion: stats?.version ?? null,
		via,
	};
}
