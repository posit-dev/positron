/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One HTML page from the rows outcomes.mjs writes: how many findings we could
// check got fixed, by severity and by PR, then the evidence for each.
//   node outcomes-page.mjs rows.jsonl > outcomes.html

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO_URL, SEVERITY_LABEL } from '../../../.claude/skills/exploratory-test/renderer/page/page-common.mjs';
import { escapeHtml, safeUrl } from '../../../.claude/skills/exploratory-test/renderer/shared/text.mjs';

// In this order everywhere. `group` is the evidence filter: fixed, not acted on, or can't check yet.
const OUTCOMES = [
	{ key: 'fixed-in-pr', label: 'Fixed in the PR', group: 'fixed', def: 'A commit pushed to the PR after the run fixed it.' },
	{ key: 'fixed-later', label: 'Fixed later', group: 'fixed', def: 'Fixed on main after the merge, or someone filed a matching issue.' },
	{ key: 'not-acted-on', label: 'Not acted on', group: 'not', def: 'PR closed without merging, or merged 60+ days ago with no fix found.' },
	{ key: 'pending', label: 'Pending', group: 'open', def: 'PR still open, or merged within the last 60 days with no fix found yet.' },
	{ key: 'unclear', label: 'Unclear', group: 'open', def: 'A check failed or the model couldn\'t say.' },
	{ key: 'no-paths', label: 'No files named', group: 'open', def: 'The finding names no file, so main couldn\'t be checked.' },
];
const FILTERS = [['fixed', 'Fixed'], ['not', 'Not acted on'], ['open', 'Can\'t check yet']];
const DECIDED_BY = {
	'diff+model': 'The diff, read by the model',
	'issue+model': 'A matching issue, confirmed by the model',
	'pr-open': 'PR is still open',
	'window': 'Merged under 60 days ago, no fix found yet',
	'closed-unmerged': 'PR closed without merging',
	'sha': 'A specific commit',
};
const TRIGGER = { auto: 'started automatically', explore: 'started by /explore' };
// Each severity needs about this many checked findings before their rates are worth comparing.
const ENOUGH = 10;
const SEP = ' &middot; ';

const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : 'n/a';
const codeSpans = text => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Counts for `rows`; rows marked `dupOf` are dropped first and counted as `dups`. */
export function summarize(rows) {
	const own = rows.filter(r => !r.dupOf);
	const counts = Object.fromEntries(OUTCOMES.map(o => [o.key, own.filter(r => r.outcome === o.key).length]));
	const fixed = counts['fixed-in-pr'] + counts['fixed-later'];
	const checked = fixed + counts['not-acted-on'];
	return { total: own.length, counts, fixed, checked, open: own.length - checked, dups: rows.length - own.length };
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

/** The non-zero can't-check-yet counts, as "7 pending, 1 unclear". */
function openParts(s) {
	return OUTCOMES.filter(o => o.group === 'open' && s.counts[o.key]).map(o => `${s.counts[o.key]} ${o.label.toLowerCase()}`);
}

/** Stacked segments for `rows`, leaving out outcomes with none. */
function segments(rows, { counts = false, labels = false, links = false } = {}) {
	const s = summarize(rows);
	return OUTCOMES.filter(o => s.counts[o.key]).map(o => {
		const n = s.counts[o.key];
		const share = n / s.total;
		const tip = escapeHtml(`${n} ${o.label}: ${o.def}`);
		const inner = counts ? `${n}${labels && share >= 0.2 ? `<span>${o.label}</span>` : ''}` : '';
		const style = `style="width:${+(share * 100).toFixed(2)}%"`;
		return links
			? `<a class="seg o-${o.key}" href="#ev-h" data-filter="${o.group}" title="${tip}" ${style}>${inner}</a>`
			: `<span class="seg o-${o.key}" title="${tip}" ${style}>${inner}</span>`;
	}).join('');
}

function header(rows, s) {
	const prs = new Set(rows.map(r => r.pr)).size;
	const dates = rows.map(r => r.postedAt?.slice(0, 10)).filter(Boolean).sort();
	const range = dates.length ? `${SEP}${dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} to ${dates.at(-1)}`}` : '';
	const triggers = {};
	for (const r of rows) {
		const t = TRIGGER[r.trigger] ?? 'trigger unknown';
		triggers[t] = (triggers[t] ?? 0) + 1;
	}
	const kinds = Object.keys(triggers);
	const trigger = kinds.length === 1 ? `All runs ${kinds[0]}` : kinds.map(k => `${triggers[k]} ${k}`).join(SEP);
	const inPr = s.counts['fixed-in-pr'];
	const open = openParts(s);
	const footnote = `${s.fixed} of ${s.checked} checked findings fixed, out of ${s.total} total${open.length ? `; ${open.join(', ')}` : ''}.`
		+ (s.dups ? ` ${s.dups} duplicates of earlier runs left out.` : ' Duplicates of earlier runs are left out.');
	const serious = rows.filter(r => (r.outcome === 'fixed-in-pr' || r.outcome === 'fixed-later') && (r.severity === 'major' || r.severity === 'moderate')).length;
	const checkedPct = pct(s.checked, s.total) === 'n/a' ? '0%' : pct(s.checked, s.total);
	const card = (label, num, side, note, extra = '') => `<div class="card"><div class="card-label">${label}</div>`
		+ `<div class="card-num"><span>${num}</span> <span class="side">${side}</span></div>${extra}<div class="note">${note}</div></div>`;
	return `<header>
<div class="meta"><span class="chip-cmd">/explore</span><span>Outcome report</span><span>${plural(prs, 'PR')}${range}</span><span>${trigger}</span><span>Generated ${s.now}</span></div>
<div class="lede"><h1>What happens after /explore finds something</h1>
<p class="headline"><b>${pct(s.fixed, s.checked)}</b> of findings we could check get fixed, <b>${pct(inPr, s.fixed)}</b> before the PR even merges.</p>
<p class="footnote">${footnote}</p></div>
<div class="cards">
${card('Issues fixed', `<span class="green">${s.fixed}</span>`, `${inPr} in the PR${SEP}${s.fixed - inPr} later`,
		serious ? `${serious} of them were Moderate or Major, real bugs, not just polish.` : 'All were Minor this period.')}
${card('Not acted on', s.counts['not-acted-on'], 'findings',
			s.counts['not-acted-on'] ? `${s.counts['not-acted-on']} of ${s.checked} checked findings were left as is.` : 'Every finding we could check was acted on. None were left as is.')}
${card('Checked so far', checkedPct, `${s.checked} of ${s.total}`, `The fix rate is based on these.${open.length ? ` The rest: ${open.join(', ')}.` : ''}`,
				`<div class="progress"><div style="width:${checkedPct}"></div></div>`)}
</div>
</header>`;
}

function allBar(s, own) {
	const brackets = [
		s.checked ? `<div class="bracket checked" style="width:${pct(s.checked, s.total)}"><b>Checked</b> <span>${s.checked}${SEP}${s.fixed === s.checked ? 'all fixed' : `${s.fixed} fixed`}</span></div>` : '',
		s.open ? `<div class="bracket open" style="width:${pct(s.open, s.total)}"><b>Can't check yet</b> <span>${s.open}</span></div>` : '',
	].join('');
	const legend = OUTCOMES.map(o => `<span title="${escapeHtml(o.def)}"><i class="o-${o.key}"></i>${o.label} <span class="n">${s.counts[o.key]}</span></span>`).join('');
	return `<section aria-labelledby="all-h">
<div class="sec-head"><h2 id="all-h">All ${s.total} findings by outcome</h2><span class="sub">Click a segment to filter the evidence.</span></div>
<div class="brackets">${brackets}</div>
<div class="bar big">${segments(own, { counts: true, labels: true, links: true })}</div>
<div class="legend">${legend}</div>
</section>`;
}

function severityRows(own) {
	const per = Object.keys(SEVERITY_LABEL).map(key => {
		const list = own.filter(r => r.severity === key);
		return { label: SEVERITY_LABEL[key], list, s: summarize(list) };
	});
	const few = per.some(p => p.s.checked < ENOUGH) ? ' Too few so far to compare severities.' : '';
	const rows = per.map(({ label, list, s }) => {
		const under = s.total === 0 ? '0 findings' : s.checked ? `${s.fixed} of ${s.checked} we could check` : 'none we could check yet';
		const parts = [`${s.fixed} of ${s.total} fixed overall`, s.counts['not-acted-on'] ? `${s.counts['not-acted-on']} not acted on` : '', s.open ? `${s.open} can't check yet` : ''].filter(Boolean);
		const bar = s.total
			? `<div class="bar mid">${segments(list, { counts: true })}</div><span class="sub small">${parts.join(SEP)}</span>`
			: `<div class="empty">No ${label} findings in this period</div>`;
		return `<div class="sev-row"><div class="sev-name">${label}</div><div class="sev-pct"><span class="${s.checked ? 'green' : 'grey'}">${pct(s.fixed, s.checked)}</span><span class="small">${under}</span></div><div class="sev-bar">${bar}</div></div>`;
	}).join('\n');
	return `<section aria-labelledby="sev-h">
<div class="sec-head"><h2 id="sev-h">Fix rate by severity</h2><span class="sub">% fixed = fixed / findings we could check.${few}</span></div>
<div class="rows">${rows}</div>
</section>`;
}

function prRows(own) {
	const byPr = new Map();
	for (const r of own) {
		byPr.set(r.pr, [...(byPr.get(r.pr) ?? []), r]);
	}
	const rows = [...byPr].sort(([a, x], [b, y]) => y.length - x.length || b - a).map(([pr, list]) => {
		const s = summarize(list);
		const parts = [s.fixed ? `${s.fixed} fixed` : '', s.counts['not-acted-on'] ? `${s.counts['not-acted-on']} not acted on` : '', s.open ? `${s.open} open` : ''].filter(Boolean);
		return `<div class="pr-row"><a class="mono" href="${REPO_URL}/pull/${Number(pr)}">#${Number(pr)}</a><span class="pr-n">${plural(list.length, 'finding')}</span><div class="bar thin">${segments(list)}</div><span class="pr-sum">${parts.join(SEP)}</span></div>`;
	}).join('\n');
	return `<section aria-labelledby="pr-h">
<div class="sec-head"><h2 id="pr-h">By PR</h2><span class="sub">Most findings first.</span></div>
<div class="rows">${rows}</div>
</section>`;
}

function findingRow(r, n) {
	const ev = splitEvidence(r.evidence);
	const report = safeUrl(r.reportUrl);
	const pr = Number(r.pr);
	const dl = [
		['Decided by', escapeHtml(DECIDED_BY[r.decidedBy] ?? r.decidedBy ?? 'n/a')],
		ev.commits.length ? [ev.where === 'main' ? 'Commits on main' : 'Commits on the PR', ev.commits.map(c => `<a class="chip" href="${REPO_URL}/commit/${c}">${c}</a>`).join(' ')] : null,
		ev.issue ? ['Issue', `<a class="chip" href="${REPO_URL}/issues/${ev.issue}">#${ev.issue}</a>`] : null,
		r.paths?.length ? ['Files', r.paths.map(p => `<code class="chip">${escapeHtml(p)}</code>`).join(' ')] : null,
		['Run', `<span class="mono">${escapeHtml(r.run)}#${escapeHtml(r.finding)}</span>${SEP}${TRIGGER[r.trigger] ?? 'trigger unknown'}${SEP}skill ${escapeHtml(r.skillVersion ?? '?')}${SEP}${escapeHtml(r.model ?? '?')}`],
	].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
	const links = [report ? `<a href="${escapeHtml(report)}">Open report</a>` : '', `<a href="${REPO_URL}/pull/${pr}">Open PR</a>`].join('');
	return `<div class="finding"><button type="button" class="row" aria-expanded="false" aria-controls="d${n}">`
		+ `<span class="num">${n}</span><span class="title">${codeSpans(r.title)}${r.dupMaybe ? '<span class="maybe">Possible duplicate</span>' : ''}</span>`
		+ `<span class="mono link">#${pr}</span><span class="sev">${escapeHtml(SEVERITY_LABEL[r.severity] ?? r.severity ?? '')}</span><span class="sign" aria-hidden="true">+</span></button>`
		+ `<div class="detail" id="d${n}" hidden>${ev.text ? `<p class="ev">${codeSpans(ev.text)}</p>` : ''}<dl>${dl}</dl><div class="links">${links}</div></div></div>`;
}

function evidence(own, s) {
	let n = 0;
	const groups = OUTCOMES.map(o => {
		const items = own.filter(r => r.outcome === o.key);
		return items.length
			? `<div class="group" data-group="${o.group}"><div class="group-head"><i class="o-${o.key}"></i><h3>${o.label} <span>(${items.length})</span></h3><span class="sub">${escapeHtml(o.def)}</span></div>`
			+ `<div class="rows">${items.map(r => findingRow(r, ++n)).join('\n')}</div></div>`
			: '';
	}).join('\n');
	const counts = { fixed: s.fixed, not: s.counts['not-acted-on'], open: s.open };
	const filters = [`<button type="button" class="filter" data-filter="all" aria-pressed="true">All ${s.total}</button>`,
		...FILTERS.filter(([k]) => counts[k]).map(([k, label]) => `<button type="button" class="filter" data-filter="${k}" aria-pressed="false">${label} ${counts[k]}</button>`)].join('');
	return `<section aria-labelledby="ev-h">
<div class="sec-head"><h2 id="ev-h">Evidence</h2><div class="controls"><div role="group" aria-label="Filter by outcome">${filters}</div><button type="button" class="toggle-all">Expand all</button></div></div>
${groups}
</section>`;
}

const CSS = `
body{margin:0;background:#fff;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#17191C}
a{color:#1E5A86}a:hover{color:#123E5E}
main{padding:56px 24px 96px}
.page{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:64px}
.mono,.n,code,.chip,.seg,.num,.sign{font-family:'IBM Plex Mono',monospace}
header{display:flex;flex-direction:column;gap:28px}
.meta{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;font-size:13px;color:#5B636B}
.chip-cmd{font-family:'IBM Plex Mono',monospace;font-weight:500;color:#17191C;background:#F1F2F4;padding:4px 8px;border-radius:4px}
.lede{display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:44px;line-height:1.1;font-weight:600;letter-spacing:-0.01em;max-width:720px}
.headline{margin:0;font-size:22px;line-height:1.4;font-weight:500;max-width:720px}
.headline b,.green{color:#1E6B4F;font-weight:600}
.grey{color:#6B737B}
.footnote{margin:0;font-size:15px;line-height:1.5;color:#5B636B;max-width:680px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}
.card{padding:20px 22px;border:1px solid #E3E5E8;border-radius:10px;display:flex;flex-direction:column;gap:8px}
.card-label{font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#4A5159}
.card-num{display:flex;align-items:baseline;gap:10px}
.card-num>span:first-child{font-size:40px;font-weight:600;line-height:1}
.side{font-size:14px;color:#4A5159}
.note{font-size:14px;line-height:1.45;color:#4A5159}
.progress{height:6px;background:#ECEEF0;border-radius:3px;overflow:hidden}.progress div{height:6px;background:#17191C}
section{display:flex;flex-direction:column;gap:16px}
.sec-head{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline;justify-content:space-between}
h2{margin:0;font-size:22px;font-weight:600}
.sub{font-size:14px;color:#5B636B}.small{font-size:13px}
.brackets{display:flex;gap:3px;font-size:13px;margin-bottom:-6px}
.bracket{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;min-width:0;white-space:nowrap;overflow:hidden}
.bracket b{font-weight:600;letter-spacing:0.06em;text-transform:uppercase}
.bracket span{font-family:'IBM Plex Mono',monospace;color:#4A5159}
.bracket.checked{border-bottom:2px solid #17191C}
.bracket.open{border-bottom:2px solid #9AA1A9}.bracket.open b{color:#4A5159}
.bar{display:flex}
.bar.big{height:56px;gap:3px}
.bar.mid{height:28px;gap:2px}
.bar.thin{height:20px;gap:2px;flex:1 1 280px;min-width:160px}
.seg{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;overflow:hidden;white-space:nowrap;text-decoration:none;border-radius:3px;font-size:13px}
.bar.big .seg{border-radius:0;padding:0 12px;font-size:18px;font-weight:500}
.bar.big .seg:has(span){justify-content:flex-start}
.bar.big .seg:first-child{border-radius:6px 0 0 6px}.bar.big .seg:last-child{border-top-right-radius:6px;border-bottom-right-radius:6px}
.bar.big .seg span{font-family:'IBM Plex Sans',sans-serif;font-size:14px}
.bar.thin .seg{border-radius:2px}
.o-fixed-in-pr{background:#1E6B4F;color:#fff}
.o-fixed-later{background:#9FD3B9;color:#0F3D2C}
.o-not-acted-on{background:#C2410C;color:#fff}
.o-pending{background:#fff;color:#4A5159;border:1.5px dashed #8A929B}
.o-unclear{background:repeating-linear-gradient(135deg,#D6DADF 0 5px,#C4C9D0 5px 10px);color:#17191C}
.o-no-paths{background:#D6DADF;color:#17191C}
a.seg:hover{filter:brightness(0.95)}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px;color:#4A5159}
.legend>span{display:flex;align-items:center;gap:6px}
.legend i,.group-head i{display:inline-block;width:12px;height:12px;border-radius:2px;box-sizing:border-box}
.n{color:#6B737B}
.rows{display:flex;flex-direction:column;border-top:1px solid #17191C}
.sev-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px 32px;padding:20px 0;border-bottom:1px solid #E3E5E8}
.sev-name{flex:0 0 120px;font-size:17px;font-weight:600}
.sev-pct{flex:0 0 170px;display:flex;flex-direction:column;gap:2px;color:#4A5159}
.sev-pct>span:first-child{font-size:34px;font-weight:600;line-height:1}
.sev-bar{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:6px}
.empty{height:28px;box-sizing:border-box;border:1px solid #E3E5E8;border-radius:3px;display:flex;align-items:center;padding-left:12px;font-size:13px;color:#6B737B}
.pr-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;padding:14px 0;border-bottom:1px solid #E3E5E8}
.pr-row>a{flex:0 0 80px;font-size:14px}
.pr-n{flex:0 0 100px;font-size:14px;color:#4A5159}
.pr-sum{flex:0 0 170px;text-align:right;font-size:13px;color:#4A5159}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.controls [role=group]{display:flex;flex-wrap:wrap;gap:6px}
.filter{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid #C9CDD2;background:#fff;color:#2A2F34;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer}
.filter[aria-pressed=true]{border-color:#17191C;background:#17191C;color:#fff}
.toggle-all{min-height:36px;padding:0 12px;margin-left:8px;border:0;background:transparent;color:#1E5A86;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer;text-decoration:underline}
.group{display:flex;flex-direction:column;margin-top:12px}
.group[hidden]{display:none}
.group-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding-bottom:12px}
.group-head i{width:14px;height:14px;border-radius:3px}
h3{margin:0;font-size:18px;font-weight:600}h3 span{font-weight:400;color:#5B636B}
.finding{border-bottom:1px solid #E3E5E8}
.row{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:14px 4px;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit;min-height:52px}
.num{flex:0 0 28px;font-size:14px;color:#5B636B}
.title{flex:1 1 380px;min-width:0;font-size:16px;line-height:1.4;font-weight:500;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.maybe{font-size:12px;font-weight:400;color:#7A3E00;background:#FDF0E1;padding:2px 8px;border-radius:999px}
.link{flex:0 0 70px;font-size:14px;color:#1E5A86}
.sev{flex:0 0 76px;font-size:14px;color:#2A2F34}
.sign{flex:0 0 16px;font-size:16px;color:#5B636B}
.detail{padding:0 4px 22px 48px;display:flex;flex-direction:column;gap:12px}
.detail[hidden]{display:none}
.ev{margin:0;font-size:15px;line-height:1.6;color:#2A2F34;max-width:820px}
code{font-size:13px;background:#F1F2F4;padding:1px 5px;border-radius:3px}
dl{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;font-size:13px;color:#4A5159;max-width:820px}
dt{color:#6B737B}dd{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.chip{font-size:12px;color:#2A2F34;border:1px solid #E3E5E8;padding:1px 6px;border-radius:3px;text-decoration:none}
code.chip{background:#F1F2F4;border:0}
.links{display:flex;gap:16px;font-size:13px}
`;

// Filters, segment clicks and expanding rows. Without it every row shows expanded (see the noscript style).
const SCRIPT = `
const rows = () => [...document.querySelectorAll('.finding .row')];
const setOpen = (b, open) => { b.setAttribute('aria-expanded', open); b.querySelector('.sign').textContent = open ? '-' : '+'; document.getElementById(b.getAttribute('aria-controls')).hidden = !open; };
const toggleAll = document.querySelector('.toggle-all');
const sync = () => { toggleAll.textContent = rows().some(b => b.getAttribute('aria-expanded') === 'true') ? 'Collapse all' : 'Expand all'; };
const filter = key => {
	document.querySelectorAll('.filter').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === key));
	document.querySelectorAll('.group').forEach(g => { g.hidden = key !== 'all' && g.dataset.group !== key; });
};
document.addEventListener('click', e => {
	const row = e.target.closest('.finding .row');
	const f = e.target.closest('[data-filter]');
	if (row) { setOpen(row, row.getAttribute('aria-expanded') !== 'true'); sync(); }
	else if (f) { filter(f.dataset.filter); }
	else if (e.target === toggleAll) { const open = toggleAll.textContent === 'Expand all'; rows().forEach(b => setOpen(b, open)); sync(); }
});
`;

/** The whole page for `rows`, as outcomes.mjs writes them. */
export function renderOutcomesPage(rows, { now = new Date() } = {}) {
	const own = rows.filter(r => !r.dupOf);
	const s = { ...summarize(rows), now: now.toLocaleDateString('en-CA') };
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>/explore outcome report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;display=swap">
<style>${CSS}</style>
<noscript><style>.detail[hidden]{display:flex}.controls{display:none}</style></noscript></head>
<body><main><div class="page">
${header(own, s)}
${allBar(s, own)}
${severityRows(own)}
${prRows(own)}
${evidence(own, s)}
</div></main>
<script>${SCRIPT}</script>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
	process.stdout.write(renderOutcomesPage(rows));
}
