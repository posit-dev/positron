/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders the report as a page. The markdown stays beside it: the verification
// pass reads report.md, and a file you can grep is worth keeping.
//
// The structure comes from report-parse.mjs and the tokens from
// report-css.mjs, so this file is only the template: what goes where, and in
// what order. The output is one self-contained file -- inline CSS and JS, with
// Google Fonts the only external request and a system fallback behind every
// family.

// escapeHtml is shared with the parser rather than copied: both sides guard the
// same untrusted report text, and two copies drift.
import { resolve as resolvePath } from 'node:path';
import { parseReport, escapeHtml, safeUrl, basename } from './report-parse.mjs';
import { REPORT_CSS, FONT_HREF } from './report-css.mjs';

const ICON = {
	// Straight down with no tray under it: "jump down the page", not "download".
	arrow: '<svg class="tile-arrow" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9"></path><path d="M4.5 9l3.5 3.5L11.5 9"></path></svg>',
	check: size => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>`,
	// The check alone carries the green, so its stroke comes from CSS rather than
	// currentColor, which is the body-coloured word beside it.
	statusCheck: '<svg class="status-check" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>',
	copy: '<svg class="cp-ico" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"></rect><path d="M3 10.5V4.1c0-.6.5-1.1 1.1-1.1h6.4"></path></svg>',
	copied: '<svg class="cp-ok" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>',
	down: '<svg class="cov-chev" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>',
	// The collapsed rows' and the Coverage rows' disclosure: 12px, right-pointing.
	disclose: cls => `<svg class="${cls}" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5-4.5 4.5"></path></svg>`,
	chevron: '<svg class="chev" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5-4.5 4.5"></path></svg>',
	// A picture frame: "this step has a screenshot".
	photo: '<svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="1.5"></rect><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5"></path></svg>',
	// Leaves the report.
	external: '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h6.5V10"></path><path d="M12.5 3.5L4 12"></path></svg>',
	close: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
	up: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3.5"></path><path d="M4 7.5l4-4 4 4"></path></svg>',
	briefcase: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path><path d="M3 12.5h18"></path><path d="M11 12.5v1.5h2v-1.5"></path></svg>',
	party: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4.5-12 7.5 7.5z"></path><path d="M7 16l1.5 1.5"></path><path d="M14 4.5c.5 1-.2 2 .3 3"></path><path d="M19.5 10c-1-.5-2 .2-3-.3"></path><path d="M17 3v2"></path><path d="M21 7h-2"></path><circle cx="20" cy="3.5" r=".6" fill="currentColor"></circle><circle cx="12" cy="3" r=".6" fill="currentColor"></circle><circle cx="21" cy="12.5" r=".6" fill="currentColor"></circle></svg>',
};

const SEVERITY_LABEL = { major: 'Major', moderate: 'Moderate', minor: 'Minor' };

const REPO_URL = 'https://github.com/posit-dev/positron';

// The skill that writes these reports. A source link rather than a docs page,
// because the skill is the documentation: it is the brief the agent followed,
// so it answers what a reader of the report would actually ask. Valid once the
// skill is on main; a report published before then links a page that 404s.
const SKILL_URL = 'https://github.com/posit-dev/positron/blob/main/.claude/skills/exploratory-test/SKILL.md';

function pill(severity) {
	return `<span class="pill sev-${severity}"><span class="dot"></span>${SEVERITY_LABEL[severity]}</span>`;
}

/**
 * A tile is a link only when its section exists. A report with no Run details
 * gets a plain tile: no pointer, no arrow, no tooltip, nothing that promises a
 * destination there is no way to reach.
 */
function tile(href, tipText, inner) {
	return href
		? `<a class="tile tip" href="${href}" data-tip="${escapeHtml(tipText)}" aria-label="${escapeHtml(tipText)}">${ICON.arrow}${inner}</a>`
		: `<div class="tile">${inner}</div>`;
}

function bar(segments) {
	const parts = segments
		.filter(s => s.count > 0)
		.map(s => `<span style="flex:${s.count} 1 0;background:${s.color}"></span>`)
		.join('');
	return parts ? `<div class="tile-bar">${parts}</div>` : '';
}

/**
 * One plain-text item per segment, in the bar's order, so position ties each
 * word to its colour and every item still names what it counts.
 */
function legend(items) {
	const parts = items
		.filter(i => i.strong || i.word)
		.map(i => `<span class="legend-item">${i.strong ? `<b>${escapeHtml(String(i.strong))}</b> ` : ''}${escapeHtml(i.word ?? '')}</span>`);
	return parts.length
		? `<div class="tile-legend">${parts.join('<span class="legend-sep" aria-hidden="true">&middot;</span>')}</div>`
		: '';
}

function hasCost(report) {
	return report.cost.passes.length > 0;
}

function stageColor(i) {
	return `var(--stage-${Math.min(i, 1) + 1})`;
}

function dollars(text) {
	const n = Number(String(text ?? '').replace(/[^\d.]/g, ''));
	return Number.isFinite(n) ? n : 0;
}

function renderTiles(report) {
	const { severityCounts: sev, scenarios, cost } = report;
	const hasFindings = report.findings.length > 0 || report.findingCount > 0;
	const hasCoverage = scenarios.exercised > 0 || scenarios.notRun > 0;
	const hasRun = Boolean(report.runDetails && report.runDetails.length) || hasCost(report);

	const findingSegments = [
		{ count: sev.major, color: 'var(--major-dot)', word: 'major' },
		{ count: sev.moderate, color: 'var(--moderate-dot)', word: 'moderate' },
		{ count: sev.minor, color: 'var(--minor-dot)', word: 'minor' },
	].filter(s => s.count > 0);
	const findingsTile = tile(hasFindings ? '#findings' : null, 'Jump to Findings',
		'<div class="tile-label">Findings</div>'
		+ `<div class="tile-num">${report.findingCount}</div>`
		+ bar(findingSegments)
		+ legend(findingSegments.map(s => ({ ...s, strong: s.count }))));

	// Deliberately "Jump to Coverage", not "Jump to Scenarios": the tooltip is
	// where the reader learns these numbers summarise the Coverage section.
	const scenarioSegments = [
		{ count: scenarios.pass, color: 'var(--pass-fill)', word: 'pass' },
		{ count: scenarios.issues, color: 'var(--moderate-dot)', word: 'issues' },
		{ count: scenarios.notRun, color: 'var(--notrun-bar)', word: 'not run' },
	].filter(s => s.count > 0);
	const scenariosTile = tile(hasCoverage ? '#coverage' : null, 'Jump to Coverage',
		'<div class="tile-label">Scenarios</div>'
		+ `<div class="tile-figure"><span class="tile-num">${scenarios.exercised}</span><span class="unit">exercised</span></div>`
		+ bar(scenarioSegments)
		+ legend(scenarioSegments.map(s => ({ ...s, strong: s.count }))));

	// Sized by cost, the one number the stages share a unit for.
	const stages = cost.passes.map((p, i) => ({
		count: Math.round(dollars(p.cost) * 100),
		color: stageColor(i),
		strong: p.model,
		word: p.label,
	}));
	const headline = cost.duration ?? cost.total ?? '&mdash;';
	const beside = cost.duration && cost.total ? `<span class="unit">${cost.total}</span>` : '';
	const runTile = tile(hasRun ? '#run-details' : null, 'Jump to Run details',
		'<div class="tile-label">Run</div>'
		+ `<div class="tile-figure"><span class="tile-num">${headline}</span>${beside}</div>`
		+ bar(stages)
		+ legend(stages));

	return `<section class="tiles">${findingsTile}${scenariosTile}${runTile}</section>`;
}

function capitalize(text) {
	return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function renderAgents(report) {
	const { passes, total, duration } = report.cost;
	if (!passes.length) {
		return '';
	}
	const cell = (text, cls) => `<span${cls ? ` class="${cls}"` : ''}>${escapeHtml(text ?? '')}</span>`;
	const rows = passes.map(p => '<div class="agents-row">'
		+ cell(capitalize(p.label))
		+ cell(p.model ?? '\u2014')
		+ cell(p.cost, 'num')
		+ cell(p.turns == null ? '' : (p.maxTurns ? `${p.turns} of ${p.maxTurns}` : String(p.turns)), 'num muted')
		+ '</div>');
	const turns = passes.every(p => p.turns == null)
		? '' : String(passes.reduce((sum, p) => sum + (Number(p.turns) || 0), 0));
	const totalRow = passes.length > 1 || total
		? '<div class="agents-row agents-total">'
			+ cell('Total')
			+ cell(duration ? `${duration} elapsed` : '', 'muted')
			+ cell(total ?? '', 'num')
			+ cell(turns, 'num muted')
			+ '</div>'
		: '';
	return '<div class="fold-part agents"><div class="fold-label">Agents</div><div class="agents-table">'
		+ '<div class="agents-row agents-head"><span>Stage</span><span>Model</span><span>Cost</span><span>Turns</span></div>'
		+ rows.join('') + totalRow + '</div></div>';
}

function renderFindingsList(report) {
	if (!report.findings.length) {
		return '';
	}
	const rows = report.findings.map(f => {
		const word = f.verified ?? (f.confirmed ? f.confirmed.toLowerCase() : null);
		const status = word === 'confirmed'
			? `<span class="status">${ICON.statusCheck}Confirmed</span>`
			: word
				? `<span class="status muted">${word[0].toUpperCase()}${word.slice(1)}</span>`
				: '<span class="status muted"></span>';
		return `<a href="#f${f.n}" class="row findings-grid">`
			+ `<span>${pill(f.severity)}</span>`
			+ `<span class="finding-cell"><span class="claim"><span class="n">${f.n}</span>${f.rowTitle}</span>`
			+ (f.impact ? `<span class="impact">${f.impact}</span>` : '')
			+ '</span>'
			+ `<span class="rate">${escapeHtml(f.reproduced)}</span>`
			+ status
			+ '</a>';
	}).join('\n');

	return `<section id="findings" class="section">
<h2 class="section-label">Findings</h2>
<div class="panel">
<div class="row row-head findings-grid"><span>Severity</span><span>Finding and impact</span><span class="right">Reproduced</span><span class="right">Status</span></div>
${rows}
</div>
</section>`;
}

const size14 = svg => svg.replace('width="15" height="15"', 'width="14" height="14"');
const CODE_COPY = '<button type="button" class="code-cp" data-tip="Copy code" aria-label="Copy code">'
	+ `${size14(ICON.copy)}${size14(ICON.copied)}</button>`;

/** A step's code block, with a copy button for code the reader has to paste exactly. */
function withCodeCopy(html) {
	// Marked ends the code with a newline; drop it so a paste does not run the last line early.
	return html.replace(/<pre>[\s\S]*?<\/pre>/g, pre => `<div class="code-blk">${pre.replace(/\n<\/code><\/pre>$/, '</code></pre>')}${CODE_COPY}</div>`);
}

/**
 * One step as an `<li>`: an action is plain text; a verify is in ink with its
 * PASS or FAIL beside it, or nothing when the run never recorded one.
 */
function renderStep(step, { id = '', observed = false, tail = '', ev = '' } = {}) {
	const attr = id ? ` id="${id}"` : '';
	if (step.kind !== 'verify') {
		return `<li${attr}>${step.html}${tail}${withCodeCopy(step.blockHtml)}</li>`;
	}
	const result = step.result
		? `<span class="st-rs st-${step.result}">${step.result.toUpperCase()}</span>`
		: '';
	const obs = observed && step.observedHtml ? `<span class="st-obs">Observed: ${step.observedHtml}</span>` : '';
	return `<li${attr}><span class="st-v">${step.html}</span>${result}${ev}${obs}${tail}${withCodeCopy(step.blockHtml)}</li>`;
}

/** A finding's screenshots, the ones the gallery shows. */
function findingShots(f) {
	return f.evidence.filter(item => item.kind === 'shot');
}

function renderEvidence(f) {
	// Screenshots only: a log line is not evidence a reader can see, and the one
	// worth reading is under Error output. Logs stay in the agent prompt.
	const shots = findingShots(f);
	if (!shots.length) {
		return '';
	}
	const n = f.n;
	const tiles = shots.map((item, i) => {
		// A real link to the raw image, so the thumbnail still works without
		// JavaScript; the script intercepts the click and opens the lightbox.
		// The full-size view links the step back, when there is one to land on.
		const step = item.step;
		const stepHref = step && Number.isInteger(step.order) && step.order <= f.steps.length ? `#f${n}-s${step.order}` : '';
		const attrs = `id="shot-f${n}-${i + 1}" href="${escapeHtml(item.src)}" data-lb="f${n}" data-i="${i}"`
			+ ` data-caption="${escapeHtml(item.caption)}" data-file="${escapeHtml(item.file)}"`
			+ (step ? ` data-step="${escapeHtml(step.label)}"` : '')
			+ (stepHref ? ` data-step-href="${stepHref}"` : '');
		const label = `${step ? `${step.label} screenshot, view` : 'View'} full size: ${item.caption}`;
		return `<figure><a class="shot" ${attrs} aria-label="${escapeHtml(label)}">`
			+ `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.caption)}" loading="lazy">`
			+ (step ? `<span class="shot-step" aria-hidden="true">${escapeHtml(step.label)}</span>` : '')
			+ '</a></figure>';
	}).join('');

	return `<div class="evidence" id="f${n}-evidence"><div class="sub">Evidence</div>`
		+ `<div class="shots">${tiles}</div></div>`;
}

/**
 * A finding step's screenshot icon: opens the first of that step's shots in
 * the gallery, with a count when there is more than one.
 */
function stepShotIcon(f, k) {
	const shots = findingShots(f);
	const mine = shots.map((item, i) => ({ item, i })).filter(({ item }) => item.step?.order === k);
	if (!mine.length) {
		return '';
	}
	const count = mine.length;
	const label = count > 1 ? `${count} screenshots for this step` : 'Screenshot for this step';
	return ` <span class="st-sep" aria-hidden="true">&middot;</span> <a class="st-ev" href="#shot-f${f.n}-${mine[0].i + 1}" data-open="shot-f${f.n}-${mine[0].i + 1}"`
		+ ` aria-label="${label}">${ICON.photo}${count > 1 ? `<span class="st-n">${count}</span>` : ''}</a>`;
}

/** `/a/b`, `~/x` and URLs stand as written; anything else is relative to `base`. */
function absolutePath(p, base) {
	if (!base || /^([a-z][a-z0-9+.-]*:|\/|~)/i.test(p)) {
		return p;
	}
	return /^https?:\/\//i.test(base)
		? new URL(p, base.endsWith('/') ? base : `${base}/`).href
		: resolvePath(base, p);
}

/**
 * A repo-relative path as a link to that file at the report's commit, or null
 * for anything that is not one: an absolute path, a URL, or no commit to pin.
 */
function sourceHref(path, sha, line) {
	const p = String(path ?? '').replace(/^\.\//, '');
	if (!p || !/^[0-9a-f]{7,40}$/i.test(sha ?? '') || /^([a-z][a-z0-9+.-]*:|\/|~|\.\.)/i.test(p)) {
		return null;
	}
	return `${REPO_URL}/blob/${sha}/${p.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
}

/** A path shown by its file name, linked when it can be, with the full path on hover. */
function fileLink(path, href, cls, lineSuffix = '') {
	// A folder path keeps its last segment, so `tests/data-explorer/` reads as `data-explorer/`, not blank.
	const base = /\/$/.test(path) ? `${basename(path.replace(/\/+$/, ''))}/` : basename(path);
	const name = escapeHtml(base + lineSuffix);
	return href
		? `<a class="${cls}" href="${escapeHtml(href)}" title="${escapeHtml(path)}" target="_blank" rel="noreferrer">${name}</a>`
		: `<span class="${cls}" title="${escapeHtml(path)}">${name}</span>`;
}

/**
 * A link whose URL the card would refuse keeps its words and loses the URL
 * here too, so the copied prompt carries nothing the page would not render.
 */
function safeLinks(text) {
	return String(text ?? '').replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
		(whole, bang, label, url) => (safeUrl(url) ? whole : label));
}

/**
 * The finding as a Markdown prompt an agent can be handed, from the same parsed
 * fields the card renders. A section with nothing in it is left out rather than
 * printed as an empty heading.
 */
export function buildAgentPrompt(f, report, options = {}) {
	const base = options.base;
	const t = f.text;
	const word = f.verified ?? f.confirmed ?? '';
	const introduced = { new: 'Yes', 'pre-existing': 'No' }[f.origin.kind] ?? 'Not checked';
	const title = capitalize(safeLinks(/[.!?]$/.test(f.title) ? f.title : `${f.title}.`));
	const out = [`## Finding ${f.n} \u2014 ${SEVERITY_LABEL[f.severity]}`, '', title, ''];
	const status = [
		word && `Status: ${word[0].toUpperCase()}${word.slice(1)}`,
		f.reproduced && `Reproduced: ${f.reproduced}`,
		`Introduced by this change: ${introduced}`,
	].filter(Boolean);
	out.push(...status, '');
	const section = (heading, body) => {
		if (body) {
			out.push(`### ${heading}`, safeLinks(body), '');
		}
	};
	section('Impact', t.impact);
	section('Observed', capitalize(t.observed));
	section('Expected', capitalize(t.expected));
	section('Preconditions', t.preconditions.length === 1
		? t.preconditions[0]
		: t.preconditions.map(p => `- ${p}`).join('\n'));
	// A step's own block stays under its number.
	section('Reproduction', t.steps.map((step, i) => `${i + 1}. ${step.replace(/\n/g, '\n   ')}`).join('\n'));
	section('Evidence', f.evidence.map(e => {
		if (e.kind === 'shot') {
			return `- ${absolutePath(e.src, base)} \u2014 ${e.step ? `${e.step.label}: ` : ''}${e.caption}`;
		}
		if (e.kind === 'log') {
			const quote = /["\u201c\u201d]/.test(e.quote) ? e.quote : `\u201c${e.quote}\u201d`;
			return `- ${absolutePath(e.path, base)} \u2014 ${quote}${e.note ? ` (${capitalize(e.note)})` : ''}`;
		}
		return `- ${e.text}`;
	}).join('\n'));
	// Every error, including the ones the card hides for having no stack: a bare
	// message is still a lead for whoever picks this up.
	section('Error output', f.errors.map(e => [
		[e.source && absolutePath(e.source, base), ...e.meta].filter(Boolean).join(' | '),
		e.raw && fenced(e.raw),
	].filter(Boolean).join('\n')).join('\n\n'));
	section('Likely cause (hypothesis, not verified)', capitalize(t.cause));
	const { cases, related } = f.tests;
	if (cases.length) {
		const named = new Set(cases.map(c => c.path));
		const others = related.filter(r => !named.has(r.path));
		section('Regression test (suggestion)', [
			...cases.map(c => `- ${c.text}${c.path ? ` \u2192 add to ${c.path}${c.level ? ` (${c.level})` : ''}` : c.level ? ` \u2192 ${c.level} test; place it per the repo's test guidance` : ''}`),
			others.length && `Other tests that touch this code: ${others.map(r => `${r.path}${r.level ? ` (${r.level})` : ''}`).join(', ')}`,
		].filter(Boolean).join('\n'));
	}
	const [branch, sha] = report.chips;
	section('Context', [report.pr && `PR: ${report.pr.url}`, branch && `Branch: ${branch}`, sha && `Commit: ${sha}`, options.diff && `Diff: ${options.diff}`]
		.filter(Boolean).join('\n'));
	out.push('Please investigate this finding using the repository and the evidence above.');
	return out.join('\n');
}

// A fence longer than any backtick run inside, so a log line starting with
// ``` cannot close the block early.
function fenced(text) {
	const longest = Math.max(2, ...(text.match(/`+/g) || []).map(run => run.length));
	const fence = '`'.repeat(longest + 1);
	return `${fence}\n${text}\n${fence}`;
}

function renderCopyButton(f) {
	return `<button type="button" class="cp-btn" data-tip="Copy prompt for agent" data-prompt="prompt-f${f.n}" aria-label="Copy prompt for an agent: finding ${f.n}">`
		+ `${ICON.copy}${ICON.copied}</button>`;
}

function renderPromptBlock(f, report, options) {
	// Raw text inside a script element: only a closing tag can end it early.
	const text = buildAgentPrompt(f, report, options).replace(/<\/(script)/gi, '<\\/$1');
	return `<script type="text/plain" id="prompt-f${f.n}">${text}</script>`;
}

/** One closed row at the end of a card: a label, a quiet tail, and its content. */
function collapsedRow(cls, label, tail, body) {
	return `<details class="lc${cls}"><summary>${ICON.disclose('lc-chev')}`
		+ `<span>${label}<span class="lc-tail"> &middot; ${tail}</span></span></summary>`
		+ `<div class="lc-body">${body}</div></details>`;
}

function renderErrorOutput(f, sha) {
	// A message with no stack and no file:line is not something a reader can act
	// on here; it stays in the agent prompt.
	const errors = f.errors.filter(e => e.frames.length || /[\w.-]+\.\w+:\d+/.test(e.message));
	if (!errors.length) {
		return '';
	}
	const body = errors.map(e => {
		const meta = [
			e.source && `<span class="err-src">${escapeHtml(e.source)}</span>`,
			...e.metaHtml.map(m => `<span>${m}</span>`),
		].filter(Boolean).join('');
		const frames = e.frames.map(fr => {
			const loc = fileLink(fr.path, sourceHref(fr.path, sha, fr.line), 'err-loc', `:${fr.line}`);
			return `<div class="err-frame">at ${fr.fn ? `${escapeHtml(fr.fn)} (${loc})` : loc}</div>`;
		}).join('');
		return '<div class="err">'
			+ (meta ? `<div class="err-meta">${meta}</div>` : '')
			+ `<div class="err-code">${e.message ? `<div class="err-msg">${escapeHtml(e.message)}</div>` : ''}${frames}</div>`
			+ '</div>';
	}).join('');
	const count = errors[0].count;
	const tail = errors.length === 1
		? `1 error${count > 1 ? `, ${count}\u00d7` : ''}`
		: `${errors.length} errors`;
	return collapsedRow('', 'Error output', tail, body);
}

function renderRegressionTest(f, sha) {
	const { cases, related } = f.tests;
	if (!cases.length) {
		return '';
	}
	const sep = ' <span class="rt-sep" aria-hidden="true">&middot;</span> ';
	// The type tag leads every line so tags form one column across both lists.
	const row = (level, parts) => '<div class="rt-meta rt-row">'
		+ (level ? `<span class="rt-t rt-t-tint">${level}</span>` : '')
		+ `<span>${parts.filter(Boolean).join(sep)}</span></div>`;
	const where = c => {
		// No path means the agent could not place the file; the level still stands.
		if (!c.path) {
			return c.level || c.noteHtml ? row(c.level, [c.noteHtml]) : '';
		}
		// A file the case says to create has nothing to link to yet.
		const isNew = /\bnew\b/i.test(c.note) && !/\bexists?\b/i.test(c.note);
		return row(c.level, [`Add to ${fileLink(c.path, isNew ? null : sourceHref(c.path, sha), 'rt-file')}`, c.noteHtml]);
	};
	const plural = cases.length > 1;
	const named = new Set(cases.map(c => c.path));
	const others = related.filter(r => !named.has(r.path));
	const othersHtml = others.length
		? '<div class="rt-group"><div class="rt-label">Other tests that touch this code</div><ul class="rt-other">'
			+ others.map(r => `<li>${row(r.level, [fileLink(r.path, sourceHref(r.path, sha), 'rt-file'), r.noteHtml])}</li>`).join('')
			+ '</ul></div>'
		: '';
	return collapsedRow(' regtest', 'Regression test', `${cases.length} missing case${plural ? 's' : ''}`,
		`<div class="rt-group"><div class="rt-label">Suggested case${plural ? 's' : ''}</div>`
		+ `<ol class="rt-cases">${cases.map(c => `<li>${c.textHtml}${where(c)}</li>`).join('')}</ol></div>`
		+ othersHtml);
}

/** Fact, then hypothesis, then suggestion; each only when it has something to say. */
function renderCardDetails(f, report) {
	const sha = report.chips[1];
	const rows = [
		renderErrorOutput(f, sha),
		f.causeHtml ? collapsedRow(' hyp', 'Likely cause', 'Hypothesis', `<p>${f.causeHtml}</p>`) : '',
		renderRegressionTest(f, sha),
	].filter(Boolean);
	return rows.length ? `<div class="card-details">${rows.join('')}</div>` : '';
}

function renderFindingCard(f, report, options) {
	const prompts = options.agentPrompts !== false;
	const origin = `<span class="origin ${f.origin.kind}">${escapeHtml(f.origin.label)}</span>`;
	const context = [origin];
	if (f.confirmed === 'Confirmed' || f.verified === 'confirmed') {
		context.push(`<span class="confirmed">${ICON.check(12)}Confirmed</span>`);
	} else if (f.confirmed) {
		context.push(`<span class="confirmed">${escapeHtml(f.confirmed)}</span>`);
	}
	if (f.reproduced) {
		context.push(`<span class="reproduced">Reproduced ${escapeHtml(f.reproduced)}</span>`);
	}
	const contextHtml = context.join('<span class="sep" aria-hidden="true">&middot;</span>');

	const meta = '<div class="meta">'
		+ `<span class="group identity"><span class="who">Finding ${f.n}</span>${pill(f.severity)}</span>`
		+ '<span class="rule" aria-hidden="true"></span>'
		+ `<span class="group context">${contextHtml}</span>`
		+ (prompts ? renderCopyButton(f) : '')
		+ '</div>';

	const head = `<header>${meta}`
		+ `<h2 class="card-title">${escapeHtml(f.title)}</h2>`
		+ '</header>';

	const promptBlock = prompts ? renderPromptBlock(f, report, options) : '';

	if (f.proseHtml) {
		return `<article id="f${f.n}" class="card${f.severity === 'major' ? ' major' : ''}">${head}<div class="card-prose">${f.proseHtml}</div>${promptBlock}</article>`;
	}

	const observedExpected = (f.observedHtml || f.expectedHtml)
		? '<div class="two">'
		+ (f.observedHtml ? `<div class="oe observed"><div class="oe-label">Observed</div><p>${f.observedHtml}</p></div>` : '')
		+ (f.expectedHtml ? `<div class="oe expected"><div class="oe-label">Expected</div><p>${f.expectedHtml}</p></div>` : '')
		+ '</div>'
		: '';

	// Text only: every screenshot, including the one the report embedded here,
	// now sits under Evidence.
	// Setup first, then actions, each under its own label: a reader can see what
	// they need before they start without reading to find where it stops.
	const preconditions = f.preconditions.length
		? '<div class="repro-group"><div class="repro-label">Preconditions</div>'
		+ `<ul class="preconditions">${f.preconditions.map(p => `<li>${p}</li>`).join('')}</ul></div>`
		: '';
	// The card's Observed says what went wrong, so a step repeats it only when
	// two failed checks saw different things.
	const failed = f.steps.filter(st => st.result === 'fail');
	const observed = failed.length >= 2 && new Set(failed.map(st => st.observed)).size >= 2;
	const steps = f.steps.length
		? '<div class="repro-group steps"><div class="repro-label">Steps</div>'
		+ `<ol class="repro-steps steps">${f.steps.map((st, k) => renderStep(st, { id: `f${f.n}-s${k + 1}`, observed, ev: st.kind === 'verify' ? stepShotIcon(f, k + 1) : '' })).join('\n')}</ol></div>`
		: '';
	const repro = (preconditions || steps)
		? `<div class="repro"><div class="sub">Reproduce</div>${preconditions}${steps}</div>`
		: '';

	const details = renderCardDetails(f, report);

	return `<article id="f${f.n}" class="card${f.severity === 'major' ? ' major' : ''}">
${head}
${observedExpected}
${repro}
${renderEvidence(f)}
${details}
${promptBlock}
</article>`;
}

// Under All, the passes past the first few wait behind "Show all": issues and
// not-run rows are always listed, since those are what a reviewer scans for.
const COVERAGE_PASSES_SHOWN = 4;

function renderCoverage(report) {
	const { exercised, notExercised } = report.coverage;
	if (!exercised.length && !notExercised.length) {
		return '';
	}

	// One table, in a fixed order: finding rows in finding order, then passes as
	// they ran, then what was not run. Sort is stable, so rows citing the same
	// finding keep their run order.
	const isIssue = r => r.status === 'fail' || Boolean(r.finding);
	const issues = exercised.filter(isIssue).sort((a, b) => (a.finding ?? Infinity) - (b.finding ?? Infinity));
	const passes = exercised.filter(r => !isIssue(r));
	const total = exercised.length + notExercised.length;
	const hidden = Math.max(0, passes.length - COVERAGE_PASSES_SHOWN);

	// Rows are numbered in display order, so a precondition can link to the
	// row of the scenario that created its state.
	const ordered = [...issues, ...passes, ...notExercised];
	const rowId = new Map(ordered.map((row, i) => [row, `cv-row-${i + 1}`]));
	const byLedgerId = new Map(exercised.filter(r => r.id).map(r => [r.id, r]));

	// A passing row's screenshot hangs off the verify step it proves rather than
	// a column. A row's shots are one lightbox group.
	const photo = (row, i, shot) => {
		const name = row.scenario;
		return ` <span class="st-sep" aria-hidden="true">&middot;</span> <a class="st-ev" href="${escapeHtml(shot.href)}" data-lb="cv-${i}"`
			+ ` data-caption="${escapeHtml(name)}" data-file="${escapeHtml(shot.file)}"`
			+ ` aria-label="Screenshot for this step: ${escapeHtml(name)}">${ICON.photo}</a>`;
	};
	// The dot lives in the scenario cell rather than a column of its own, so it
	// reads as that scenario's status instead of as a first field.
	const scenario = (row, dot) => '<span class="cov-scenario">'
		+ `<span class="cov-dot ${dot}" aria-hidden="true"></span>`
		+ `<span>${row.scenarioHtml}</span></span>`;

	// "P" in the number gutter, then the short names; the full how-to is a
	// popover. Spans only: a list inside a <p> would break it.
	const preconditions = row => {
		if (!row.pre?.length) {
			return '';
		}
		const items = row.pre.map(p => {
			const src = p.from && byLedgerId.get(p.from);
			const from = !p.from ? ''
				: src ? `Created in <a href="#${rowId.get(src)}">${src.scenarioHtml}</a>: `
					: `Created in ${escapeHtml(p.from)}: `;
			return `<span class="pre-i"><b>${p.nameHtml}</b>${from}${p.howHtml}</span>`;
		}).join('');
		return '<p class="cv-pre" tabindex="0" aria-label="Preconditions">'
			+ '<span class="pre-mark" aria-hidden="true">P</span>'
			+ row.pre.map(p => p.nameHtml).join(', ')
			+ `<span class="pre-pop" role="tooltip"><span class="pre-t">Preconditions</span>${items}</span></p>`;
	};

	// The finding link leads: it is where a reader goes next. A finding row does
	// not expand: its steps are on the card it links to.
	const issueRows = issues.map(row => {
		const link = row.finding ? `<a href="#f${row.finding}" class="cv-f">Finding ${row.finding}</a>` : '';
		const sep = link && row.resultHtml ? ' &middot; ' : '';
		return `<div class="row coverage-grid cf-r cf-i" id="${rowId.get(row)}">`
			+ scenario(row, 'issue')
			+ `<span class="cov-result">${link}${sep}${row.resultHtml}</span>`
			+ '<span></span></div>';
	});

	// A passing row opens on its preconditions and the steps that exercised it.
	const passRows = passes.map((row, i) => {
		const cls = `cf-r cf-p${i < COVERAGE_PASSES_SHOWN ? '' : ' cov-extra'}`;
		const cells = scenario(row, 'pass') + `<span class="cov-result">${row.resultHtml}</span>`;
		// With no steps to hang it on, the screenshot is the whole expanded row.
		const steps = row.steps.length
			? `<ol class="steps">${row.steps.map(st => renderStep(st, { tail: st.evidence.map(e => photo(row, i, e)).join('') })).join('\n')}</ol>`
			: row.shot ? `<p class="cv-shot">Screenshot${photo(row, i, { href: row.shot.href, file: row.shot.label })}</p>` : '';
		const body = preconditions(row) + steps;
		if (body) {
			return `<details class="cv ${cls}" id="${rowId.get(row)}"><summary class="row coverage-grid">${cells}`
				+ `<span class="cv-chev-cell">${ICON.disclose('cv-chev')}</span></summary>`
				+ `<div class="cv-steps">${body}</div></details>`;
		}
		return `<div class="row coverage-grid ${cls}" id="${rowId.get(row)}">${cells}<span></span></div>`;
	});

	// Not run has no result, so its dot is neutral and its reason takes the
	// Result and chevron columns.
	const notRows = notExercised.map(row => `<div class="row coverage-grid cf-r cf-n" id="${rowId.get(row)}">`
		+ scenario(row, 'none')
		+ `<span class="cov-notrun"><span class="cov-nr">Not run</span>${row.reasonHtml ? ` &middot; ${row.reasonHtml}` : ''}</span>`
		+ '</div>');

	// Visually hidden radios ahead of the tabs and card, so CSS can filter the
	// rows and arrow keys move between tabs. A kind with no rows gets no tab.
	const kinds = [
		{ id: 'all', label: 'All', n: total },
		{ id: 'i', label: 'Issues', n: issues.length },
		{ id: 'p', label: 'Passed', n: passes.length },
		{ id: 'n', label: 'Not run', n: notExercised.length },
	].filter(k => k.id === 'all' || k.n > 0);
	const radios = kinds.map(k => `<input type="radio" name="cf" id="cf-${k.id}" class="cf-radio"${k.id === 'all' ? ' checked' : ''}>`).join('');
	// The hidden semibold copy reserves the selected width, so the row never shifts.
	const tabs = kinds.map(k => `<label for="cf-${k.id}" class="cf-tab cf-tab-${k.id}">`
		+ `<span class="cf-l">${k.label} <span class="cf-cnt">${k.n}</span></span>`
		+ `<span class="cf-g" aria-hidden="true">${k.label} ${k.n}</span></label>`).join('');

	// An empty list is only called out when the report listed it, so an omitted
	// section is not read as "everything was exercised".
	const empty = !notExercised.length && report.coverage.notExercisedListed
		? '\n<p class="cov-empty">Everything in scope was exercised.</p>'
		: '';

	return `<section id="coverage" class="section">
<div class="section-head"><h2 class="section-label">Coverage</h2></div>
${report.scopeHtml ? `<p class="card-summary">${report.scopeHtml}</p>` : ''}
<div class="cf" role="group" aria-label="Filter scenarios">
${radios}
<div class="cf-tabs">${tabs}</div>
<div class="panel cf-card">
<div class="row row-head coverage-grid"><span class="cov-head-scenario">Scenario</span><span>Result</span><span></span></div>
<div class="cov-rows">
${hidden ? `<input type="checkbox" id="cov-all" class="cov-toggle" aria-label="Show all ${total} scenarios">\n` : ''}${[...issueRows, ...passRows, ...notRows].join('\n')}
${hidden ? `<label for="cov-all" class="cov-more"><span class="cov-all">Show all ${total} scenarios</span><span class="cov-less">Show fewer</span>${ICON.down}</label>` : ''}
</div>
</div>${empty}
</div>
</section>`;
}

function renderFolds(report) {
	const folds = [];
	const details = report.runDetails ?? [];
	if (details.length || hasCost(report)) {
		const titles = [...(hasCost(report) ? ['Agents'] : []), ...details.map(s => s.title)];
		const hint = titles.map((t, i) => (i === 0 ? t : t.toLowerCase())).join(', ');
		const body = renderAgents(report) + details
			.map(s => `<div class="fold-part"><div class="fold-label">${escapeHtml(s.title)}</div>${s.html}</div>`)
			.join('');
		folds.push(`<details id="run-details">
<summary>${ICON.chevron}Run details<span class="hint">${escapeHtml(hint)}</span></summary>
<div class="fold-body">${body}</div>
</details>`);
	}
	if (report.verification) {
		const chips = report.verification.verdicts
			.map(v => `<span class="verdict ${v.word}">${v.n} ${v.word}</span>`).join('');
		folds.push(`<details id="verification-details">
<summary>${ICON.chevron}Verification details<span class="hint">Second agent, repository only, advisory</span></summary>
<div class="fold-body">
${report.verification.preambleHtml ? `<p>${report.verification.preambleHtml}</p>` : ''}
${chips ? `<div class="verdicts">${chips}</div>` : ''}
${report.verification.bodyHtml}
</div>
</details>`);
	}
	return folds.length ? `<section class="folds">${folds.join('\n')}</section>` : '';
}

/**
 * The signature: a maker's mark rather than a report section.
 *
 * A bug is found, looked at and fixed, in the time it takes to notice it. The
 * cost of the run is on the Run tile, where it is one figure among the others;
 * repeating it here ended the page on an invoice.
 *
 * The name links to the skill that wrote the report. The arrow says the link
 * leaves the page, so it has to actually go somewhere; the `data-skill-url`
 * placeholder the reference carries is gone now that there is a real URL.
 */
function renderSignature(skillUrl = SKILL_URL) {
	const name = 'exploratory-test &#8599;';
	const link = `<a class="sig-link" href="${escapeHtml(skillUrl)}" target="_blank" rel="noreferrer">${name}</a>`;

	// A top-down bug: a solid body, six hairline legs and two feelers.
	const bug = '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">'
		+ '<ellipse cx="8" cy="8" rx="3.6" ry="4.2" fill="currentColor" stroke="none"></ellipse>'
		+ '<path d="M5 2.5L6.3 4 M11 2.5L9.7 4 M4 6.5H1.5 M4 9.5H1.8 M12 6.5h2.5 M12 9.5h2.2"></path></svg>';
	const magnifier = '<svg class="sg-mag" width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">'
		+ '<circle cx="9" cy="9" r="6"></circle><path d="M13.5 13.5L19 19"></path></svg>';
	const tick = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
		+ '<path d="M3.5 8.5l3 3 6-7"></path></svg>';

	return `<footer class="sig">
<div class="sg" aria-hidden="true"><span class="sg-line"></span><span class="sg-bug">${bug}</span>${magnifier}<span class="sg-q">?</span><span class="sg-bang">!</span><span class="sg-pop">${tick}</span></div>
<p>Generated by ${link}</p>
</footer>`;
}

const BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('exploratory-report-theme');
if(t==='party'||t==='professional'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

const PAGE_SCRIPT = `(function(){
var root=document.documentElement;
var buttons=Array.prototype.slice.call(document.querySelectorAll('.switch button'));
function apply(theme){root.setAttribute('data-theme',theme);
buttons.forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.theme===theme));});}
buttons.forEach(function(b){b.addEventListener('click',function(){apply(b.dataset.theme);
try{localStorage.setItem('exploratory-report-theme',b.dataset.theme);}catch(e){}});});
apply(root.getAttribute('data-theme')||'professional');

var top=document.querySelector('.to-top');
if(top){var sync=function(){var show=(window.scrollY||document.documentElement.scrollTop||0)>900;
top.classList.toggle('show',show);top.setAttribute('tabindex',show?'0':'-1');};
window.addEventListener('scroll',sync,{passive:true});sync();}

// The Run tile points at a collapsed section, so the jump has to open it or it
// lands the reader on a closed row.
function openRun(){var d=document.getElementById('run-details');if(d){d.open=true;}}
document.querySelectorAll('a[href="#run-details"]').forEach(function(a){a.addEventListener('click',openRun);});
window.addEventListener('hashchange',function(){if(location.hash==='#run-details'){openRun();}});
if(location.hash==='#run-details'){openRun();}
// Lightbox. The thumbnails are links to the raw image, so everything here is an
// enhancement: without it, or before it runs, clicking one still shows the
// full-size screenshot.
var lb=document.getElementById('lightbox');
if(lb){
var img=lb.querySelector('img'),cap=lb.querySelector('.lb-cap'),file=lb.querySelector('.lb-file');
var closeBtn=lb.querySelector('.lb-close'),backdrop=lb.querySelector('.lb-backdrop');
var shots=Array.prototype.slice.call(document.querySelectorAll('a.shot,a.st-ev[data-lb]'));
var group=[],at=0,opener=null;
function show(i){at=(i+group.length)%group.length;var a=group[at];
img.src=a.getAttribute('href');img.alt=a.dataset.caption||'';
cap.textContent='';
if(a.dataset.step){var st=document.createElement(a.dataset.stepHref?'a':'span');st.className='lb-step';
st.textContent=a.dataset.step;if(a.dataset.stepHref){st.href=a.dataset.stepHref;
// Landing on the step is the point, so the opener does not take focus back.
st.addEventListener('click',function(){opener=null;close();});}
var dot=document.createElement('span');dot.className='step-sep';dot.setAttribute('aria-hidden','true');dot.textContent=' \u00b7 ';
cap.appendChild(st);cap.appendChild(dot);}
cap.appendChild(document.createTextNode(a.dataset.caption||''));
file.innerHTML='';
var name=document.createTextNode((a.dataset.file||'')+' ');
var orig=document.createElement('a');orig.href=a.getAttribute('href');orig.target='_blank';
orig.rel='noreferrer';orig.textContent='Open original';
file.appendChild(name);file.appendChild(orig);
lb.setAttribute('aria-label',a.dataset.file||'Screenshot');}
function open(a){opener=a;
group=shots.filter(function(s){return s.dataset.lb===a.dataset.lb;});
show(group.indexOf(a));lb.hidden=false;closeBtn.focus();}
function close(){lb.hidden=true;img.removeAttribute('src');
if(opener){opener.focus();opener=null;}}
shots.forEach(function(a){a.addEventListener('click',function(e){
// Let a modified click do what the reader asked: a new tab on the raw image.
if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0){return;}
e.preventDefault();open(a);});});
// A finding step's icon opens its screenshot in the gallery's group.
document.querySelectorAll('a.st-ev[data-open]').forEach(function(a){a.addEventListener('click',function(e){
if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0){return;}
var t=document.getElementById(a.dataset.open);if(!t){return;}
e.preventDefault();open(t);opener=a;});});
closeBtn.addEventListener('click',close);backdrop.addEventListener('click',close);
document.addEventListener('keydown',function(e){
if(lb.hidden){return;}
if(e.key==='Escape'){e.preventDefault();close();}
else if(e.key==='ArrowRight'){e.preventDefault();show(at+1);}
else if(e.key==='ArrowLeft'){e.preventDefault();show(at-1);}
else if(e.key==='Tab'){
// Only a few controls are focusable, so the trap is a cycle between them.
var stops=[lb.querySelector('.lb-cap a'),closeBtn,lb.querySelector('.lb-file a')].filter(Boolean);
var i=stops.indexOf(document.activeElement);
e.preventDefault();
stops[(i+(e.shiftKey?-1:1)+stops.length)%stops.length].focus();}});
}
})();`;

// One handler for every copy button. Only a copy that worked says "Copied".
const COPY_SCRIPT = `document.querySelectorAll('.cp-btn,.code-cp').forEach(function(b){var t,tip=b.dataset.tip;
b.addEventListener('click',function(){var text;
// A code block copies its source exactly; the agent button copies its prompt.
if(b.classList.contains('code-cp')){var pre=b.parentNode.querySelector('pre');if(!pre){return;}text=pre.textContent;}
else{var el=document.getElementById(b.dataset.prompt);if(!el){return;}
// Undo renderPromptBlock's escape of the closing script tag, or the paste carries it.
text=el.textContent.trim().replace(/<\\\\\\/(?=script)/gi,'</');}
function done(){b.classList.add('is-copied');b.dataset.tip='Copied';clearTimeout(t);
t=setTimeout(function(){b.classList.remove('is-copied');b.dataset.tip=tip;},2000);}
// A frame that blocks the clipboard API can still allow execCommand.
function fallback(){var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
var ok=false;try{ok=document.execCommand('copy');}catch(e){}ta.remove();if(ok){done();}}
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(done,fallback);}
else{fallback();}});});`;

/**
 * Renders the report markdown as a self-contained HTML page.
 *
 * Falls back to nothing: a report whose body does not parse still gets its
 * header, tiles and whatever sections were recognised, and any finding the
 * parser could not break down keeps its prose. `options.ledger` is the run's
 * ledger.md, which Coverage is built from when given.
 */
export function renderReportHtml(markdown, options = {}) {
	const report = parseReport(markdown, { ledger: options.ledger });
	// Off for teams whose AI policy does not allow it: no buttons, no prompt
	// blocks and no script. `base` makes relative evidence paths absolute, and
	// `diff` is the `<base>...<head>` range the prompt's Context names.
	const prompts = options.agentPrompts !== false && report.findings.length > 0;
	// The PR leads the meta line and is its only link: the branch and commit
	// stay plain. A run with no PR shows nothing in its place.
	const prLink = report.pr
		? `<a class="pr-link" href="${escapeHtml(report.pr.url)}" target="_blank" rel="noopener" title="Open the pull request on GitHub">PR #${report.pr.number}${ICON.external}</a>`
		: '';
	const chips = prLink + report.chips.map(c => `<code>${escapeHtml(c)}</code>`).join('');

	const page = `<!DOCTYPE html>
<html lang="en" data-theme="professional">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<script>${BOOT_SCRIPT}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_HREF}">
<style>${REPORT_CSS}</style>
</head>
<body>
<div id="top" class="page">
<main class="wrap">

<header class="head">
<nav class="switch" aria-label="Report theme">
<button type="button" class="tip" data-theme="professional" data-tip="Professional" aria-label="Switch to Professional" aria-pressed="true">${ICON.briefcase}</button>
<button type="button" class="tip" data-theme="party" data-tip="Party" aria-label="Switch to Party" aria-pressed="false">${ICON.party}</button>
</nav>
<div class="eyebrow"><span class="kicker">Exploratory test</span>${chips ? '<span class="bullet"></span>' : ''}${chips}</div>
<h1 class="title">${escapeHtml(report.title)}</h1>
${report.leadHtml ? `<p class="lead">${report.leadHtml}</p>` : ''}
<div class="motif" aria-hidden="true"><div class="plane"></div><div class="horizon"></div></div>
</header>

${renderTiles(report)}

${renderFindingsList(report)}

${report.findings.map(f => renderFindingCard(f, report, options)).join('\n\n')}

${renderCoverage(report)}

${renderFolds(report)}

${renderSignature()}

</main>
<div class="lb" id="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" hidden>
<button type="button" class="lb-backdrop" tabindex="-1" aria-label="Close"></button>
<div class="lb-panel">
<img alt="">
<div class="lb-foot">
<div class="lb-meta"><span class="lb-cap"></span><span class="lb-file"></span></div>
<button type="button" class="lb-close" aria-label="Close">${ICON.close}</button>
</div>
</div>
</div>
<a class="to-top tip" href="#top" data-tip="Back to top" aria-label="Back to top" tabindex="-1">${ICON.up}</a>
</div>
<script>${PAGE_SCRIPT}</script>
`;
	// Code blocks in steps have copy buttons even when agent prompts are off.
	const copy = prompts || page.includes('class="code-cp"');
	return `${page}${copy ? `<script>${COPY_SCRIPT}</script>\n` : ''}</body>
</html>
`;
}
