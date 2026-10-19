/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// What the two /explore pages on Connect share: the page switch, the date
// range button and its menu, the accordion, the footer and their styles.
// Shipping impact is outcomes-page.mjs; Triage outcomes is triage-page.mjs.

import { REPO_URL } from '../../../.claude/skills/exploratory-test/renderer/page/page-common.mjs';

export const PAGES = {
	impact: { label: 'Shipping impact', url: 'https://connect.posit.it/explore-outcomes/' },
	triage: { label: 'Triage outcomes', url: 'https://connect.posit.it/explore-triage/' },
};
export const PRESETS = [['7d', 'Last 7 days', 7], ['30d', 'Last 30 days', 30], ['90d', 'Last 90 days', 90], ['all', 'All time']];

export const day = (iso, year) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
export const time = (iso, year) => `<time datetime="${iso}">${day(iso, year)}</time>`;

export function minusDays(iso, n) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

export function isDay(v) {
	const t = Date.parse(`${v}T00:00:00Z`);
	return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(t) && new Date(t).toISOString().startsWith(v);
}

/** The window for `?range=` (7d, 30d, 90d, all, or from..to), given the rows' dates and the generated date; 30 days if invalid. */
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

export function rangeText({ from, to }, plain) {
	const [f, t] = plain ? [day, day] : [time, time];
	return from === to ? t(to, true) : `${f(from, from.slice(0, 4) !== to.slice(0, 4))} &ndash; ${t(to, true)}`;
}

/** A section that starts collapsed behind a full-width button in its heading. */
export function accordion(id, title, count, body, attrs = '') {
	return `<section aria-labelledby="${id}-h"${attrs}>
<h2 id="${id}-h"><button type="button" class="acc" aria-expanded="false" aria-controls="${id}-body"><span>${title}<span class="count">${count}</span></span>`
		+ '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#5A5751" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5l5 5 5-5"/></svg></button></h2>'
		+ `\n<div class="acc-body" id="${id}-body" hidden>\n${body}\n</div>\n</section>`;
}

/** The view functions the browser needs a copy of, for each page's VIEW_SOURCE. */
export const SHARED_VIEW = { day, time, minusDays, isDay, resolveRange, rangeText, accordion };
export const SHARED_CONSTS = { PRESETS, REPO_URL, PAGES };

/** The flat chip that switches between the two pages; plain links, so it works without JavaScript. */
export function pageSwitch(current) {
	const link = key => key === current
		? `<a aria-current="page" href="${PAGES[key].url}">${PAGES[key].label}</a>`
		: `<a class="switch-link" href="${PAGES[key].url}">${PAGES[key].label}</a>`;
	return `<nav class="switch" aria-label="Report"><span class="cmd">/explore</span><span class="pages">${Object.keys(PAGES).map(link).join('')}</span></nav>`;
}

const CHECK = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#3B7D4F" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5l2.5 2.5L11 4.5"/></svg>';

/** The date range button and its menu; inert until the script enables it. */
export function picker(range, dates, now) {
	const item = (key, label) => `<button type="button" role="menuitemradio" data-range="${key}" aria-checked="${range.key === key}" tabindex="-1"><span>${label}</span>${CHECK}</button>`;
	return `<span class="range"><button type="button" class="range-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Date range: ${rangeText(range, true)}" disabled>`
		+ `<span class="range-label">${rangeText(range)}</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#6B6862" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5L7 9l3.5-3.5"/></svg></button>`
		+ '<div class="range-menu" role="menu" aria-label="Date range" hidden>'
		+ PRESETS.map(([key, label]) => item(key, label)).join('')
		+ `<div class="sep" role="separator"></div>${item('custom', 'Custom range&hellip;')}`
		+ `<div class="custom" hidden><label for="range-from">From</label><input id="range-from" type="date" min="${dates[0] ?? now}" max="${now}">`
		+ `<label for="range-to">To</label><input id="range-to" type="date" min="${dates[0] ?? now}" max="${now}"></div></div></span>`;
}

/** The row above the title: the page switch on the left, the date range on the right. */
export function topRow(current, range, dates, now) {
	return `<div class="top">${pageSwitch(current)}${picker(range, dates, now)}</div>`;
}

/** The workflow run building the page, or the workflow's page outside Actions. */
export function runUrl(env) {
	const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id } = env;
	return server && repo && id ? `${server}/${repo}/actions/runs/${id}` : `${REPO_URL}/actions/workflows/exploratory-outcomes.yml`;
}

/** "Oct 14, 9:05 AM" in UTC; the script switches it to the reader's time. */
export function clock(d) {
	const h = d.getUTCHours();
	return `<time datetime="${d.toISOString()}">${day(d.toISOString(), false)}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}</time>`;
}

/** The quiet line under the last section: when the page was built, linked to the run; `extra` follows it. */
export function footer(now, run, extra = '') {
	return `<footer>Updated <a class="quiet" href="${run}" title="Open the workflow run that built this report">${clock(now)}</a>${extra}</footer>`;
}

export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
	+ '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&amp;display=swap">';

export const SHELL_CSS = `
body{margin:0;background:#F5F4F0;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#2B2A27}
a{color:#2F6B55}a:not(.seg):hover{color:#1F4D3D}
main{padding:56px 24px 96px}
.page{width:100%;max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:56px}
.mono,code,.chip,.sign{font-family:'IBM Plex Mono',monospace}
.n,.seg,.bracket span{font-family:'IBM Plex Sans',sans-serif;font-variant-numeric:tabular-nums}
h1,h2{font-family:'Source Serif 4',Georgia,serif;margin:0}
h1{font-size:46px;line-height:1.1;font-weight:500;letter-spacing:-0.01em}
h2{font-size:24px;line-height:1.3;font-weight:600}
.green{color:#3B7D4F;font-weight:600}.muted{color:#6B6862;font-weight:400}
.label,.bracket b,.cols{font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase}
header{display:flex;flex-direction:column}
.top{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:#6B6862;margin-bottom:16px}
.head,.view{display:contents}
.switch{display:inline-flex;align-items:center;padding:4px 12px 4px 8px;background:#ECE9E2;border-radius:4px}
.switch .cmd{font-family:'IBM Plex Mono',monospace;font-weight:500;color:#2B2A27;margin-right:20px}
.switch .pages{display:inline-flex;align-items:center;gap:12px}
.switch a{text-decoration:none}
.switch a[aria-current=page]{color:#2B2A27;font-weight:600}
.switch-link{color:#7A766F}.switch a.switch-link:hover{color:#2B2A27;text-decoration:underline;text-underline-offset:3px}
.switch a:focus-visible{outline:2px solid #2B2A27;outline-offset:1px}
.range{position:relative;margin-left:auto}
.range-btn{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 6px;margin-right:-6px;border:0;border-radius:6px;background:transparent;color:#3A3833;font:13px 'IBM Plex Sans',sans-serif;cursor:pointer;text-decoration:underline dotted #B5B1A7;text-underline-offset:3px}
.range-btn:disabled{cursor:default;text-decoration:none}.range-btn:disabled svg{display:none}
.range-btn svg{transition:transform .15s}.range-btn[aria-expanded=true]{background:#ECE9E2}.range-btn[aria-expanded=true] svg{transform:rotate(180deg)}
.range-menu{position:absolute;top:38px;right:-6px;z-index:20;width:248px;box-sizing:border-box;padding:6px;background:#FBFAF7;border:1px solid #E4E1D9;border-radius:10px;box-shadow:0 8px 24px rgba(43,42,39,.12);display:flex;flex-direction:column}
.range-menu[hidden],.custom[hidden]{display:none}
[role=menuitemradio]{display:flex;align-items:center;justify-content:space-between;min-height:36px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#2B2A27;font:14px 'IBM Plex Sans',sans-serif;text-align:left;cursor:pointer}
[role=menuitemradio][aria-checked=true]{background:#ECE9E2}[role=menuitemradio] svg{visibility:hidden}[role=menuitemradio][aria-checked=true] svg{visibility:visible}
.range-menu .sep{height:1px;background:#E4E1D9;margin:4px 0}
.custom{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:6px 8px;padding:8px 10px 6px;font-size:13px;color:#5A5751}
.custom input{min-height:32px;padding:0 8px;border:1px solid #D6D2C8;border-radius:6px;background:#F5F4F0;color:#2B2A27;font:13px 'IBM Plex Sans',sans-serif}
.lede{display:flex;flex-direction:column;gap:8px;max-width:760px}
.headline{margin:0;font-size:22px;line-height:1.4;font-weight:500}
section{display:flex;flex-direction:column;gap:16px}
.all{display:grid;column-gap:3px;row-gap:8px}
.brackets,.bar.big{grid-column:1 / -1;display:grid;grid-template-columns:subgrid}
.bracket{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;min-width:0;white-space:nowrap}
.bracket span{font-size:12px;color:#5A5751}
.bar{display:flex;min-width:0}
.bar.big{height:56px}
.seg{box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;border-radius:3px;font-size:12px;font-weight:500}
.bar.big .seg{border-radius:0;gap:10px;padding:0;font-size:18px;font-weight:600;text-decoration:none;transition:opacity .15s}
.bar.big .seg:has(span){justify-content:flex-start;padding:0 12px}
.bar.big .seg:first-child{border-top-left-radius:6px;border-bottom-left-radius:6px}.bar.big .seg:last-child{border-top-right-radius:6px;border-bottom-right-radius:6px}
.bar.big .seg span{font-size:14px;font-weight:500}
.bar.big .seg:focus-visible{outline:2px solid #2B2A27;outline-offset:2px}
.bar.big:has(.seg:hover,.seg:focus-visible) .seg:not(:hover,:focus-visible){opacity:.35}
.under{grid-column:1 / -1;position:relative;min-height:20px;margin-top:4px}
.seg-detail[hidden],.acc-body[hidden]{display:none}
.seg-detail{position:absolute;top:0;left:0;right:0;z-index:1;min-height:48px;background:#F5F4F0;display:flex;align-items:center;gap:20px;min-width:0}
.hero{flex:0 0 auto;font-family:'Source Serif 4',Georgia,serif;font-size:44px;font-weight:600;line-height:1}
.seg-detail>div{display:flex;flex-direction:column;gap:2px;min-width:0}
.what{font-size:15px}.what span{color:#6B6862}
.def{font-size:14px;color:#3A3833}
.foot{margin:12px 0 0;font-size:13px;color:#7A766F}
.accordion{display:flex;flex-direction:column;border-top:1px solid #E4E1D9}
.accordion section{gap:0;border-bottom:1px solid #E4E1D9}
.acc{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}
.acc>span{display:flex;align-items:baseline;gap:12px}
.count{font-family:'IBM Plex Sans',sans-serif;font-size:14px;font-weight:400;color:#6B6862}
.acc svg{flex:0 0 auto;transition:transform .15s}
.acc[aria-expanded=true] svg{transform:rotate(180deg)}
.acc-body{margin-bottom:24px}
footer{margin-top:-24px;font-size:13px;color:#7A766F}
footer a.quiet{color:inherit;text-decoration:none}footer a.quiet:hover{color:#2F6B55;text-decoration:underline;text-underline-offset:3px}
`;

// The date range menu and the footer's local time. Runs after the page's VIEW_SOURCE and before its
// own script, which defines apply(param, write) to re-render for a range; syncPicker() is for it to call.
export const SHELL_SCRIPT = `
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const btn = $('.range-btn');
const menu = $('.range-menu');
const items = $$('[role=menuitemradio]');
const from = $('#range-from');
const to = $('#range-to');
const syncPicker = (range, write) => {
	$('.range-label').innerHTML = rangeText(range);
	btn.setAttribute('aria-label', 'Date range: ' + $('.range-label').textContent);
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
const built = $('footer time');
const at = new Date(built.dateTime);
built.textContent = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + (at.getHours() % 12 || 12) + ':' + String(at.getMinutes()).padStart(2, '0') + (at.getHours() < 12 ? ' AM' : ' PM');
btn.disabled = false;
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
// Tabbing out closes the menu; focus moving to the custom dates inside it doesn't.
menu.addEventListener('focusout', e => { if (e.relatedTarget && !e.relatedTarget.closest('.range')) { setMenu(false); } });
document.addEventListener('click', e => {
	const t = e.target;
	if (!menu.hidden && !t.closest('.range')) { setMenu(false); }
	const item = t.closest('[role=menuitemradio]');
	if (item && item.dataset.range === 'custom') { apply(from.value + '..' + to.value, true); from.focus(); }
	else if (item) { apply(item.dataset.range, true); setMenu(false); btn.focus(); }
});
`;

/** Rows as JSON for a <script> block, and a script safe to inline. */
export const inlineJson = data => JSON.stringify(data).replace(/</g, '\\u003c');
export const inlineScript = source => source.replace(/<\/script/gi, '<\\/script');
