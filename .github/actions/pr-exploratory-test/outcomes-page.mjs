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

// In this order everywhere. `group` is the evidence filter: fixed, not acted on, or unresolved.
const OUTCOMES = [
	{ key: 'fixed-in-pr', label: 'Fixed in the PR', group: 'fixed', def: 'A commit pushed to the PR after the run fixed it.' },
	{ key: 'fixed-later', label: 'Fixed later', group: 'fixed', def: 'Fixed on main after the merge, or someone filed a matching issue.' },
	{ key: 'not-acted-on', label: 'Not acted on', group: 'not', def: 'PR closed without merging, or merged 30+ days ago with no fix found.' },
	{ key: 'pending', label: 'Pending', group: 'open', def: 'PR still open, or merged within the last 30 days with no fix found yet.' },
	{ key: 'unclear', label: 'Unclear', group: 'open', def: 'A check failed or the model couldn\'t say.' },
	{ key: 'no-paths', label: 'No files named', group: 'open', def: 'The finding names no file, so main couldn\'t be checked.' },
];
const FILTERS = [['fixed', 'Fixed'], ['not', 'Not acted on'], ['open', 'Unresolved']];
const DECIDED_BY = {
	'diff+model': 'The diff, read by the model',
	'issue+model': 'A matching issue, confirmed by the model',
	'pr-open': 'PR is still open',
	'window': 'Merged under 30 days ago, no fix found yet',
	'closed-unmerged': 'PR closed without merging',
	'sha': 'A specific commit',
};
const TRIGGER = { auto: 'started automatically', explore: 'started by /explore' };
const HERO_COLOR = { 'fixed-in-pr': '#3B7D4F', 'not-acted-on': '#7D7568' };
const INK = '#2B2A27';
// Each severity needs about this many tracked findings before their rates are worth comparing.
const ENOUGH = 10;
const SEP = ' &middot; ';

const pct = (a, b) => `${Math.round(a / b * 100)}%`;
const codeSpans = text => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const day = (iso, year) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const time = (iso, year) => `<time datetime="${iso}">${day(iso, year)}</time>`;

/** Counts for `rows`; rows marked `dupOf` are dropped first and counted as `dups`. */
export function summarize(rows) {
	const own = rows.filter(r => !r.dupOf);
	const counts = Object.fromEntries(OUTCOMES.map(o => [o.key, own.filter(r => r.outcome === o.key).length]));
	const fixed = counts['fixed-in-pr'] + counts['fixed-later'];
	const resolved = fixed + counts['not-acted-on'];
	return { total: own.length, counts, fixed, resolved, unresolved: own.length - resolved, dups: rows.length - own.length };
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
		const style = `style="width:${+(share * 100).toFixed(2)}%"`;
		return big
			? `<a class="seg o-${o.key}" href="#evidence" data-filter="${o.group}" data-key="${o.key}" aria-label="${n} ${o.label}, show these findings" ${style}>${n}${share >= 0.2 ? `<span>${o.label}</span>` : ''}</a>`
			: `<span class="seg o-${o.key}" ${style}>${n}</span>`;
	}).join('');
}

function eyebrow(rows) {
	const dates = rows.map(r => r.postedAt?.slice(0, 10)).filter(Boolean).sort();
	const [from, to] = [dates[0], dates.at(-1)];
	const range = !from ? '' : from === to ? time(to, true)
		: `${time(from, from.slice(0, 4) !== to.slice(0, 4))} &ndash; ${time(to, true)}`;
	const triggers = {};
	for (const r of rows) {
		const t = TRIGGER[r.trigger] ?? 'trigger unknown';
		triggers[t] = (triggers[t] ?? 0) + 1;
	}
	const mixed = Object.keys(triggers).length > 1 ? Object.entries(triggers).map(([t, n]) => `${SEP}<span>${n} ${t}</span>`).join('') : '';
	return `<div class="eyebrow"><span class="chip-cmd">/explore</span>${range ? `<span>${range}</span>` : ''}${mixed}</div>`;
}

function header(rows, s) {
	const inPr = s.counts['fixed-in-pr'];
	const headline = inPr ? `Developers fixed <span class="green">${inPr}</span> ${inPr === 1 ? 'finding' : 'findings'} before merging.` : 'Developers fixed no findings before merging.';
	const prs = new Set(rows.map(r => r.pr)).size;
	const changed = new Set(rows.filter(r => r.outcome === 'fixed-in-pr' || r.outcome === 'fixed-later').map(r => r.pr)).size;
	const unchecked = s.counts.unclear + s.counts['no-paths'];
	const card = (label, num, side, note) => `<div class="card"><div class="label">${label}</div>`
		+ `<div class="card-num">${num}<span class="side">${side}</span></div><div class="note">${note}</div></div>`;
	return `<header>
${eyebrow(rows)}
<div class="lede"><h1>Does /explore change what ships?</h1><p class="headline">${headline}</p></div>
<div class="cards">
${card('Issues fixed', `<span class="big green">${s.fixed}</span>`, `${inPr} in the PR${SEP}${s.fixed - inPr} later`, 'Problems developers fixed after /explore flagged them.')}
${card('PRs changed', `<span class="big">${changed}</span>`, `of ${plural(prs, 'PR')}`, 'PRs where at least one /explore finding got fixed.')}
${card('Pending', `<span class="big">${s.counts.pending}</span>`, 'findings', 'PR still open, or merged in the last 30 days. Each resolves once a fix lands or the 30-day window closes.'
		+ (unchecked ? ` ${unchecked} more can't be checked (unclear or no files named).` : ''))}
</div>
</header>`;
}

function allBar(s, own) {
	const brackets = [
		s.resolved ? `<div class="bracket resolved" style="width:${pct(s.resolved, s.total)}"><b>Resolved</b><span>${SEP}${s.resolved}</span></div>` : '',
		s.unresolved ? `<div class="bracket unresolved" style="width:${pct(s.unresolved, s.total)}"><b>Unresolved</b><span>${SEP}${s.unresolved}</span></div>` : '',
	].join('');
	const present = OUTCOMES.filter(o => s.counts[o.key]);
	const legend = present.map(o => `<span><i class="o-${o.key}"></i>${o.label} <span class="n">${s.counts[o.key]}</span></span>`).join('');
	const details = present.map(o => `<div class="seg-detail" data-for="${o.key}" hidden><span class="hero" style="color:${HERO_COLOR[o.key] ?? INK}">${pct(s.counts[o.key], s.total)}</span>`
		+ `<div><div class="what"><b>${o.label}</b><span>${SEP}${s.counts[o.key]} of ${s.total} findings</span></div><div class="def">${escapeHtml(o.def)}</div></div></div>`).join('');
	return `<section aria-labelledby="all-h">
<h2 id="all-h">Findings by outcome</h2>
<div class="all">
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
	const few = per.some(p => p.s.resolved < ENOUGH) ? ' Too few so far to compare severities.' : '';
	const rows = per.map(({ label, list, s }) => {
		const rate = s.resolved ? `<div class="pct green">${pct(s.fixed, s.resolved)}</div>` : '<div class="pct none" aria-label="No data">&ndash;</div>';
		if (!s.total) {
			return `<div class="grid-row sev-row"><div class="name">${label}</div>${rate}<div class="grow empty">No ${label} findings in this period</div><div class="end"></div></div>`;
		}
		const open = OUTCOMES.filter(o => o.group === 'open' && s.counts[o.key]).map(o => `${s.counts[o.key]} ${o.label.toLowerCase()}`).join(SEP);
		const fixedOf = s.resolved ? `${s.fixed} of ${s.resolved} tracked` : 'None tracked yet';
		return `<div class="grid-row sev-row"><div class="name">${label}</div>${rate}<div class="grow bar mid">${segments(list)}</div>`
			+ `<div class="end"><span>${fixedOf}</span>${open ? `<span class="small">${open} not yet tracked</span>` : ''}</div></div>`;
	}).join('\n');
	return `<section aria-labelledby="sev-h">
<div class="sec-head"><h2 id="sev-h">Fix rate by severity</h2><p class="sub">% fixed = fixed &divide; findings we could track.${few}</p></div>
<div class="rows">
<div class="grid-row cols" aria-hidden="true"><span class="name">Severity</span><span class="pct">% fixed</span><span class="grow">Outcomes</span><span class="end">Fixed of tracked</span></div>
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
		const parts = [s.fixed ? `${s.fixed} fixed` : '', s.counts['not-acted-on'] ? `${s.counts['not-acted-on']} not acted on` : '', s.unresolved ? `${s.unresolved} open` : ''].filter(Boolean);
		return `<div class="grid-row pr"><a class="name mono" href="${REPO_URL}/pull/${Number(pr)}">#${Number(pr)}</a><span class="pct small">${plural(list.length, 'finding')}</span>`
			+ `<div class="grow bar mid">${segments(list)}</div><span class="end small">${parts.join(SEP)}</span></div>`;
	}).join('\n');
	return accordion('pr', 'By PR', plural(byPr.size, 'PR'), `<div class="rows">${rows}</div>`);
}

function findingRow(r, n) {
	const ev = splitEvidence(r.evidence);
	const report = safeUrl(r.reportUrl);
	const pr = Number(r.pr);
	const dl = [
		['Decided by', DECIDED_BY[r.decidedBy] ? escapeHtml(DECIDED_BY[r.decidedBy]) : '&mdash;'],
		ev.commits.length ? [ev.where === 'main' ? 'Commits on main' : 'Commits on the PR', ev.commits.map(c => `<a class="chip" href="${REPO_URL}/commit/${c}">${c}</a>`).join(' ')] : null,
		ev.issue ? ['Issue', `<a class="chip" href="${REPO_URL}/issues/${ev.issue}">#${ev.issue}</a>`] : null,
		r.paths?.length ? ['Files', r.paths.map(p => `<code class="chip">${escapeHtml(p)}</code>`).join(' ')] : null,
		['Run', `<span class="mono">${escapeHtml(r.run)}#${escapeHtml(r.finding)}</span>${SEP}${TRIGGER[r.trigger] ?? 'trigger unknown'}${SEP}skill ${escapeHtml(r.skillVersion ?? '?')}${SEP}${escapeHtml(r.model ?? '?')}`],
	].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
	const links = [report ? `<a href="${escapeHtml(report)}">Open report</a>` : '', `<a href="${REPO_URL}/pull/${pr}">Open PR</a>`].join('');
	return `<div class="finding"><button type="button" class="row" aria-expanded="false" aria-controls="d${n}">`
		+ `<span class="num">${n}</span><span class="title"><span>${codeSpans(r.title)}</span>${r.dupMaybe ? '<span class="maybe">Possible duplicate</span>' : ''}</span>`
		+ `<span class="mono link">#${pr}</span><span class="sev">${escapeHtml(SEVERITY_LABEL[r.severity] ?? r.severity ?? '')}</span><span class="sign" aria-hidden="true">+</span></button>`
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
	const counts = { fixed: s.fixed, not: s.counts['not-acted-on'], open: s.unresolved };
	const filters = [`<button type="button" class="filter" data-filter="all" aria-pressed="true">All ${s.total}</button>`,
		...FILTERS.filter(([k]) => counts[k]).map(([k, label]) => `<button type="button" class="filter" data-filter="${k}" aria-pressed="false">${label} ${counts[k]}</button>`)].join('');
	const controls = `<div class="controls"><div role="group" aria-label="Filter by outcome">${filters}</div><button type="button" class="toggle-all">Expand all</button></div>`;
	return accordion('ev', 'Evidence', plural(s.total, 'finding'), `${controls}\n${groups}`, ' id="evidence"');
}

function footer(s) {
	const dups = s.dups ? `${plural(s.dups, 'duplicate')} of earlier runs left out.` : 'Duplicates of earlier runs are left out.';
	return `<footer><span>Generated ${time(s.now, true)}</span>${SEP}<span>${dups}</span></footer>`;
}

const CSS = `
body{margin:0;background:#F5F4F0;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#2B2A27}
a{color:#2F6B55}a:not(.seg):hover{color:#1F4D3D}
main{padding:56px 24px 96px}
.page{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:64px}
.mono,.n,code,.chip,.seg,.num,.sign{font-family:'IBM Plex Mono',monospace}
h1,h2{font-family:'Source Serif 4',Georgia,serif;margin:0}
h1{font-size:46px;line-height:1.1;font-weight:500;letter-spacing:-0.01em}
h2{font-size:24px;line-height:1.3;font-weight:600}
.green{color:#3B7D4F;font-weight:600}
.small{font-size:13px;color:#5A5751}
.label,.bracket b,.cols{font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase}
header{display:flex;flex-direction:column}
.eyebrow{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:#6B6862;margin-bottom:16px}
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
.all{display:flex;flex-direction:column;gap:8px}
.brackets{display:flex;gap:3px}
.bracket{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;min-width:0;white-space:nowrap;overflow:hidden}
.bracket span{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5A5751}
.bracket.resolved{border-bottom:2px solid #2B2A27}
.bracket.unresolved{border-bottom:2px solid #B5B1A7}.bracket.unresolved b{color:#5A5751}
.bar{display:flex;min-width:0}
.bar.big{height:56px;gap:3px}
.bar.mid{height:24px;gap:2px}
.seg{box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;border-radius:3px;font-size:12px}
.bar.big .seg{border-radius:0;gap:10px;padding:0 12px;font-size:18px;font-weight:500;text-decoration:none;transition:opacity .15s}
.bar.big .seg:has(span){justify-content:flex-start}
.bar.big .seg:first-child{border-top-left-radius:6px;border-bottom-left-radius:6px}.bar.big .seg:last-child{border-top-right-radius:6px;border-bottom-right-radius:6px}
.bar.big .seg span{font-family:'IBM Plex Sans',sans-serif;font-size:14px}
.bar.big .seg:focus-visible{outline:2px solid #2B2A27;outline-offset:2px}
.bar.big:has(.seg:hover,.seg:focus-visible) .seg:not(:hover,:focus-visible){opacity:.35}
.o-fixed-in-pr{background:#3B7D4F;color:#FFF}
.o-fixed-later{background:#9CC7A6;color:#1F3D28}
.o-not-acted-on{background:#7D7568;color:#FFF}
.o-pending{background:#DCD8CE;color:#5A5751}
.o-unclear{background:repeating-linear-gradient(135deg,#E6E2D9 0 5px,#D3CEC2 5px 10px);color:#3A3833}
.o-no-paths{background:#EEEBE4;color:#5A5751;border:1.5px dashed #B5B1A7}
.under{min-height:72px;display:flex;align-items:center}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px;color:#5A5751}
.legend>span{display:flex;align-items:center;gap:6px}
i[class^=o-]{display:inline-block;width:12px;height:12px;border-radius:2px;box-sizing:border-box}
.n{color:#7A766F;font-weight:400}
.legend[hidden],.seg-detail[hidden],.group[hidden],.acc-body[hidden],.detail[hidden]{display:none}
.seg-detail{display:flex;align-items:center;gap:20px;min-width:0}
.hero{flex:0 0 auto;font-family:'Source Serif 4',Georgia,serif;font-size:48px;font-weight:600;line-height:1}
.seg-detail>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.what{font-size:15px}.what span{color:#6B6862}
.def{font-size:14px;color:#3A3833}
.rows{display:flex;flex-direction:column;border-top:1px solid #2B2A27}
.grid-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;padding:12px 0;box-sizing:border-box;border-bottom:1px solid #E4E1D9}
.grid-row .name{flex:0 0 120px}.grid-row .pct{flex:0 0 160px}.grid-row .grow{flex:1 1 280px;min-width:0}
.grid-row .end{flex:0 0 240px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}
.cols{padding:0 0 8px;color:#6B6862;border-bottom:0}
.sev-row{min-height:64px}.sev-row .name{font-size:16px;font-weight:600}
.sev-row .pct{font-size:28px;line-height:1}.sev-row .pct.none{font-size:18px;font-weight:400;color:#B5B1A7}
.sev-row .end span:first-child{font-size:14px}.sev-row .end .small{font-size:12px;color:#7A766F}
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
`;

// Accordions, filters, segment clicks, the bar's hover detail and expanding rows. Without it everything shows expanded (see the noscript style).
const SCRIPT = `
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const rows = () => $$('.finding .row');
const setOpen = (b, open) => { b.setAttribute('aria-expanded', open); const sign = b.querySelector('.sign'); if (sign) { sign.textContent = open ? '\\u2212' : '+'; } document.getElementById(b.getAttribute('aria-controls')).hidden = !open; };
const toggleAll = $('.toggle-all');
const sync = () => { toggleAll.textContent = rows().some(b => b.getAttribute('aria-expanded') === 'true') ? 'Collapse all' : 'Expand all'; };
const filter = key => {
	$$('.filter').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === key));
	$$('.group').forEach(g => { g.hidden = key !== 'all' && g.dataset.group !== key; });
};
const legend = $('.legend');
const show = key => {
	legend.hidden = !!key;
	$$('.seg-detail').forEach(d => { d.hidden = d.dataset.for !== key; });
};
$$('.bar.big .seg').forEach(a => {
	a.addEventListener('mouseenter', () => show(a.dataset.key));
	a.addEventListener('focus', () => show(a.dataset.key));
	a.addEventListener('mouseleave', () => show(document.activeElement?.closest?.('.bar.big') ? document.activeElement.dataset.key : null));
	a.addEventListener('blur', () => show(null));
	a.addEventListener('click', () => { setOpen($('#ev-h .acc'), true); filter(a.dataset.filter); });
});
document.addEventListener('click', e => {
	const acc = e.target.closest('.acc');
	const row = e.target.closest('.finding .row');
	const f = e.target.closest('.filter');
	if (acc) { setOpen(acc, acc.getAttribute('aria-expanded') !== 'true'); }
	else if (row) { setOpen(row, row.getAttribute('aria-expanded') !== 'true'); sync(); }
	else if (f) { filter(f.dataset.filter); }
	else if (e.target === toggleAll) { const open = toggleAll.textContent === 'Expand all'; rows().forEach(b => setOpen(b, open)); sync(); }
});
`;

/** The whole page for `rows`, as outcomes.mjs writes them. */
export function renderOutcomesPage(rows, { now = new Date() } = {}) {
	const own = rows.filter(r => !r.dupOf);
	const s = { ...summarize(rows), now: now.toISOString().slice(0, 10) };
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>/explore outcomes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&amp;display=swap">
<style>${CSS}</style>
<noscript><style>.acc-body[hidden]{display:block}#ev-body[hidden]{display:flex;flex-direction:column;gap:32px}.detail[hidden]{display:flex}.controls,.acc svg{display:none}</style></noscript></head>
<body><main><div class="page">
${header(own, s)}
${allBar(s, own)}
${severityRows(own)}
<div class="accordion">
${prRows(own)}
${evidence(own, s)}
</div>
${footer(s)}
</div></main>
<script>${SCRIPT}</script>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
	process.stdout.write(renderOutcomesPage(rows));
}
