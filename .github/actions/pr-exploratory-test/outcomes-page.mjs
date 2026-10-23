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
import { accordion, day, FONTS, footer, inlineJson, inlineScript, PAGES, rangeText, resolveRange, runUrl, SHARED_CONSTS, SHARED_VIEW, SHELL_CSS, SHELL_SCRIPT, topRow } from './explore-pages.mjs';

export { resolveRange, runUrl };

// In this order everywhere. `group` is the evidence filter: fixed, filed, not fixed, change dropped, or no outcome yet;
// `def` explains it under the bar, `brief` under its evidence group.
const OUTCOMES = [
	{ key: 'fixed-in-pr', label: 'Fixed in the PR', group: 'fixed', def: 'A commit pushed to the PR after the run fixed it.', brief: 'Fixed by a later commit on the PR.' },
	{ key: 'fixed-later', label: 'Fixed later', group: 'fixed', def: 'Fixed on main after the merge, or its issue was closed as completed.', brief: 'Fixed on main after merging.' },
	{ key: 'filed-issue', label: 'Filed as issue', group: 'filed', def: 'An issue matching the finding was opened after the run, and nothing has fixed it yet.', brief: 'Tracked in an issue, not fixed yet.' },
	{ key: 'not-fixed', label: 'Not fixed', group: 'not', def: 'The PR merged or closed with no fix. Moves to Filed as issue or Fixed later if that happens afterwards.', brief: 'Merged or closed without a fix.' },
	{ key: 'dropped', label: 'Change dropped', group: 'dropped', def: 'The PR merged without the change the finding was about, so nothing it found shipped. Not in the % fixed.', brief: 'Merged without the change the finding was about.' },
	{ key: 'pending', label: 'PR still open', group: 'open', def: 'The PR hasn\'t merged yet. These count once it merges or closes.', brief: 'Waiting for the PR to merge or close.' },
	{ key: 'unclear', label: 'Unclear', group: 'open', def: 'A check failed or the model couldn\'t say.', brief: 'Couldn\'t tell from the diff.' },
	{ key: 'no-paths', label: 'No files named', group: 'open', def: 'The finding names no file, so main couldn\'t be checked.', brief: 'No files named, so main couldn\'t be checked.' },
];
const FILTERS = [['fixed', 'Fixed'], ['filed', 'Filed as issue'], ['not', 'Not fixed'], ['dropped', 'Change dropped'], ['open', 'No outcome yet']];
const DECIDED_BY = {
	'diff+model': 'The diff, read by the model',
	'issue+model': 'A matching issue, confirmed by the model',
	'issue-closed': 'Its issue was closed as completed',
	'pr-open': 'PR is still open',
	'merged-no-fix': 'Merged with no fix found',
	'closed-unmerged': 'PR closed without merging',
	'change-dropped': 'The merged PR no longer changes its files',
	'sha': 'A specific commit',
};
const TRIGGER = { auto: 'started automatically', explore: 'started by /explore' };
const HERO_COLOR = { 'fixed-in-pr': '#3B7D4F', 'not-fixed': '#7D7568' };
const INK = '#2B2A27';
const SEP = ' &middot; ';
// The PR card's state pill, and what goes before its date.
const PR_STATE = { merged: ['Merged', ''], open: ['Open', 'opened '], closed: ['Closed without merging', ''] };

const pct = (a, b) => `${Math.round(a / b * 100)}%`;
const codeSpans = text => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isFixed = r => r.outcome === 'fixed-in-pr' || r.outcome === 'fixed-later';
// Outcomes in the % fixed; the rest are counted apart.
const isCounted = o => o.group !== 'open' && o.group !== 'dropped';

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

/** The big bar's segments, leaving out outcomes with none, each a link to its evidence. Narrow ones show their label only on hover. */
function segments(s) {
	return OUTCOMES.filter(o => s.counts[o.key]).map(o => {
		const n = s.counts[o.key];
		return `<a class="seg o-${o.key}" href="#evidence" data-filter="${o.group}" data-key="${o.key}" aria-label="${n} ${o.label}, show these findings">${n}${n / s.total >= 0.2 ? `<span>${o.label}</span>` : ''}</a>`;
	}).join('');
}

/** A severity or PR bar: counted outcomes, a gap, then the rest, so the green share of the first part is the % fixed. */
function splitBar(rows) {
	const s = summarize(rows);
	const part = rest => {
		const present = OUTCOMES.filter(o => isCounted(o) !== rest && s.counts[o.key]);
		const n = present.reduce((sum, o) => sum + s.counts[o.key], 0);
		return n ? `<span class="part" style="flex:${n} 1 0">${present.map(o => `<span class="seg o-${o.key}" style="flex:${s.counts[o.key]} 1 0" title="${s.counts[o.key]} ${o.label}">${s.counts[o.key]}</span>`).join('')}</span>` : '';
	};
	return `<div class="grow bar mid">${part(false)}${part(true)}</div>`;
}

function triggers(rows) {
	const counts = {};
	for (const r of rows) {
		const t = TRIGGER[r.trigger] ?? 'trigger unknown';
		counts[t] = (counts[t] ?? 0) + 1;
	}
	return Object.keys(counts).length > 1 ? Object.entries(counts).map(([t, n]) => `${SEP}<span>${n} ${t}</span>`).join('') : '';
}

function header(s) {
	const inPr = s.counts['fixed-in-pr'];
	const noun = s.counted === 1 ? 'finding' : 'findings';
	const metric = inPr === s.counted ? `all ${inPr} ${noun}` : `${inPr} of ${s.counted} ${noun} (${pct(inPr, s.counted)})`;
	const headline = !s.total ? 'No /explore findings in this date range.'
		: s.counted ? `Developers fixed <span class="metric">${metric}</span> before merging.` : 'No PRs with findings have merged yet.';
	return `<div class="lede"><h1>Does /explore change what ships?</h1><p class="headline">${headline}</p></div>`;
}

function allBar(s) {
	// Brackets and segments share the grid's columns, one per segment, so the brackets line up with the bar.
	const present = OUTCOMES.filter(o => s.counts[o.key]);
	const columns = present.map(o => `minmax(0, ${s.counts[o.key]}fr)`).join(' ');
	const k = present.filter(isCounted).length;
	const brackets = [
		k ? `<div class="bracket counted" style="grid-column:1 / span ${k}"><b>Outcome known</b><span>${s.counted}</span></div>` : '',
		k < present.length ? `<div class="bracket not-counted" style="grid-column:${k + 1} / span ${present.length - k}"><b>${s.counts.dropped ? 'Not counted' : 'No outcome yet'}</b><span>${s.notCounted}</span></div>` : '',
	].join('');
	// A share of the known outcomes, or a bare count for the rest so denominators don't mix.
	const details = present.map(o => {
		const n = s.counts[o.key];
		const counted = isCounted(o);
		return `<div class="seg-detail" data-for="${o.key}" hidden><span class="hero" style="color:${HERO_COLOR[o.key] ?? INK}">${counted ? pct(n, s.counted) : n}</span>`
			+ `<div><div class="what">${o.label}</div><div class="def">${escapeHtml(o.def)}</div></div></div>`;
	}).join('');
	return `<section aria-labelledby="all-h">
<h2 id="all-h">Findings by outcome</h2>
<div class="all" style="grid-template-columns:${columns}">
<div class="brackets">${brackets}</div>
<div class="bar big">${segments(s)}</div>
<div class="under" aria-live="polite">${details}</div>
</div>
</section>`;
}

function severityRows(own) {
	const per = Object.keys(SEVERITY_LABEL).map(key => {
		const list = own.filter(r => r.severity === key);
		return { label: SEVERITY_LABEL[key], list, s: summarize(list) };
	});
	const rows = per.map(({ label, list, s }) => {
		const rate = s.counted ? `<div class="pct"><span class="green">${pct(s.fixed, s.counted)}</span><span class="of">${s.fixed} of ${s.counted}</span></div>`
			: '<div class="pct none" aria-label="No outcome yet">&ndash;</div>';
		return `<div class="grid-row sev-row"><div class="name">${label}</div>${rate}${s.total ? splitBar(list) : `<div class="grow empty">No ${label} findings in this period</div>`}</div>`;
	}).join('\n');
	// Every finding, like the other sections' counts.
	const summary = per.filter(p => p.s.total).map(p => `${p.s.total} ${p.label.toLowerCase()}`).join(SEP);
	return accordion('sev', 'By severity', summary, `<div class="rows sev-rows">
<div class="grid-row cols" aria-hidden="true"><span class="name">Severity</span><span class="pct">% fixed</span><span class="grow">Outcomes</span></div>
${rows}
</div>
<p class="foot">% fixed includes fixes made after merging. Findings with no outcome yet aren't in it.</p>`);
}

function prRows(own) {
	const byPr = new Map();
	for (const r of own) {
		byPr.set(r.pr, [...(byPr.get(r.pr) ?? []), r]);
	}
	// The PR run most recently first, then the newest PR.
	const latest = list => list.reduce((m, r) => (r.postedAt ?? '') > m ? r.postedAt : m, '');
	const rows = [...byPr].sort(([a, x], [b, y]) => latest(y).localeCompare(latest(x)) || b - a).map(([pr, list]) =>
		`<div class="grid-row pr"><a class="name mono" href="${REPO_URL}/pull/${Number(pr)}" data-pr="${Number(pr)}">#${Number(pr)}</a><span class="pct small">${plural(list.length, 'finding')}</span>${splitBar(list)}</div>`).join('\n');
	const withFix = [...byPr.values()].filter(list => list.some(isFixed)).length;
	return accordion('pr', 'By PR', `${plural(byPr.size, 'PR')}${SEP}${withFix} with fixes`, `<div class="rows">${rows}</div>`);
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
	// A filed issue's triage outcome lives on the other page.
	const issueNum = Number(r.issue?.number) || ev.issue;
	const triage = r.outcome === 'filed-issue' && issueNum ? `<a href="${PAGES.triage.url}?issue=${issueNum}">See its triage</a>` : '';
	const links = [report ? `<a href="${escapeHtml(report)}">Open report</a>` : '', `<a href="${REPO_URL}/pull/${pr}" data-pr="${pr}">Open PR</a>`, triage].join('');
	return `<div class="finding" id="f${n}"><button type="button" class="row" aria-expanded="false" aria-controls="d${n}">`
		+ `<span class="title"><span>${codeSpans(r.title)}</span>${r.dupMaybe ? '<span class="maybe">Possible duplicate</span>' : ''}</span>`
		+ `<span class="mono link" data-pr="${pr}">#${pr}</span><span class="sev">${escapeHtml(SEVERITY_LABEL[r.severity] ?? r.severity ?? '')}</span><span class="sign" aria-hidden="true">+</span></button>`
		+ `<div class="detail" id="d${n}" hidden>${ev.text ? `<p class="ev">${codeSpans(ev.text)}</p>` : ''}<dl>${dl}</dl><div class="links">${links}</div></div></div>`;
}

function evidence(own, s) {
	let n = 0;
	const groups = OUTCOMES.map(o => {
		const items = own.filter(r => r.outcome === o.key);
		return items.length
			? `<div class="group" data-group="${o.group}"><div class="group-head"><h3><i class="o-${o.key}"></i>${o.label} <span class="n">${items.length}</span></h3><span class="brief">${escapeHtml(o.brief)}</span></div>`
			+ `<div class="rows">${items.map(r => findingRow(r, ++n)).join('\n')}</div></div>`
			: '';
	}).join('\n');
	const counts = { fixed: s.fixed, filed: s.counts['filed-issue'], not: s.counts['not-fixed'], dropped: s.counts.dropped, open: s.notCounted - s.counts.dropped };
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


/** The parts of the page that change with the date range: the button's dates, mixed triggers, the lede, and the sections. */
export function renderView(rows, { range }) {
	const inRange = range.key === 'all' ? rows : rows.filter(r => {
		const d = r.postedAt?.slice(0, 10);
		return d && d >= range.from && d <= range.to;
	});
	const own = inRange.filter(r => !r.dupOf);
	const s = summarize(inRange);
	const body = s.total ? [allBar(s), `<div class="accordion">\n${severityRows(own)}\n${prRows(own)}\n${evidence(own, s)}\n</div>`] : [];
	return { label: rangeText(range), triggers: triggers(own), head: header(s), body: body.join('\n') };
}

const runDates = rows => rows.map(r => r.postedAt?.slice(0, 10)).filter(Boolean).sort();

// The browser's copy of the view, so it renders the same markup as the server.
const VIEW_FNS = { escapeHtml, safeUrl, ...SHARED_VIEW, pct, codeSpans, plural, isFixed, isCounted, summarize, splitEvidence, segments, splitBar, triggers, header, allBar, severityRows, prRows, findingRow, evidence, renderView, prCard };
export const VIEW_SOURCE = [
	...Object.entries({ ...SHARED_CONSTS, SEVERITY_LABEL, OUTCOMES, FILTERS, DECIDED_BY, TRIGGER, HERO_COLOR, INK, SEP, PR_STATE }).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`),
	...Object.entries(VIEW_FNS).map(([k, f]) => `const ${k} = ${f};`),
].join('\n');

const CSS = `
.small{font-size:13px;color:#5A5751}
.bracket.not-counted{justify-content:flex-end}
.bracket.counted{border-bottom:1px solid #5A5751}
.bracket.not-counted{border-bottom:1px solid #C9C5BB}.bracket.not-counted b{color:#5A5751}
.bar.mid{height:24px;gap:8px}
.part{display:flex;gap:2px;min-width:0}.part .seg{min-width:0}
.o-fixed-in-pr{background:#3B7D4F;color:#FFF}
.o-fixed-later{background:#9CC7A6;color:#1F3D28}
.o-filed-issue{background:repeating-linear-gradient(135deg,#CFC8BB 0 8px,#C5BEB0 8px 10px);color:#2B2A27}
.o-not-fixed{background:#7D7568;color:#FFF}
.o-pending{background:#F5F4F0;color:#5A5751;border:1.5px dashed #B5B1A7}
.o-unclear{background:#EEEBE4;color:#3A3833}
.o-no-paths{background:#E6E2D9;color:#5A5751}
.o-dropped{background:#FFF;color:#5A5751;border:1.5px solid #B5B1A7}
i[class^=o-]{display:inline-block;width:12px;height:12px;border-radius:2px;box-sizing:border-box}
.n{color:#7A766F;font-weight:400}
.group[hidden],.detail[hidden]{display:none}
.rows{display:flex;flex-direction:column;border-top:1px solid #2B2A27}
.grid-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;padding:12px 0;box-sizing:border-box;border-bottom:1px solid #E4E1D9}
.grid-row .name{flex:0 0 120px}.grid-row .pct{flex:0 0 160px}.grid-row .grow{flex:1 1 280px;min-width:0}
.rows>:last-child{border-bottom:0}
.cols{padding:0 0 8px;color:#6B6862;border-bottom:1px solid #2B2A27}
.sev-rows{border-top:0}
.sev-row{min-height:56px}.sev-row .name{font-size:16px;font-weight:600}
.sev-row .pct{display:flex;align-items:baseline;gap:8px}.sev-row .green{font-size:28px;line-height:1}.of{font-size:13px;color:#6B6862}
.sev-row .pct.none{font-size:18px;line-height:1;font-weight:400;color:#B5B1A7}
.empty{font-size:13px;color:#7A766F}
.pr{min-height:56px}.pr .name{font-size:14px;font-weight:500}
#ev-body:not([hidden]){display:flex;flex-direction:column;gap:32px}
.controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}
.controls [role=group]{display:flex;flex-wrap:wrap;gap:6px}
.filter{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid #D6D2C8;background:#FBFAF7;color:#3A3833;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer}
.filter[aria-pressed=true]{border-color:#2B2A27;background:#2B2A27;color:#FFF}
.toggle-all{min-height:36px;padding:0;border:0;background:transparent;color:#2F6B55;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer;text-decoration:underline}
.group{display:flex;flex-direction:column}
.group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding-bottom:12px}
.brief{font-size:13px;color:#7A766F}
h3{margin:0;display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600}
.finding{border-bottom:1px solid #E4E1D9}
.row{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:12px 0;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit;min-height:52px}
.title{flex:1 1 380px;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:16px;line-height:1.4;font-weight:500}
.maybe{font-size:12px;font-weight:400;color:#7A3E00;background:#FDF0E1;padding:2px 8px;border-radius:999px}
.link{flex:0 0 72px;font-size:12px;color:#6B6862;text-decoration:underline dotted #C9C5BB;text-underline-offset:3px}
.sev{flex:0 0 72px;font-size:12px;color:#7A766F}
.sign{flex:0 0 20px;text-align:center;font-size:16px;color:#5A5751}
.detail{margin:0 0 20px;padding:4px 0 4px 16px;border-left:2px solid #E4E1D9;display:flex;flex-direction:column;gap:12px}
.ev{margin:0;font-size:15px;line-height:1.6;color:#3A3833;max-width:820px}
code{font-size:13px;background:#ECE9E2;padding:1px 5px;border-radius:3px}
dl{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;font-size:13px;color:#5A5751;max-width:820px}
dt{color:#7A766F}dd{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.chip{font-size:12px;color:#3A3833;border:1px solid #E4E1D9;padding:1px 6px;border-radius:3px;text-decoration:none}
code.chip{background:#ECE9E2;border:0}
.links{display:flex;gap:16px;font-size:13px}
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

// The range, accordions, filters, segment clicks, the bar's hover detail, expanding rows and the PR card; runs after VIEW_SOURCE and SHELL_SCRIPT.
// Without it the page shows all time with everything expanded (see the noscript style).
const SCRIPT = `
const data = JSON.parse($('#rows').textContent);
const dates = data.rows.map(r => r.postedAt?.slice(0, 10)).filter(Boolean).sort();
const findings = () => $$('.finding .row');
const card = $('#pr-card');
// Sections the reader opened or closed, kept across range changes; the rest follow each view's default.
const chosen = {};
let anchor = null;
let openTimer;
let closeTimer;
const setOpen = (b, open) => { b.setAttribute('aria-expanded', open); const sign = b.querySelector('.sign'); if (sign) { sign.textContent = open ? '\\u2212' : '+'; } document.getElementById(b.getAttribute('aria-controls')).hidden = !open; };
const toggle = (b, open) => { chosen[b.getAttribute('aria-controls')] = open; setOpen(b, open); };
const sync = () => { $('.toggle-all').textContent = findings().some(b => b.getAttribute('aria-expanded') === 'true') ? 'Collapse all' : 'Expand all'; };
const filter = key => {
	$$('.filter').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === key));
	$$('.group').forEach(g => { g.hidden = key !== 'all' && g.dataset.group !== key; });
};
const show = key => { $$('.seg-detail').forEach(d => { d.hidden = d.dataset.for !== key; }); };
const apply = (param, write) => {
	const range = resolveRange(param, dates, data.now);
	const view = renderView(data.rows, { range });
	closeCard();
	$('.triggers').innerHTML = view.triggers;
	$('.head').innerHTML = view.head;
	$('.view').innerHTML = view.body;
	Object.entries(chosen).forEach(([id, open]) => { const b = $('.acc[aria-controls="' + id + '"]'); if (b) { setOpen(b, open); } });
	syncPicker(range, write);
};
apply(new URLSearchParams(location.search).get('range'), false);
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
		const next = e.relatedTarget;
		if ((prLink(e.target) || onCard(e.target)) && !(next && (prLink(next) === anchor && anchor || onCard(next)))) { closeSoon(); }
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
	const acc = t.closest('.acc');
	const row = t.closest('.finding .row');
	const f = t.closest('.filter');
	if (seg(e)) { toggle($('#ev-h .acc'), true); filter(seg(e).dataset.filter); }
	else if (acc) { toggle(acc, acc.getAttribute('aria-expanded') !== 'true'); }
	else if (row) { setOpen(row, row.getAttribute('aria-expanded') !== 'true'); sync(); }
	else if (f) { filter(f.dataset.filter); }
	else if (t.closest('.toggle-all')) { const open = t.textContent === 'Expand all'; findings().forEach(b => setOpen(b, open)); sync(); }
});
`;

/** The whole page for `rows`, as outcomes.mjs writes them: all time, which the script narrows to `?range=` (last 30 days by default). */
export function renderOutcomesPage(rows, { now = new Date(), runUrl: run = runUrl({}) } = {}) {
	const today = now.toISOString().slice(0, 10);
	const dates = runDates(rows);
	const range = resolveRange('all', dates, today);
	const prs = Object.fromEntries(rows.filter(r => r.prPreview).map(r => [r.pr, r.prPreview]));
	const view = renderView(rows, { range });
	const data = inlineJson({ rows: rows.map(({ prPreview, ...r }) => r), now: today, prs });
	const script = inlineScript(`${VIEW_SOURCE}\n${SHELL_SCRIPT}\n${SCRIPT}`);
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>/explore shipping impact</title>
${FONTS}
<style>${SHELL_CSS}${CSS}</style>
<noscript><style>.acc-body[hidden]{display:block}#ev-body[hidden]{display:flex;flex-direction:column;gap:32px}.detail[hidden]{display:flex}.controls,.acc svg{display:none}</style></noscript></head>
<body><main><div class="page">
<header>
${topRow('impact', range, dates, today)}
<div class="head">${view.head}</div>
</header>
<div class="view">${view.body}</div>
${footer(now, escapeHtml(run), `<span class="triggers">${view.triggers}</span>`)}
</div></main>
<div class="pr-card" id="pr-card" role="tooltip" hidden></div>
<script id="rows" type="application/json">${data}</script>
<script>${script}</script>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
	process.stdout.write(renderOutcomesPage(rows, { runUrl: runUrl(process.env) }));
}
