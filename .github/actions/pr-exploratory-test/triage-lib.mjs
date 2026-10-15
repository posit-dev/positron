/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The pure half of triage.mjs: one row per ai-discovered issue, from the issue,
// its report and the run's stats.

const SEVERITIES = ['major', 'moderate', 'minor'];

/** The report and finding an issue's provenance line links to, or null when it has none. */
export function reportLink(body) {
	const m = String(body ?? '').match(/Reported by \[exploratory test\]\((https:\/\/[^)\s]+?)\/index\.html#f(\d+)\)/);
	return m ? { base: m[1], finding: Number(m[2]) } : null;
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

/** One row for the page. `report` is the run's report (or null), `stats` its stats.json (or null), `events` the issue's events. */
export function issueRow(issue, link, { report, stats, events } = {}) {
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
	};
}
