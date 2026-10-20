/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The Triage outcomes page, from the JSON triage.mjs writes: where each
// ai-discovered issue stands today, by severity, feature, type, source and skill version.
//   node triage-page.mjs triage.json > index.html

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO_URL, SEVERITY_LABEL } from '../../../.claude/skills/exploratory-test/renderer/page/page-common.mjs';
import { escapeHtml, safeUrl } from '../../../.claude/skills/exploratory-test/renderer/shared/text.mjs';
import { accordion, day, FONTS, footer, inlineJson, inlineScript, rangeText, resolveRange, runUrl, SHARED_CONSTS, SHARED_VIEW, SHELL_CSS, SHELL_SCRIPT, topRow } from './explore-pages.mjs';

// In bar order; `triaged` puts it under the Triaged bracket, `rule` is its row in the counting panel.
const OUT = [
	{ key: 'completed', label: 'Completed', triaged: true, state: 'Closed', rule: 'Closed as completed, in any milestone', def: 'Closed as completed. GitHub can\'t tell us whether the fix has shipped.', hero: '#3B7D4F' },
	{ key: 'active', label: 'Release or backlog', triaged: true, state: 'Open', rule: 'In a dated Release or Patch milestone, a yearly Backlog, or an older one like Post-RC', def: 'Open in a dated release, patch or yearly Backlog milestone.', hero: '#2B2A27' },
	{ key: 'future', label: 'Future', triaged: true, state: 'Open', rule: 'In the Future milestone', def: 'Open in the Future milestone.', hero: '#5A5751' },
	{ key: 'closed', label: 'Closed without fix', triaged: true, state: 'Closed', rule: 'Closed as not planned, as a duplicate, or any other way', def: 'Closed as not planned, as a duplicate, or another way that isn\'t completed.', hero: '#2B2A27' },
	{ key: 'awaiting', label: 'Awaiting triage', triaged: false, state: 'Open', rule: 'No milestone yet', def: 'Open with no milestone yet. Reviewed at the weekly triage meeting.', hero: '#2B2A27' },
];
const NO_SEV = 'none';
const NO_AREA = '(no feature label)';
const SEP = ' &middot; ';

const count = (rows, out) => rows.filter(r => r.out === out).length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (a, b) => `${Math.round(a / b * 100)}%`;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const outLabel = key => OUT.find(o => o.key === key).label;
const sevLabel = key => SEVERITY_LABEL[key] ?? 'No severity';
const sevPill = key => SEVERITY_LABEL[key] ? `<span class="pill sev-${key}"><span class="dot"></span>${SEVERITY_LABEL[key]}</span>` : '<span class="pill sev-none">No severity</span>';
const areasOf = r => r.areas.length ? r.areas : [NO_AREA];

function median(values) {
	const s = [...values].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Newest first, comparing each dotted part as a number, so 1.53 is newer than 1.9. */
function byVersion(a, b) {
	const [x, y] = [a, b].map(v => v.split('.').map(Number));
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		if ((x[i] ?? 0) !== (y[i] ?? 0)) {
			return (y[i] ?? 0) - (x[i] ?? 0);
		}
	}
	return 0;
}

/** Whether `r` passes the issue list's filter: an outcome, severity, feature or issue number, each optional. */
function matches(r, f) {
	return (!f.out || r.out === f.out)
		&& (!f.sev || (r.sev ?? NO_SEV) === f.sev)
		&& (!f.area || areasOf(r).includes(f.area))
		&& (!f.issue || r.num === f.issue);
}

/** The lede: how many triaged issues are fixed (Completed) or planned (Release or backlog). */
function header(rows) {
	const triaged = rows.filter(r => r.out !== 'awaiting').length;
	const done = count(rows, 'completed') + count(rows, 'active');
	const noun = `triaged ${triaged === 1 ? 'issue' : 'issues'}`;
	const metric = done === triaged ? `all ${done} ${noun}` : `${done} of ${triaged} ${noun} (${pct(done, triaged)})`;
	const headline = !rows.length ? 'No /explore issues were filed in this date range.'
		: triaged ? `Developers fixed or planned <span class="metric">${metric}</span>.` : 'None of these issues have been triaged yet.';
	return `<div class="lede"><h1>Where do /explore's issues end up?</h1><p class="headline">${headline}</p></div>`;
}

/** Extra words under the bar for Release or backlog and Future. */
function extra(key, rows, now) {
	if (key === 'active') {
		const by = {};
		rows.filter(r => r.out === 'active').forEach(r => { by[r.milestone] = (by[r.milestone] ?? 0) + 1; });
		return ` Now: ${Object.entries(by).map(([m, n]) => `${n} in ${escapeHtml(m)}`).join(', ')}.`;
	}
	if (key === 'future') {
		const days = rows.filter(r => r.out === 'future' && r.futureSince).map(r => daysBetween(r.futureSince, now));
		return days.length ? ` Median ${plural(median(days), 'day')} there.` : '';
	}
	return '';
}

/** The main bar, with the Triaged and Awaiting brackets over it and a detail row under it; empty when there are no issues. */
function bar(rows, now) {
	const total = rows.length;
	if (!total) {
		return '';
	}
	// Brackets and segments share the grid's columns, one per segment, so the brackets line up with the bar.
	const present = OUT.filter(o => count(rows, o.key));
	const k = present.filter(o => o.triaged).length;
	const awaiting = count(rows, 'awaiting');
	const brackets = [
		k ? `<div class="bracket triaged" style="grid-column:1 / span ${k}"><b>Triaged</b><span>${total - awaiting}</span></div>` : '',
		awaiting ? `<div class="bracket awaiting" style="grid-column:span 1"><b>Awaiting</b><span>${awaiting}</span></div>` : '',
	].join('');
	const segs = present.map(o => {
		const n = count(rows, o.key);
		return `<a class="seg o-${o.key}" href="#issues" data-out="${o.key}" aria-label="${n} ${o.label}, ${pct(n, total)} of findings. List them.">${n}${n / total >= 0.15 ? `<span>${o.label}</span>` : ''}</a>`;
	}).join('');
	const details = present.map(o => {
		const n = count(rows, o.key);
		return `<div class="seg-detail" data-for="${o.key}" hidden><span class="hero" style="color:${o.hero}">${pct(n, total)}</span>`
			+ `<div><div class="what">${o.label}</div><div class="def">${escapeHtml(o.def)}${extra(o.key, rows, now)}</div></div></div>`;
	}).join('');
	return `<div class="all" style="grid-template-columns:${present.map(o => `minmax(0, ${count(rows, o.key)}fr)`).join(' ')}">
<div class="brackets">${brackets}</div>
<div class="bar big">${segs}</div>
<div class="under" aria-live="polite">${details}</div>
</div>`;
}

/** A row's small bar, on a scale shared with its section: each segment lists those issues. */
function rowBar(list, max, f) {
	const segs = OUT.filter(o => count(list, o.key)).map((o, i) => {
		const n = count(list, o.key);
		const name = `${n} ${o.label}${SEP}${escapeHtml(f.name)}. List them.`;
		return `<button type="button" class="seg o-${o.key}${o.key === 'awaiting' && i ? ' apart' : ''}" style="flex:${n} 1 0" data-out="${o.key}"`
			+ `${f.sev ? ` data-sev="${f.sev}"` : ''}${f.area ? ` data-area="${escapeHtml(f.area)}"` : ''} aria-label="${name}" title="${name}">${n}</button>`;
	}).join('');
	return `<span class="row-bar" style="width:${list.length / max * 100}%">${segs}</span>`;
}

function barTable(first, groups, note) {
	const max = Math.max(...groups.map(g => g.list.length));
	return `<div class="table" role="table">
<div class="trow cols" role="row"><span class="name" role="columnheader">${first}</span><span class="n" role="columnheader">Findings</span><span class="grow" role="columnheader">Where they stand</span></div>
${groups.map(g => `<div class="trow" role="row"><span class="name" role="rowheader">${g.head}</span><span class="n" role="cell">${g.list.length}</span><span class="grow" role="cell">${rowBar(g.list, max, g.f)}</span></div>`).join('\n')}
</div>
<p class="foot">${note}</p>`;
}

const NONE = '<p class="foot">No issues in this date range.</p>';

function bySeverity(rows) {
	const groups = [...Object.keys(SEVERITY_LABEL), NO_SEV].map(sev => ({ sev, list: rows.filter(r => (r.sev ?? NO_SEV) === sev) }))
		.filter(g => g.sev !== NO_SEV || g.list.length)
		.map(({ sev, list }) => ({ list, head: sevPill(sev), f: { sev, name: sevLabel(sev) } }));
	const summary = groups.filter(g => g.list.length).map(g => `${g.list.length} ${g.f.name.toLowerCase()}`).join(SEP) || '0 findings';
	return accordion('sev', 'By severity', summary, rows.length ? barTable('Severity', groups, 'Bars share one scale. Select a segment to list those issues.') : NONE);
}

function byFeature(rows) {
	const by = new Map();
	rows.forEach(r => areasOf(r).forEach(a => by.set(a, [...(by.get(a) ?? []), r])));
	// Most issues first, then by name, with the unlabelled ones last.
	const groups = [...by].sort(([a, x], [b, y]) => (a === NO_AREA) - (b === NO_AREA) || y.length - x.length || a.localeCompare(b))
		.map(([area, list]) => ({ list, head: escapeHtml(area), f: { area, name: area } }));
	const named = groups.filter(g => g.f.area !== NO_AREA).length;
	return accordion('feat', 'By feature', plural(named, 'feature'), rows.length ? barTable('Feature', groups, 'An issue with several feature labels counts under each.') : NONE);
}

/** One short list: `known` labels in order, others after them, `missing` last and muted. */
function tally(title, labels, known, missing, sort) {
	const by = {};
	labels.forEach(l => { by[l ?? missing] = (by[l ?? missing] ?? 0) + 1; });
	const others = Object.keys(by).filter(k => !known.includes(k) && k !== missing).sort(sort);
	const keys = [...known.filter(k => by[k]), ...others, ...(by[missing] ? [missing] : [])];
	return `<div class="tally"><div class="cols">${title}</div>${keys.map(k => `<div class="trow${k === missing ? ' missing' : ''}"><span>${escapeHtml(k)}</span><span class="n">${by[k]}</span></div>`).join('')}</div>`;
}

function breakdown(rows) {
	const kind = r => !r.type ? 'no type' : ['Bug', 'Enhancement'].includes(r.type) ? r.type.toLowerCase() : 'other type';
	const summary = ['bug', 'enhancement', 'other type', 'no type'].map(k => [k, rows.filter(r => kind(r) === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(SEP) || '0 issues';
	const body = `<div class="tallies">
${tally('Type', rows.map(r => r.type), ['Bug', 'Enhancement'], 'No type')}
${tally('Report source', rows.map(r => r.source === 'local' ? 'Local run' : 'PR run'), ['PR run', 'Local run'], '')}
${tally('Linked by', rows.map(r => r.via === 'matched' ? 'Matched to its finding' : 'Filed from the report'), ['Filed from the report', 'Matched to its finding'], '')}
${tally('Skill version', rows.map(r => r.skillVersion), [], 'Not recorded', byVersion)}
</div>`;
	return accordion('kind', 'Type, source and skill version', summary, rows.length ? body : NONE);
}

function age(r, now) {
	if (r.out === 'future') {
		return r.futureSince ? `${plural(daysBetween(r.futureSince, now), 'day')} in Future` : 'in Future';
	}
	if (r.out === 'awaiting') {
		const d = daysBetween(r.filed, now);
		return d ? `filed ${plural(d, 'day')} ago` : 'filed today';
	}
	return r.closed && r.out !== 'active' ? `${r.out === 'completed' ? 'completed' : 'closed'} ${day(r.closed)}` : '';
}

function renderIssueRow(r, now) {
	const links = [safeUrl(r.reportUrl) && `<a href="${escapeHtml(r.reportUrl)}">report</a>`, safeUrl(r.findingUrl) && `<a href="${escapeHtml(r.findingUrl)}">finding</a>`].filter(Boolean);
	const matched = r.via === 'matched' ? ['<span title="Filed by hand; the outcomes job matched it to the finding, and it mentions the PR">matched</span>'] : [];
	const meta = [`<span class="mono">#${Number(r.num)}</span>`, escapeHtml(r.areas.join(', ') || 'no feature label'), `filed ${day(r.filed)}`, ...matched, ...links].join(SEP);
	return `<div class="issue" id="i${Number(r.num)}"><span class="sev-col">${sevPill(r.sev)}</span>`
		+ `<span class="main"><a class="issue-title" href="${REPO_URL}/issues/${Number(r.num)}">${escapeHtml(r.title)}</a><span class="meta">${meta}</span></span>`
		+ `<span class="out"><i class="sw o-${r.out}" aria-hidden="true"></i>${escapeHtml(r.out === 'active' ? r.milestone : outLabel(r.out))}</span>`
		+ `<span class="age">${age(r, now)}</span></div>`;
}

function issueList(rows, filter, now) {
	const order = OUT.map(o => o.key);
	const shown = rows.filter(r => matches(r, filter)).sort((a, b) => order.indexOf(a.out) - order.indexOf(b.out) || b.filed.localeCompare(a.filed) || b.num - a.num);
	const label = [filter.sev && sevLabel(filter.sev), filter.area && escapeHtml(filter.area), filter.out && outLabel(filter.out), filter.issue && `#${Number(filter.issue)}`].filter(Boolean);
	const chip = label.length ? `<div class="showing">Showing <span class="chip-filter">${[...label, shown.length].join(SEP)}<button type="button" class="clear" aria-label="Clear filter, show all issues">&times;</button></span></div>` : '';
	const list = shown.length ? `<div class="issues">${shown.map(r => renderIssueRow(r, now)).join('\n')}</div>` : label.length ? '<p class="foot">No issues match this filter in this date range.</p>' : NONE;
	return accordion('issues', 'All issues', plural(rows.length, 'issue'), `${chip}${list}`, ' id="issues"');
}

/** The parts that change with the date range or the list's filter: the button's dates, the lede, the bar and the sections. */
export function renderView(rows, { now, range, filter = {} }) {
	const inRange = range.key === 'all' ? rows : rows.filter(r => r.filed >= range.from && r.filed <= range.to);
	return {
		label: rangeText(range),
		head: header(inRange),
		bar: bar(inRange, now),
		body: `<div class="accordion">\n${[bySeverity(inRange), byFeature(inRange), breakdown(inRange), issueList(inRange, filter, now)].join('\n')}\n</div>`,
	};
}

// The browser's copy of the view, so it renders the same markup as the server.
const VIEW_FNS = { escapeHtml, safeUrl, ...SHARED_VIEW, count, plural, pct, daysBetween, outLabel, sevLabel, sevPill, areasOf, median, byVersion, matches, header, extra, bar, rowBar, barTable, bySeverity, byFeature, tally, breakdown, age, renderIssueRow, issueList, renderView };
export const VIEW_SOURCE = [
	...Object.entries({ ...SHARED_CONSTS, SEVERITY_LABEL, OUT, NO_SEV, NO_AREA, SEP, NONE }).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`),
	...Object.entries(VIEW_FNS).map(([k, f]) => `const ${k} = ${f};`),
].join('\n');

/** How outcomes are counted, behind the ? next to the heading. */
function howPanel() {
	const rows = OUT.map(o => `<div class="trow" role="row"><span class="name" role="rowheader"><i class="sw o-${o.key}" aria-hidden="true"></i>${o.label}</span><span class="state" role="cell">${o.state}</span><span role="cell">${o.rule}</span></div>`).join('');
	return `<div class="how-panel" id="how" hidden><div class="muted-line">Each finding counts once, by where it stands today.</div>
<div class="how-table" role="table" aria-label="How outcomes are counted"><div class="trow cols" role="row"><span role="columnheader">Outcome</span><span role="columnheader">State</span><span role="columnheader">Which issues</span></div>${rows}</div>
<div class="notes"><div>Counted: issues labelled ai-discovered that link to an exploratory-test report, and issues filed by hand that the Shipping impact page matched to a finding and that mention its PR (marked matched).</div></div></div>`;
}

const CSS = `
.lede{max-width:760px}
.now-head{display:flex;align-items:center;gap:10px}
.how{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border-radius:50%;border:1px solid #C9C5BB;background:transparent;color:#5A5751;font:600 12px 'IBM Plex Sans',sans-serif;cursor:pointer}
.how:hover,.how[aria-expanded=true]{border-color:#2B2A27}.how[aria-expanded=true]{background:#ECE9E2}
.how:focus-visible{outline:2px solid #2B2A27;outline-offset:2px}
.how-panel{padding:16px 20px 14px;background:#FBFAF7;border:1px solid #E4E1D9;border-radius:10px;display:flex;flex-direction:column;gap:12px;font-size:14px;color:#3A3833}
.how-panel[hidden],.slot:empty{display:none}
.muted-line{color:#5A5751}
.how-table .trow{display:grid;grid-template-columns:minmax(180px,1.1fr) 72px minmax(0,2fr);gap:16px;align-items:center;padding:9px 0;border-bottom:1px solid #E4E1D9}
.how-table .trow:last-child{border-bottom:0}
.how-table .cols{padding:0 0 6px;border-bottom:1px solid #2B2A27}
.how-table .name{display:flex;align-items:center;gap:8px;font-weight:600;color:#2B2A27}.how-table .state{color:#5A5751}
.notes{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#5A5751}
.cols{color:#6B6862}
.bracket span{color:#5A5751}
.bracket.triaged{border-bottom:1px solid #5A5751}
.bracket.awaiting{border-bottom:1px solid #C9C5BB}.bracket.awaiting b{color:#5A5751}.bracket.awaiting span{color:#6B6862}
.o-completed{background:#3B7D4F;color:#FFF}
.o-active{background:#DCD8CE;color:#3A3833}
.o-future{background:repeating-linear-gradient(135deg,#CFC8BB 0 8px,#C5BEB0 8px 10px);color:#2B2A27}
.o-closed{background:#7D7568;color:#FFF}
.o-awaiting{background:#F5F4F0;color:#5A5751;border:1.5px dashed #B5B1A7}
.sw{flex:0 0 auto;display:inline-block;width:12px;height:12px;border-radius:2px;box-sizing:border-box}
.issue .sw{width:10px;height:10px}
.table{display:flex;flex-direction:column}
.table .trow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;min-height:48px;padding:8px 0;box-sizing:border-box;border-bottom:1px solid #E4E1D9}
.table .trow:last-child{border-bottom:0}
.table .cols{min-height:0;padding:0 0 8px;border-bottom:1px solid #2B2A27}
.table .name{flex:0 0 160px;font-size:14px;font-weight:500}.table .n{flex:0 0 96px;font-size:13px;color:#5A5751}.table .grow{flex:1 1 280px;min-width:0;height:24px}
.table .cols .n,.table .cols .grow{height:auto;font-size:12px;color:#6B6862}
.row-bar{height:100%;display:flex;gap:2px}
.row-bar .seg{min-width:0;padding:0;border:0;cursor:pointer}
.row-bar .o-awaiting{border:1.5px dashed #B5B1A7}.row-bar .apart{margin-left:6px}
.row-bar .seg:hover{filter:brightness(.96)}.row-bar .seg:focus-visible{outline:2px solid #2B2A27;outline-offset:1px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pill .dot{width:6px;height:6px;border-radius:50%}
.sev-major{background:#FBECE9;color:#A12C1F}.sev-major .dot{background:#D1492F}
.sev-moderate{background:#FCF1E1;color:#8F530A}.sev-moderate .dot{background:#D9953A}
.sev-minor{background:#EEF0F3;color:#4A5563}.sev-minor .dot{background:#A3ABB6}
.sev-none{background:transparent;color:#5A5751;border:1px dashed #B5B1A7}
.tallies{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:32px}
.tally{display:flex;flex-direction:column}
.tally .cols{padding-bottom:8px;border-bottom:1px solid #2B2A27}
.tally .trow{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #E4E1D9;font-size:14px}
.tally .trow:last-child{border-bottom:0}.tally .missing>span:first-child{color:#7A766F}
#issues-body:not([hidden]){display:flex;flex-direction:column;gap:16px}
.showing{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:13px;color:#5A5751}
.chip-filter{display:inline-flex;align-items:center;gap:8px;padding:4px 6px 4px 12px;border-radius:999px;background:#2B2A27;color:#FFF;font-weight:500}
.clear{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:50%;background:#4A4844;color:#FFF;cursor:pointer;font:14px/1 'IBM Plex Sans',sans-serif}
.issues{display:flex;flex-direction:column;border-top:1px solid #2B2A27}
.issue{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;min-height:56px;padding:12px 0;box-sizing:border-box;border-bottom:1px solid #E4E1D9}
.issue:last-child{border-bottom:0}
.sev-col{flex:0 0 96px}
.main{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:2px}
.issue-title{font-size:16px;line-height:1.4;font-weight:500;color:#2B2A27;text-decoration:none}a.issue-title:hover{color:#2B2A27;text-decoration:underline;text-underline-offset:3px}
.meta{font-size:12px;color:#7A766F}
.out{flex:0 0 170px;display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:#3A3833}
.age{flex:0 0 140px;text-align:right;font-size:12px;color:#7A766F}
`;

// The range, the ? panel, accordions, the bar's hover detail and the issue list's filter; runs after VIEW_SOURCE and SHELL_SCRIPT.
// Without it the page shows all time with everything expanded (see the noscript style).
const SCRIPT = `
const data = JSON.parse($('#rows').textContent);
const dates = data.rows.map(r => r.filed).sort();
const params = new URLSearchParams(location.search);
// ?issue=N, from the Shipping impact page, lists that one issue over all time unless a range is given.
let filter = Number(params.get('issue')) ? { issue: Number(params.get('issue')) } : {};
let range;
// Sections the reader opened or closed, kept across re-renders; the rest follow the default.
const chosen = filter.issue ? { 'issues-body': true } : {};
const setOpen = (b, open) => { b.setAttribute('aria-expanded', open); document.getElementById(b.getAttribute('aria-controls')).hidden = !open; };
const show = key => { $$('.seg-detail').forEach(d => { d.hidden = d.dataset.for !== key; }); };
const render = () => {
	const view = renderView(data.rows, { now: data.now, range, filter });
	$('.head').innerHTML = view.head;
	$('.slot').innerHTML = view.bar;
	$('.view').innerHTML = view.body;
	Object.entries(chosen).forEach(([id, open]) => { const b = $('.acc[aria-controls="' + id + '"]'); if (b) { setOpen(b, open); } });
};
const apply = (param, write) => {
	range = resolveRange(param, dates, data.now);
	render();
	syncPicker(range, write);
};
const pick = f => {
	filter = f;
	chosen['issues-body'] = true;
	render();
	$('#issues').scrollIntoView({ block: 'start' });
};
apply(params.get('range') ?? (filter.issue ? 'all' : null), false);
if (filter.issue) { $('#issues').scrollIntoView({ block: 'start' }); }
const seg = e => e.target.closest?.('.bar.big .seg');
document.addEventListener('mouseover', e => { if (seg(e)) { show(seg(e).dataset.out); } });
document.addEventListener('mouseout', e => { if (seg(e)) { show(document.activeElement?.closest?.('.bar.big .seg')?.dataset.out); } });
document.addEventListener('focusin', e => { if (seg(e)) { show(seg(e).dataset.out); } });
document.addEventListener('focusout', e => { if (seg(e)) { show(null); } });
document.addEventListener('click', e => {
	const t = e.target;
	const acc = t.closest('.acc');
	const how = t.closest('.how');
	const s = t.closest('.seg[data-out]');
	if (how) { const open = how.getAttribute('aria-expanded') !== 'true'; how.setAttribute('aria-expanded', open); $('#how').hidden = !open; }
	else if (s) { e.preventDefault(); pick({ out: s.dataset.out, sev: s.dataset.sev, area: s.dataset.area }); }
	else if (t.closest('.clear')) { filter = {}; render(); }
	else if (acc) { const open = acc.getAttribute('aria-expanded') !== 'true'; chosen[acc.getAttribute('aria-controls')] = open; setOpen(acc, open); }
});
`;

/** The whole page for triage.mjs's output: all time, which the script narrows to `?range=` (last 30 days by default). */
export function renderTriagePage({ rows }, { now = new Date(), runUrl: run = runUrl({}) } = {}) {
	const today = now.toISOString().slice(0, 10);
	const dates = rows.map(r => r.filed).sort();
	const range = resolveRange('all', dates, today);
	const view = renderView(rows, { now: today, range });
	const script = inlineScript(`${VIEW_SOURCE}\n${SHELL_SCRIPT}\n${SCRIPT}`);
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>/explore triage outcomes</title>
${FONTS}
<style>${SHELL_CSS}${CSS}</style>
<noscript><style>.acc-body[hidden],.how-panel[hidden]{display:block}#issues-body[hidden]{display:flex;flex-direction:column;gap:16px}.how,.acc svg{display:none}</style></noscript></head>
<body><main><div class="page">
<header>
${topRow('triage', range, dates, today)}
<div class="head">${view.head}</div>
</header>
<section aria-labelledby="now-h">
<div class="now-head"><h2 id="now-h">Where they stand now</h2><button type="button" class="how" aria-expanded="false" aria-controls="how" aria-label="How outcomes are counted" title="How outcomes are counted">?</button></div>
${howPanel()}
<div class="slot">${view.bar}</div>
</section>
<div class="view">${view.body}</div>
${footer(now, escapeHtml(run))}
</div></main>
<script id="rows" type="application/json">${inlineJson({ rows, now: today })}</script>
<script>${script}</script>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.stdout.write(renderTriagePage(JSON.parse(readFileSync(process.argv[2], 'utf8')), { runUrl: runUrl(process.env) }));
}
