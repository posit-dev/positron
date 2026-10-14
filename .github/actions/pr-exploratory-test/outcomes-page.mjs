/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One HTML page from the rows outcomes.mjs writes: how many findings developers
// fixed, by outcome, severity and PR, then the evidence for each.
//   node outcomes-page.mjs rows.jsonl > outcomes.html

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO_URL, SEVERITY_LABEL } from '../../../.claude/skills/exploratory-test/renderer/page/page-common.mjs';
import { escapeHtml, safeUrl } from '../../../.claude/skills/exploratory-test/renderer/shared/text.mjs';

// In this order everywhere. `group` is the evidence filter: fixed, filed, not fixed, or not counted yet;
// `short` names it in severity rows.
const OUTCOMES = [
	{ key: 'fixed-in-pr', label: 'Fixed in the PR', group: 'fixed', def: 'A commit pushed to the PR after the run fixed it.' },
	{ key: 'fixed-later', label: 'Fixed later', group: 'fixed', def: 'Fixed on main after the merge, or its issue was closed as completed.' },
	{ key: 'filed-issue', label: 'Filed as issue', short: 'filed as issue', group: 'filed', def: 'An issue matching the finding was opened after the run, and nothing has fixed it yet.' },
	{ key: 'not-fixed', label: 'Not fixed', group: 'not', def: 'The PR merged or closed with no fix. Moves to Filed as issue or Fixed later if that happens afterwards.' },
	{ key: 'pending', label: 'PR still open', short: 'still open', group: 'open', def: 'The PR hasn\'t merged yet. These count once it merges or closes.' },
	{ key: 'unclear', label: 'Unclear', short: 'unclear', group: 'open', def: 'A check failed or the model couldn\'t say.' },
	{ key: 'no-paths', label: 'No files named', short: 'no files named', group: 'open', def: 'The finding names no file, so main couldn\'t be checked.' },
];
const FILTERS = [['fixed', 'Fixed'], ['filed', 'Filed as issue'], ['not', 'Not fixed'], ['open', 'Not counted']];
const DECIDED_BY = {
	'diff+model': 'The diff, read by the model',
	'issue+model': 'A matching issue, confirmed by the model',
	'issue-closed': 'Its issue was closed as completed',
	'pr-open': 'PR is still open',
	'merged-no-fix': 'Merged with no fix found',
	'closed-unmerged': 'PR closed without merging',
	'sha': 'A specific commit',
};
const PRESETS = [['7d', 'Last 7 days', 7], ['30d', 'Last 30 days', 30], ['90d', 'Last 90 days', 90], ['all', 'All time']];
const TRIGGER = { auto: 'started automatically', explore: 'started by /explore' };
const HERO_COLOR = { 'fixed-in-pr': '#3B7D4F', 'not-fixed': '#7D7568' };
const INK = '#2B2A27';
// Each severity needs about this many counted findings before their rates are worth comparing.
const ENOUGH = 10;
const SEP = ' &middot; ';
// The PR card's state pill, and what goes before its date.
const PR_STATE = { merged: ['Merged', ''], open: ['Open', 'opened '], closed: ['Closed without merging', ''] };

const pct = (a, b) => `${Math.round(a / b * 100)}%`;
const codeSpans = text => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const day = (iso, year) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const time = (iso, year) => `<time datetime="${iso}">${day(iso, year)}</time>`;

/** Counts for `rows`; rows marked `dupOf` are dropped first. */
export function summarize(rows) {
	const own = rows.filter(r => !r.dupOf);
	const counts = Object.fromEntries(OUTCOMES.map(o => [o.key, own.filter(r => r.outcome === o.key).length]));
	const fixed = counts['fixed-in-pr'] + counts['fixed-later'];
	const counted = fixed + counts['filed-issue'] + counts['not-fixed'];
	return { total: own.length, counts, fixed, counted, notCounted: own.length - counted };
}

/** Evidence split into its source (commits on the PR or main, or an issue) and the model's reason. */
export function splitEvidence(evidence) {
	const text = String(evidence ?? '');
	const m = text.match(/^(pr|main|issue)\b([^:]*): /);
	if (!m) {
		return { where: null, commits: [], issue: null, text };
	}
	const issue = m[1] === 'issue' ? Number(m[2].match(/#(\d+)/)?.[1]) || null : null;
	return { where: m[1], commits: m[1] === 'issue' ? [] : m[2].match(/\b[0-9a-f]{7,40}\b/g) ?? [], issue, text: text.slice(m[0].length) };
}

/** Stacked segments for `rows`, leaving out outcomes with none; the big bar's link to the evidence. */
function segments(rows, { big = false } = {}) {
	const s = summarize(rows);
	return OUTCOMES.filter(o => s.counts[o.key]).map(o => {
		const n = s.counts[o.key];
		const share = n / s.total;
		return big
			? `<a class="seg o-${o.key}" href="#evidence" data-filter="${o.group}" data-key="${o.key}" aria-label="${n} ${o.label}, show these findings">${n}${share >= 0.2 ? `<span>${o.label}</span>` : ''}</a>`
			: `<span class="seg o-${o.key}" style="width:${+(share * 100).toFixed(2)}%">${n}</span>`;
	}).join('');
}

function triggers(rows) {
	const counts = {};
	for (const r of rows) {
		const t = TRIGGER[r.trigger] ?? 'trigger unknown';
		counts[t] = (counts[t] ?? 0) + 1;
	}
	return Object.keys(counts).length > 1 ? Object.entries(counts).map(([t, n]) => `${SEP}<span>${n} ${t}</span>`).join('') : '';
}

function minusDays(iso, n) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

function isDay(v) {
	const t = Date.parse(`${v}T00:00:00Z`);
	return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(t) && new Date(t).toISOString().startsWith(v);
}

/** The window for `?range=` (7d, 30d, 90d, all, or from..to), given the run dates and the generated date; 30 days if invalid. */
export function resolveRange(param, dates, today) {
	if (param === 'all') {
		const sorted = [...dates].sort();
		return { key: 'all', from: sorted[0] ?? today, to: sorted.at(-1) ?? today };
	}
	const preset = PRESETS.find(([k]) => k === param);
	if (preset) {
		return { key: param, from: minusDays(today, preset[2] - 1), to: today };
	}
	const [, a, b] = String(param ?? '').match(/^(.+)\.\.(.+)$/) ?? [];
	if (isDay(a) && isDay(b)) {
		return { key: 'custom', from: a < b ? a : b, to: a < b ? b : a };
	}
	return resolveRange('30d', dates, today);
}

function rangeText({ from, to }, plain) {
	const [f, t] = plain ? [day, day] : [time, time];
	return from === to ? t(to, true) : `${f(from, from.slice(0, 4) !== to.slice(0, 4))} &ndash; ${t(to, true)}`;
}

function header(rows, s) {
	const inPr = s.counts['fixed-in-pr'];
	const of = inPr === s.counted ? `<span class="green">all ${inPr}</span>` : `<span class="green">${inPr}</span> of ${s.counted}`;
	const headline = s.counted ? `Developers fixed ${of} ${s.counted === 1 ? 'finding' : 'findings'} before merging.` : 'No PRs with findings have merged yet.';
	const prs = new Set(rows.map(r => r.pr)).size;
	const changed = new Set(rows.filter(r => r.outcome === 'fixed-in-pr' || r.outcome === 'fixed-later').map(r => r.pr)).size;
	const unchecked = s.counts.unclear + s.counts['no-paths'];
	const card = (label, num, side, note) => `<div class="card"><div class="label">${label}</div>`
		+ `<div class="card-num">${num}<span class="side">${side}</span></div><div class="note">${note}</div></div>`;
	if (!s.total) {
		return '<div class="lede"><h1>Does /explore change what ships?</h1><p class="headline">No /explore findings in this date range.</p></div>';
	}
	return `<div class="lede"><h1>Does /explore change what ships?</h1><p class="headline">${headline}</p></div>
<div class="cards">
${card('Issues fixed', `<span class="big green">${s.fixed}</span>`, `${inPr} in the PR${SEP}${s.fixed - inPr} later`, 'Problems developers fixed after /explore flagged them.')}
${card('PRs changed', `<span class="big">${changed}</span>`, `of ${plural(prs, 'PR')}`, 'PRs where at least one /explore finding got fixed.')}
${card('Still open', `<span class="big">${s.counts.pending}</span>`, s.counts.pending === 1 ? 'finding' : 'findings', 'Findings on PRs that haven\'t merged yet. They count once the PR merges or closes.'
		+ (unchecked ? ` ${unchecked} more can't be checked (unclear or no files named).` : ''))}
</div>`;
}

function allBar(s, own) {
	// Brackets and segments share the grid's columns, one per segment, so the brackets line up with the bar.
	const present = OUTCOMES.filter(o => s.counts[o.key]);
	const columns = present.map(o => `minmax(0, ${s.counts[o.key]}fr)`).join(' ');
	const k = present.filter(o => o.group !== 'open').length;
	const brackets = [
		k ? `<div class="bracket counted" style="grid-column:1 / span ${k}"><b>Counted</b><span>${SEP}${s.counted}</span></div>` : '',
		k < present.length ? `<div class="bracket not-counted" style="grid-column:${k + 1} / span ${present.length - k}"><b>Not counted yet</b><span>${SEP}${s.notCounted}</span></div>` : '',
	].join('');
	const legend = present.map(o => `<span><i class="o-${o.key}"></i>${o.label}</span>`).join('');
	// A share of counted findings, or a bare count for the rest so denominators don't mix.
	const details = present.map(o => {
		const n = s.counts[o.key];
		const counted = o.group !== 'open';
		const [hero, of] = counted ? [pct(n, s.counted), `${n} of ${s.counted} counted findings`] : [n, `${n === 1 ? 'finding' : 'findings'}, not counted yet`];
		return `<div class="seg-detail" data-for="${o.key}" hidden><span class="hero" style="color:${HERO_COLOR[o.key] ?? INK}">${hero}</span>`
			+ `<div><div class="what"><b>${o.label}</b><span>${SEP}${of}</span></div><div class="def">${escapeHtml(o.def)}</div></div></div>`;
	}).join('');
	return `<section aria-labelledby="all-h">
<h2 id="all-h">Findings by outcome</h2>
<div class="all" style="grid-template-columns:${columns}">
<div class="brackets">${brackets}</div>
<div class="bar big">${segments(own, { big: true })}</div>
<div class="under" aria-live="polite"><div class="legend">${legend}</div>${details}</div>
</div>
</section>`;
}

function severityRows(own) {
	const per = Object.keys(SEVERITY_LABEL).map(key => {
		const list = own.filter(r => r.severity === key);
		return { label: SEVERITY_LABEL[key], list, s: summarize(list) };
	});
	const few = per.some(p => p.s.counted < ENOUGH) ? ' Too few so far to compare severities.' : '';
	const rows = per.map(({ label, list, s }) => {
		const rate = s.counted ? `<div class="pct green">${pct(s.fixed, s.counted)}</div>` : '<div class="pct none" aria-label="No data">&ndash;</div>';
		if (!s.total) {
			return `<div class="grid-row sev-row"><div class="name">${label}</div>${rate}<div class="grow empty">No ${label} findings in this period</div></div>`;
		}
		if (!s.counted) {
			return `<div class="grid-row sev-row"><div class="name">${label}</div>${rate}<div class="grow empty">${plural(s.total, 'finding')}, none counted yet</div></div>`;
		}
		// Counted findings only, so the green share matches % fixed.
		const segs = OUTCOMES.filter(o => o.group !== 'open' && s.counts[o.key])
			.map(o => `<span class="seg o-${o.key}" style="flex:${s.counts[o.key]} 1 0" title="${s.counts[o.key]} ${o.label}">${s.counts[o.key]}</span>`).join('');
		const uncounted = s.notCounted ? `<span class="uncounted">+${s.notCounted} not counted yet</span>` : '';
		return `<div class="grid-row sev-row"><div class="name">${label}</div>${rate}<div class="grow out"><div class="bar mid">${segs}</div>${uncounted}</div></div>`;
	}).join('\n');
	return `<section aria-labelledby="sev-h">
<div class="sec-head"><h2 id="sev-h">Fix rate by severity</h2><p class="sub">% fixed = findings fixed (in the PR or later) &divide; findings on merged or closed PRs.${few}</p></div>
<div class="rows sev-rows">
<div class="grid-row cols" aria-hidden="true"><span class="name">Severity</span><span class="pct">% fixed</span><span class="grow">Outcomes</span></div>
${rows}
</div>
</section>`;
}

/** A section that starts collapsed behind a full-width button in its heading. */
function accordion(id, title, count, body, attrs = '') {
	return `<section aria-labelledby="${id}-h"${attrs}>
<h2 id="${id}-h"><button type="button" class="acc" aria-expanded="false" aria-controls="${id}-body"><span>${title}<span class="count">${count}</span></span>`
		+ '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#5A5751" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5l5 5 5-5"/></svg></button></h2>'
		+ `\n<div class="acc-body" id="${id}-body" hidden>\n${body}\n</div>\n</section>`;
}

function prRows(own) {
	const byPr = new Map();
	for (const r of own) {
		byPr.set(r.pr, [...(byPr.get(r.pr) ?? []), r]);
	}
	const rows = [...byPr].sort(([a, x], [b, y]) => y.length - x.length || b - a).map(([pr, list]) => {
		const s = summarize(list);
		const parts = [[s.fixed, 'fixed'], [s.counts['filed-issue'], 'filed as issue'], [s.counts['not-fixed'], 'not fixed'], [s.notCounted, 'open']].filter(([n]) => n).map(([n, what]) => `${n} ${what}`);
		return `<div class="grid-row pr"><a class="name mono" href="${REPO_URL}/pull/${Number(pr)}" data-pr="${Number(pr)}">#${Number(pr)}</a><span class="pct small">${plural(list.length, 'finding')}</span>`
			+ `<div class="grow bar mid">${segments(list)}</div><span class="end small">${parts.join(SEP)}</span></div>`;
	}).join('\n');
	return accordion('pr', 'By PR', plural(byPr.size, 'PR'), `<div class="rows">${rows}</div>`);
}

function findingRow(r, n) {
	const ev = splitEvidence(r.evidence);
	const report = safeUrl(r.reportUrl);
	const pr = Number(r.pr);
	const issueUrl = safeUrl(r.issue?.url);
	const issue = r.issue && issueUrl ? `<a class="chip" href="${escapeHtml(issueUrl)}">#${Number(r.issue.number)}${SEP}${escapeHtml(r.issue.state)}</a>`
		: ev.issue ? `<a class="chip" href="${REPO_URL}/issues/${ev.issue}">#${ev.issue}</a>` : '';
	const dl = [
		['Decided by', DECIDED_BY[r.decidedBy] ? escapeHtml(DECIDED_BY[r.decidedBy]) : '&mdash;'],
		ev.commits.length ? [ev.where === 'main' ? 'Commits on main' : 'Commits on the PR', ev.commits.map(c => `<a class="chip" href="${REPO_URL}/commit/${c}">${c}</a>`).join(' ')] : null,
		issue ? ['Issue', issue] : null,
		r.paths?.length ? ['Files', r.paths.map(p => `<code class="chip">${escapeHtml(p)}</code>`).join(' ')] : null,
		['Run', `<span class="mono">${escapeHtml(r.run)}#${escapeHtml(r.finding)}</span>${SEP}${TRIGGER[r.trigger] ?? 'trigger unknown'}${SEP}skill ${escapeHtml(r.skillVersion ?? '?')}${SEP}${escapeHtml(r.model ?? '?')}`],
	].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
	const links = [report ? `<a href="${escapeHtml(report)}">Open report</a>` : '', `<a href="${REPO_URL}/pull/${pr}" data-pr="${pr}">Open PR</a>`].join('');
	return `<div class="finding"><button type="button" class="row" aria-expanded="false" aria-controls="d${n}">`
		+ `<span class="num">${n}</span><span class="title"><span>${codeSpans(r.title)}</span>${r.dupMaybe ? '<span class="maybe">Possible duplicate</span>' : ''}</span>`
		+ `<span class="mono link" data-pr="${pr}">#${pr}</span><span class="sev">${escapeHtml(SEVERITY_LABEL[r.severity] ?? r.severity ?? '')}</span><span class="sign" aria-hidden="true">+</span></button>`
		+ `<div class="detail" id="d${n}" hidden>${ev.text ? `<p class="ev">${codeSpans(ev.text)}</p>` : ''}<dl>${dl}</dl><div class="links">${links}</div></div></div>`;
}

function evidence(own, s) {
	let n = 0;
	const groups = OUTCOMES.map(o => {
		const items = own.filter(r => r.outcome === o.key);
		return items.length
			? `<div class="group" data-group="${o.group}"><div class="group-head"><h3><i class="o-${o.key}"></i>${o.label} <span class="n">${items.length}</span></h3><span class="small">${escapeHtml(o.def)}</span></div>`
			+ `<div class="rows">${items.map(r => findingRow(r, ++n)).join('\n')}</div></div>`
			: '';
	}).join('\n');
	const counts = { fixed: s.fixed, filed: s.counts['filed-issue'], not: s.counts['not-fixed'], open: s.notCounted };
	const filters = [`<button type="button" class="filter" data-filter="all" aria-pressed="true">All ${s.total}</button>`,
		...FILTERS.filter(([k]) => counts[k]).map(([k, label]) => `<button type="button" class="filter" data-filter="${k}" aria-pressed="false">${label} ${counts[k]}</button>`)].join('');
	const controls = `<div class="controls"><div role="group" aria-label="Filter by outcome">${filters}</div><button type="button" class="toggle-all">Expand all</button></div>`;
	return accordion('ev', 'Evidence', plural(s.total, 'finding'), `${controls}\n${groups}`, ' id="evidence"');
}

/** The card shown over a PR link: the PR as it was when the page was built. */
export function prCard(n, p) {
	const [label, lead] = PR_STATE[p.state] ?? PR_STATE.closed;
	const dot = '<span class="pc-dot" aria-hidden="true">&middot;</span>';
	return `<div class="pc-state"><span class="pill ${PR_STATE[p.state] ? p.state : 'closed'}"><i></i>${label}</span>${p.date ? lead + day(p.date, true) : ''}</div>`
		+ `<div class="pc-title"><span class="mono">#${Number(n)}</span> ${escapeHtml(p.title ?? '')}</div>`
		+ `<div class="pc-meta"><span>@${escapeHtml(p.author ?? '')}</span>${dot}<span class="mono"><span class="add">+${Number(p.additions)}</span> <span class="del">&minus;${Number(p.deletions)}</span></span>${dot}<span>${plural(Number(p.files), 'file')}</span></div>`
		+ (p.desc ? `<p>${escapeHtml(p.desc)}</p>` : '');
}

function footer(s) {
	return `<footer><span>Generated ${time(s.now, true)}</span></footer>`;
}

/** The parts of the page that change with the date range: the button's dates, mixed triggers, the lede and cards, and the sections. */
export function renderView(rows, { now, range }) {
	const inRange = range.key === 'all' ? rows : rows.filter(r => {
		const d = r.postedAt?.slice(0, 10);
		return d && d >= range.from && d <= range.to;
	});
	const own = inRange.filter(r => !r.dupOf);
	const s = { ...summarize(inRange), now };
	const body = s.total ? [allBar(s, own), severityRows(own), `<div class="accordion">\n${prRows(own)}\n${evidence(own, s)}\n</div>`] : [];
	return { label: rangeText(range), triggers: triggers(own), head: header(own, s), body: [...body, footer(s)].join('\n') };
}

const runDates = rows => rows.map(r => r.postedAt?.slice(0, 10)).filter(Boolean).sort();

// The browser's copy of the view, so it renders the same markup as the server.
const VIEW_FNS = { escapeHtml, safeUrl, pct, codeSpans, plural, day, time, summarize, splitEvidence, segments, triggers, minusDays, isDay, resolveRange, rangeText, header, allBar, severityRows, accordion, prRows, findingRow, evidence, footer, renderView, prCard };
export const VIEW_SOURCE = [
	...Object.entries({ SEVERITY_LABEL, REPO_URL, OUTCOMES, FILTERS, DECIDED_BY, PRESETS, TRIGGER, HERO_COLOR, INK, ENOUGH, SEP, PR_STATE }).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`),
	...Object.entries(VIEW_FNS).map(([k, f]) => `const ${k} = ${f};`),
].join('\n');

const CHECK = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#3B7D4F" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5l2.5 2.5L11 4.5"/></svg>';

function picker(range, dates, now) {
	const item = (key, label) => `<button type="button" role="menuitemradio" data-range="${key}" aria-checked="${range.key === key}" tabindex="-1"><span>${label}</span>${CHECK}</button>`;
	return `<span class="range"><button type="button" class="range-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Date range: ${rangeText(range, true)}" disabled>`
		+ `<span class="range-label">${rangeText(range)}</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#3A3833" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5L7 9l3.5-3.5"/></svg></button>`
		+ '<div class="range-menu" role="menu" aria-label="Date range" hidden>'
		+ PRESETS.map(([key, label]) => item(key, label)).join('')
		+ `<div class="sep" role="separator"></div>${item('custom', 'Custom range&hellip;')}`
		+ `<div class="custom" hidden><label for="range-from">From</label><input id="range-from" type="date" min="${dates[0] ?? now}" max="${now}">`
		+ `<label for="range-to">To</label><input id="range-to" type="date" min="${dates[0] ?? now}" max="${now}"></div></div></span>`;
}

const CSS = `
body{margin:0;background:#F5F4F0;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#2B2A27}
a{color:#2F6B55}a:not(.seg):hover{color:#1F4D3D}
main{padding:56px 24px 96px}
.page{width:100%;max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:64px}
.mono,.n,code,.chip,.seg,.num,.sign{font-family:'IBM Plex Mono',monospace}
h1,h2{font-family:'Source Serif 4',Georgia,serif;margin:0}
h1{font-size:46px;line-height:1.1;font-weight:500;letter-spacing:-0.01em}
h2{font-size:24px;line-height:1.3;font-weight:600}
.green{color:#3B7D4F;font-weight:600}
.small{font-size:13px;color:#5A5751}
.label,.bracket b,.cols{font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase}
header{display:flex;flex-direction:column}
.eyebrow{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:#6B6862;margin-bottom:16px}
.triggers,.head,.view{display:contents}
.range{position:relative}
.range-btn{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 6px;margin-left:-6px;border:0;border-radius:6px;background:transparent;color:#3A3833;font:13px 'IBM Plex Sans',sans-serif;cursor:pointer;text-decoration:underline dotted #B5B1A7;text-underline-offset:3px}
.range-btn:disabled{cursor:default;text-decoration:none}.range-btn:disabled svg{display:none}
.range-btn svg{transition:transform .15s}.range-btn[aria-expanded=true]{background:#ECE9E2}.range-btn[aria-expanded=true] svg{transform:rotate(180deg)}
.range-menu{position:absolute;top:38px;left:-6px;z-index:20;width:248px;box-sizing:border-box;padding:6px;background:#FBFAF7;border:1px solid #E4E1D9;border-radius:10px;box-shadow:0 8px 24px rgba(43,42,39,.12);display:flex;flex-direction:column}
.range-menu[hidden],.custom[hidden]{display:none}
[role=menuitemradio]{display:flex;align-items:center;justify-content:space-between;min-height:36px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#2B2A27;font:14px 'IBM Plex Sans',sans-serif;text-align:left;cursor:pointer}
[role=menuitemradio][aria-checked=true]{background:#ECE9E2}[role=menuitemradio] svg{visibility:hidden}[role=menuitemradio][aria-checked=true] svg{visibility:visible}
.range-menu .sep{height:1px;background:#E4E1D9;margin:4px 0}
.custom{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px 8px;padding:8px 10px 6px;font-size:13px;color:#5A5751}
.custom input{min-height:32px;padding:0 8px;border:1px solid #D6D2C8;border-radius:6px;background:#F5F4F0;color:#2B2A27;font:13px 'IBM Plex Sans',sans-serif}
.chip-cmd{font-family:'IBM Plex Mono',monospace;font-weight:500;color:#2B2A27;background:#ECE9E2;padding:4px 8px;border-radius:4px}
.lede{display:flex;flex-direction:column;gap:8px;max-width:760px;margin-bottom:40px}
.headline{margin:0;font-size:22px;line-height:1.4;font-weight:500}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}
.card{padding:20px 24px;background:#FBFAF7;border:1px solid #E4E1D9;border-radius:10px;display:flex;flex-direction:column;gap:8px}
.label{color:#5A5751}
.card-num{display:flex;align-items:baseline;gap:10px}
.card-num .big{font-size:40px;font-weight:600;line-height:1}
.side,.note{font-size:14px;line-height:1.45;color:#5A5751}
section{display:flex;flex-direction:column;gap:16px}
.sec-head{display:flex;flex-direction:column;gap:4px}
.sub{margin:0;font-size:14px;color:#6B6862}
.all{display:grid;column-gap:3px;row-gap:8px}
.brackets,.bar.big{grid-column:1 / -1;display:grid;grid-template-columns:subgrid}
.under{grid-column:1 / -1}
.bracket{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;min-width:0;white-space:nowrap}
.bracket.not-counted{justify-content:flex-end}
.bracket span{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5A5751}
.bracket.counted{border-bottom:2px solid #2B2A27}
.bracket.not-counted{border-bottom:2px solid #B5B1A7}.bracket.not-counted b{color:#5A5751}
.bar{display:flex;min-width:0}
.bar.big{height:56px}
.bar.mid{height:24px;gap:2px}
.seg{box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;border-radius:3px;font-size:12px}
.bar.big .seg{border-radius:0;gap:10px;padding:0;font-size:18px;font-weight:500;text-decoration:none;transition:opacity .15s}
.bar.big .seg:has(span){justify-content:flex-start;padding:0 12px}
.bar.big .seg:first-child{border-top-left-radius:6px;border-bottom-left-radius:6px}.bar.big .seg:last-child{border-top-right-radius:6px;border-bottom-right-radius:6px}
.bar.big .seg span{font-family:'IBM Plex Sans',sans-serif;font-size:14px}
.bar.big .seg:focus-visible{outline:2px solid #2B2A27;outline-offset:2px}
.bar.big:has(.seg:hover,.seg:focus-visible) .seg:not(:hover,:focus-visible){opacity:.35}
.o-fixed-in-pr{background:#3B7D4F;color:#FFF}
.o-fixed-later{background:#9CC7A6;color:#1F3D28}
.o-filed-issue{background:#B3A894;color:#2B2A27}
.o-not-fixed{background:#7D7568;color:#FFF}
.o-pending{background:#DCD8CE;color:#5A5751}
.o-unclear{background:repeating-linear-gradient(135deg,#E6E2D9 0 5px,#D3CEC2 5px 10px);color:#3A3833}
.o-no-paths{background:#EEEBE4;color:#5A5751;border:1.5px dashed #B5B1A7}
.under{position:relative;min-height:20px;margin-top:4px}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px;color:#5A5751}
.legend>span{display:flex;align-items:center;gap:6px}
i[class^=o-]{display:inline-block;width:12px;height:12px;border-radius:2px;box-sizing:border-box}
.n{color:#7A766F;font-weight:400}
.legend[hidden],.seg-detail[hidden],.group[hidden],.acc-body[hidden],.detail[hidden]{display:none}
.seg-detail{position:absolute;top:0;left:0;right:0;z-index:1;min-height:48px;background:#F5F4F0;display:flex;align-items:center;gap:20px;min-width:0}
.hero{flex:0 0 auto;font-family:'Source Serif 4',Georgia,serif;font-size:44px;font-weight:600;line-height:1}
.seg-detail>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.what{font-size:15px}.what span{color:#6B6862}
.def{font-size:14px;color:#3A3833}
.rows{display:flex;flex-direction:column;border-top:1px solid #2B2A27}
.grid-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;padding:12px 0;box-sizing:border-box;border-bottom:1px solid #E4E1D9}
.grid-row .name{flex:0 0 120px}.grid-row .pct{flex:0 0 160px}.grid-row .grow{flex:1 1 280px;min-width:0}
.grid-row .end{flex:0 0 240px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}
.cols{padding:0 0 8px;color:#6B6862;border-bottom:1px solid #2B2A27}
.sev-rows{border-top:0}
.sev-row{min-height:64px}.sev-row .seg{min-width:0}
.out{display:flex;align-items:center;gap:12px}.out .bar{flex:1 1 auto}
.uncounted{flex:0 0 auto;font-size:12px;color:#7A766F;white-space:nowrap}.sev-row .name{font-size:16px;font-weight:600}
.sev-row .pct{font-size:28px;line-height:1}.sev-row .pct.none{font-size:18px;font-weight:400;color:#B5B1A7}
.empty{font-size:13px;color:#7A766F}
.pr{min-height:56px}.pr .name{font-size:14px;font-weight:500}
.accordion{display:flex;flex-direction:column;border-top:1px solid #E4E1D9}
.accordion section{gap:0;border-bottom:1px solid #E4E1D9}
.acc{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}
.acc>span{display:flex;align-items:baseline;gap:12px}
.count{font-family:'IBM Plex Sans',sans-serif;font-size:14px;font-weight:400;color:#6B6862}
.acc svg{flex:0 0 auto;transition:transform .15s}
.acc[aria-expanded=true] svg{transform:rotate(180deg)}
.acc-body{margin-bottom:24px}
#ev-body:not([hidden]){display:flex;flex-direction:column;gap:32px}
.controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}
.controls [role=group]{display:flex;flex-wrap:wrap;gap:6px}
.filter{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid #D6D2C8;background:#FBFAF7;color:#3A3833;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer}
.filter[aria-pressed=true]{border-color:#2B2A27;background:#2B2A27;color:#FFF}
.toggle-all{min-height:36px;padding:0;border:0;background:transparent;color:#2F6B55;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer;text-decoration:underline}
.group{display:flex;flex-direction:column}
.group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding-bottom:12px}
h3{margin:0;display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600}
.finding{border-bottom:1px solid #E4E1D9}
.row{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:12px 0;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit;min-height:52px}
.num{flex:0 0 28px;font-size:14px;color:#6B6862}
.title{flex:1 1 380px;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:16px;line-height:1.4;font-weight:500}
.maybe{font-size:12px;font-weight:400;color:#7A3E00;background:#FDF0E1;padding:2px 8px;border-radius:999px}
.link{flex:0 0 72px;font-size:13px;color:#2F6B55}
.sev{flex:0 0 80px;font-size:13px;color:#5A5751}
.sign{flex:0 0 20px;text-align:center;font-size:16px;color:#5A5751}
.detail{padding:0 0 24px 44px;display:flex;flex-direction:column;gap:12px}
.ev{margin:0;font-size:15px;line-height:1.6;color:#3A3833;max-width:820px}
code{font-size:13px;background:#ECE9E2;padding:1px 5px;border-radius:3px}
dl{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;font-size:13px;color:#5A5751;max-width:820px}
dt{color:#7A766F}dd{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.chip{font-size:12px;color:#3A3833;border:1px solid #E4E1D9;padding:1px 6px;border-radius:3px;text-decoration:none}
code.chip{background:#ECE9E2;border:0}
.links{display:flex;gap:16px;font-size:13px}
footer{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;color:#7A766F}
.pr-card{position:absolute;z-index:30;width:340px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:16px;background:#FBFAF7;border:1px solid #E4E1D9;border-radius:10px;box-shadow:0 8px 24px rgba(43,42,39,.14);display:flex;flex-direction:column;gap:10px;font-size:13px;color:#2B2A27}
.pr-card[hidden]{display:none}.pr-card.passive{pointer-events:none}
.pc-state{display:flex;align-items:center;gap:8px;font-size:12px;color:#6B6862}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;font-weight:500}.pill i{width:6px;height:6px;border-radius:50%}
.pill.merged{background:#ECE9E2;color:#2B2A27}.pill.merged i{background:#2B2A27}
.pill.open{border:1px solid #D6D2C8;color:#3A3833}.pill.open i{background:#B5B1A7}
.pill.closed{background:#EEEBE4;color:#6B6862}.pill.closed i{background:#7D7568}
.pc-title{font-size:15px;line-height:1.4;font-weight:600}.pc-title .mono{font-weight:500;color:#6B6862}
.pc-meta{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;color:#6B6862}.pc-dot{color:#D6D2C8}.add{color:#3B7D4F}.del{color:#7D7568}
.pr-card p{margin:0;padding-top:10px;border-top:1px solid #E4E1D9;line-height:1.5;color:#3A3833;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
`;

// The date range, accordions, filters, segment clicks, the bar's hover detail, expanding rows and the PR card; runs after VIEW_SOURCE.
// Without it the page shows all time with everything expanded (see the noscript style).
const SCRIPT = `
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const data = JSON.parse($('#rows').textContent);
const dates = data.rows.map(r => r.postedAt?.slice(0, 10)).filter(Boolean).sort();
const btn = $('.range-btn');
const menu = $('.range-menu');
const items = $$('[role=menuitemradio]');
const from = $('#range-from');
const to = $('#range-to');
const findings = () => $$('.finding .row');
const card = $('#pr-card');
let anchor = null;
let openTimer;
let closeTimer;
const setOpen = (b, open) => { b.setAttribute('aria-expanded', open); const sign = b.querySelector('.sign'); if (sign) { sign.textContent = open ? '\\u2212' : '+'; } document.getElementById(b.getAttribute('aria-controls')).hidden = !open; };
const sync = () => { $('.toggle-all').textContent = findings().some(b => b.getAttribute('aria-expanded') === 'true') ? 'Collapse all' : 'Expand all'; };
const filter = key => {
	$$('.filter').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === key));
	$$('.group').forEach(g => { g.hidden = key !== 'all' && g.dataset.group !== key; });
};
const show = key => { $$('.seg-detail').forEach(d => { d.hidden = d.dataset.for !== key; }); };
const apply = (param, write) => {
	const range = resolveRange(param, dates, data.now);
	const view = renderView(data.rows, { now: data.now, range });
	const open = $$('.acc[aria-expanded=true]').map(b => b.getAttribute('aria-controls'));
	closeCard();
	$('.range-label').innerHTML = view.label;
	btn.setAttribute('aria-label', 'Date range: ' + $('.range-label').textContent);
	$('.triggers').innerHTML = view.triggers;
	$('.head').innerHTML = view.head;
	$('.view').innerHTML = view.body;
	open.forEach(id => { const b = $('.acc[aria-controls="' + id + '"]'); if (b) { setOpen(b, true); } });
	items.forEach(i => i.setAttribute('aria-checked', i.dataset.range === range.key));
	$('.custom').hidden = range.key !== 'custom';
	if (from.value !== range.from) { from.value = range.from; }
	if (to.value !== range.to) { to.value = range.to; }
	if (write) {
		const url = new URL(location.href);
		url.searchParams.set('range', range.key === 'custom' ? range.from + '..' + range.to : range.key);
		history.replaceState(null, '', url);
	}
};
const setMenu = open => {
	menu.hidden = !open;
	btn.setAttribute('aria-expanded', open);
	if (open) { (items.find(i => i.getAttribute('aria-checked') === 'true') ?? items[0]).focus(); }
};
btn.disabled = false;
apply(new URLSearchParams(location.search).get('range'), false);
btn.addEventListener('click', () => setMenu(menu.hidden));
const edit = () => { if (from.value && to.value) { apply(from.value + '..' + to.value, true); } };
from.addEventListener('input', edit);
to.addEventListener('input', edit);
menu.addEventListener('keydown', e => {
	const at = items.indexOf(document.activeElement);
	if (e.key === 'Escape') { setMenu(false); btn.focus(); }
	else if (at >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
	else if (at >= 0 && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
});
// One card for every PR link, below it or above it when there's no room. The number in an evidence row sits inside the row's button, so its card can't be hovered.
function openCard(a) {
	clearTimeout(openTimer);
	clearTimeout(closeTimer);
	const p = data.prs?.[a.dataset.pr];
	if (!p || a === anchor) { return; }
	anchor?.removeAttribute('aria-describedby');
	anchor = a;
	card.innerHTML = prCard(a.dataset.pr, p);
	card.classList.toggle('passive', !!a.closest('.row'));
	if (a.matches('a')) { a.setAttribute('aria-describedby', 'pr-card'); }
	card.hidden = false;
	const r = a.getBoundingClientRect();
	const above = r.bottom + 8 + card.offsetHeight > innerHeight && r.top - 8 - card.offsetHeight >= 0;
	card.style.top = scrollY + (above ? r.top - 8 - card.offsetHeight : r.bottom + 8) + 'px';
	card.style.left = scrollX + Math.max(8, Math.min(r.left - 12, document.documentElement.clientWidth - card.offsetWidth - 8)) + 'px';
}
function closeCard() {
	clearTimeout(openTimer);
	clearTimeout(closeTimer);
	card.hidden = true;
	anchor?.removeAttribute('aria-describedby');
	anchor = null;
}
const closeSoon = () => { clearTimeout(openTimer); clearTimeout(closeTimer); closeTimer = setTimeout(closeCard, 150); };
const prLink = t => t?.closest?.('[data-pr]');
const onCard = t => !!t?.closest?.('#pr-card');
if (matchMedia('(hover: hover)').matches) {
	document.addEventListener('mouseover', e => {
		const a = prLink(e.target);
		if (a) { clearTimeout(closeTimer); if (a !== anchor) { clearTimeout(openTimer); openTimer = setTimeout(() => openCard(a), anchor ? 0 : 300); } }
		else if (onCard(e.target)) { clearTimeout(closeTimer); }
	});
	document.addEventListener('mouseout', e => {
		const to = e.relatedTarget;
		if ((prLink(e.target) || onCard(e.target)) && !(to && (prLink(to) === anchor && anchor || onCard(to)))) { closeSoon(); }
	});
	document.addEventListener('focusin', e => { const a = prLink(e.target); if (a && a.matches('a')) { openCard(a); } });
	document.addEventListener('focusout', e => { if (prLink(e.target)) { closeSoon(); } });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !card.hidden) { closeCard(); } });
addEventListener('resize', closeCard);
const seg = e => e.target.closest?.('.bar.big .seg');
document.addEventListener('mouseover', e => { if (seg(e)) { show(seg(e).dataset.key); } });
document.addEventListener('mouseout', e => { if (seg(e) && !seg({ target: e.relatedTarget ?? document.body })) { show(document.activeElement?.closest?.('.bar.big') ? document.activeElement.dataset.key : null); } });
document.addEventListener('focusin', e => { if (seg(e)) { show(seg(e).dataset.key); } });
document.addEventListener('focusout', e => { if (seg(e)) { show(null); } });
document.addEventListener('click', e => {
	const t = e.target;
	if (!menu.hidden && !t.closest('.range')) { setMenu(false); }
	const item = t.closest('[role=menuitemradio]');
	const acc = t.closest('.acc');
	const row = t.closest('.finding .row');
	const f = t.closest('.filter');
	if (item && item.dataset.range === 'custom') { apply(from.value + '..' + to.value, true); from.focus(); }
	else if (item) { apply(item.dataset.range, true); setMenu(false); btn.focus(); }
	else if (seg(e)) { setOpen($('#ev-h .acc'), true); filter(seg(e).dataset.filter); }
	else if (acc) { setOpen(acc, acc.getAttribute('aria-expanded') !== 'true'); }
	else if (row) { setOpen(row, row.getAttribute('aria-expanded') !== 'true'); sync(); }
	else if (f) { filter(f.dataset.filter); }
	else if (t.closest('.toggle-all')) { const open = t.textContent === 'Expand all'; findings().forEach(b => setOpen(b, open)); sync(); }
});
`;

/** The whole page for `rows`, as outcomes.mjs writes them: all time, which the script narrows to `?range=` (last 30 days by default). */
export function renderOutcomesPage(rows, { now = new Date() } = {}) {
	const today = now.toISOString().slice(0, 10);
	const dates = runDates(rows);
	const range = resolveRange('all', dates, today);
	const view = renderView(rows, { now: today, range });
	const prs = Object.fromEntries(rows.filter(r => r.prPreview).map(r => [r.pr, r.prPreview]));
	const data = JSON.stringify({ rows: rows.map(({ prPreview, ...r }) => r), now: today, prs }).replace(/</g, '\\u003c');
	const script = `${VIEW_SOURCE}\n${SCRIPT}`.replace(/<\/script/gi, '<\\/script');
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>/explore outcomes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&amp;display=swap">
<style>${CSS}</style>
<noscript><style>.acc-body[hidden]{display:block}#ev-body[hidden]{display:flex;flex-direction:column;gap:32px}.detail[hidden]{display:flex}.controls,.acc svg{display:none}</style></noscript></head>
<body><main><div class="page">
<header>
<div class="eyebrow"><span class="chip-cmd">/explore</span>${picker(range, dates, today)}<span class="triggers">${view.triggers}</span></div>
<div class="head">${view.head}</div>
</header>
<div class="view">${view.body}</div>
</div></main>
<div class="pr-card" id="pr-card" role="tooltip" hidden></div>
<script id="rows" type="application/json">${data}</script>
<script>${script}</script>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
	process.stdout.write(renderOutcomesPage(rows));
}
