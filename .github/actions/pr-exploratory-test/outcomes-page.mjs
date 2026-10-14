/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One HTML page from the rows outcomes.mjs writes: how many findings were
// fixed, split by what started the run and by severity, then every row.
//   node outcomes-page.mjs rows.jsonl > outcomes.html

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO_URL, SEVERITY_LABEL } from '../../../.claude/skills/exploratory-test/renderer/page/page-common.mjs';
import { FONT_HREF, REPORT_CSS } from '../../../.claude/skills/exploratory-test/renderer/page/report-css.mjs';
import { escapeHtml, safeUrl } from '../../../.claude/skills/exploratory-test/renderer/shared/text.mjs';

const OUTCOMES = [
	['fixed-in-pr', 'Fixed in the PR', 'var(--success)'],
	['fixed-later', 'Fixed later', '#7CC195', 'light'],
	['not-acted-on', 'Not acted on', 'var(--danger)'],
	['unclear', 'Unclear', 'var(--moderate-dot)'],
	['no-paths', 'No files named', 'var(--minor-dot)'],
	['pending', 'Pending', 'var(--notrun-bar)', 'light'],
];
const KNOWN = new Set(['fixed-in-pr', 'fixed-later', 'not-acted-on']);
// Below this many known outcomes a group's split says little.
const FEW = 5;
const TRIGGER_LABEL = { auto: 'Auto-run', explore: '/explore' };

// Backticked names, as the findings and the model write them, set as code.
const codeSpans = text => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const count = (rows, outcome) => rows.filter(r => r.outcome === outcome).length;

/** Fixed counts against known outcomes (fixed or not acted on); duplicates are left out. */
export function summarize(rows) {
	const own = rows.filter(r => !r.dupOf);
	return {
		fixedInPr: count(own, 'fixed-in-pr'),
		fixedLater: count(own, 'fixed-later'),
		known: own.filter(r => KNOWN.has(r.outcome)).length,
		unknown: count(own, 'unclear') + count(own, 'no-paths'),
		pending: count(own, 'pending'),
	};
}

/** Evidence with the commits and issue its source names linked; the model's reason stays text. */
export function evidenceHtml(evidence) {
	const text = String(evidence ?? '');
	const at = text.indexOf(': ');
	if (at < 0) {
		return codeSpans(text);
	}
	const source = escapeHtml(text.slice(0, at))
		.replace(/\b[0-9a-f]{7,40}\b/g, sha => `<a href="${REPO_URL}/commit/${sha}"><code>${sha}</code></a>`)
		.replace(/#(\d+)/g, (m, n) => `<a href="${REPO_URL}/issues/${n}">${m}</a>`);
	return `${source}${codeSpans(text.slice(at))}`;
}

function bar(label, rows) {
	const segments = OUTCOMES.map(([key, name, color, tone]) => [name, color, tone, count(rows, key)]).filter(([, , , n]) => n > 0)
		.map(([name, color, tone, n]) => `<span class="seg${tone ? ` ${tone}` : ''}" style="flex:${n};background:${color}" title="${name}: ${n}">${n}</span>`).join('');
	const known = rows.filter(r => KNOWN.has(r.outcome)).length;
	const note = known < FEW ? `<span class="bar-note">${known} known, too few to compare</span>` : '';
	return `<div class="bar-row"><span class="bar-label">${escapeHtml(label)}</span>${note}<div class="bar">${segments}</div></div>`;
}

function bars(title, rows, keyOf, order, labelOf) {
	const keys = [...new Set(rows.map(keyOf))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
	return `<section><h2>${title}</h2>\n${keys.map(k => bar(labelOf(k), rows.filter(r => keyOf(r) === k))).join('\n')}\n</section>`;
}

function tableRow(r) {
	const report = safeUrl(r.reportUrl);
	const title = report ? `<a href="${escapeHtml(report)}">${codeSpans(r.title)}</a>` : codeSpans(r.title);
	const dup = r.dupOf ? `dup of ${escapeHtml(r.dupOf)}` : r.dupMaybe ? `(dup? ${escapeHtml(r.dupMaybe)}) ` : '';
	return `<tr><td>${title} <span class="ref">${escapeHtml(r.run)}#${escapeHtml(r.finding)}</span></td>`
		+ `<td><a href="${REPO_URL}/pull/${Number(r.pr)}">#${Number(r.pr)}</a></td>`
		+ `<td>${escapeHtml(SEVERITY_LABEL[r.severity] ?? r.severity)}</td>`
		+ `<td>${escapeHtml(TRIGGER_LABEL[r.trigger] ?? 'Unknown')}</td>`
		+ `<td>${r.dupOf ? dup : `${dup}${evidenceHtml(r.evidence)}`}</td></tr>`;
}

function table(title, rows) {
	return rows.length
		? `<section><h2>${title} (${rows.length})</h2>\n<table><thead><tr><th>Finding</th><th>PR</th><th>Severity</th><th>Started by</th><th>Evidence</th></tr></thead><tbody>\n${rows.map(tableRow).join('\n')}\n</tbody></table></section>`
		: '';
}

const PAGE_CSS = `
h2{font-family:var(--display);font-size:20px;color:var(--ink);margin:0 0 12px}
.headline{font-family:var(--display);font-size:30px;color:var(--ink);margin:0}
.sub{color:var(--muted);margin-top:6px}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--muted);margin-bottom:12px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.bar-row{display:grid;grid-template-columns:110px 1fr;align-items:center;gap:4px 12px;margin-bottom:10px}
.bar-label{font-weight:600;color:var(--ink)}
.bar-note{grid-column:2;font-size:12px;color:var(--faint)}
.bar{grid-column:2;display:flex;height:24px;border-radius:4px;overflow:hidden;background:var(--hairline)}
.seg{display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;min-width:18px}
.seg.light{color:var(--body)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);font-size:14px}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--hairline)}
th{background:var(--thead);font-weight:600;color:var(--muted);font-size:12px}
.ref{color:var(--faint);font-size:12px;white-space:nowrap}
`;

/** The whole page for `rows`, as outcomes.mjs writes them. */
export function renderOutcomesPage(rows) {
	const s = summarize(rows);
	const own = rows.filter(r => !r.dupOf);
	const fixed = s.fixedInPr + s.fixedLater;
	const legend = OUTCOMES.map(([, name, color]) => `<span><i style="background:${color}"></i>${name}</span>`).join('');
	const severities = Object.keys(SEVERITY_LABEL);
	return `<!doctype html>
<html lang="en" data-theme="professional">
<head><meta charset="utf-8"><title>Exploratory findings: what happened</title>
<link rel="stylesheet" href="${FONT_HREF}">
<style>${REPORT_CSS}${PAGE_CSS}</style></head>
<body><div class="page"><div class="wrap">
<header><p class="headline">${fixed} of ${s.known} findings with a known outcome were fixed (${s.fixedInPr} in the PR, ${s.fixedLater} later)</p>
<p class="sub">${s.unknown} couldn't be told, ${s.pending} still pending. Duplicates are left out.</p></header>
<div class="legend">${legend}</div>
${bars('By what started the run', own, r => r.trigger ?? 'unknown', ['auto', 'explore', 'unknown'], k => TRIGGER_LABEL[k] ?? 'Unknown')}
${bars('By severity', own, r => r.severity ?? 'unknown', [...severities, 'unknown'], k => SEVERITY_LABEL[k] ?? 'Unknown')}
${OUTCOMES.map(([key, name]) => table(name, own.filter(r => r.outcome === key))).join('\n')}
${table('Duplicates', rows.filter(r => r.dupOf))}
</div></div></body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
	process.stdout.write(renderOutcomesPage(rows));
}
