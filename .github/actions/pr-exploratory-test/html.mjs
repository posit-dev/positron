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
import { parseReport, escapeHtml } from './report-parse.mjs';
import { REPORT_CSS, FONT_HREF } from './report-css.mjs';

const ICON = {
	// Down-right, not a download arrow: it says "moves you within this page".
	arrow: '<svg class="tile-arrow" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l6 6"></path><path d="M11 6v5H6"></path></svg>',
	check: size => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>`,
	chevron: '<svg class="chev" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5-4.5 4.5"></path></svg>',
	close: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
	up: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3.5"></path><path d="M4 7.5l4-4 4 4"></path></svg>',
	briefcase: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path><path d="M3 12.5h18"></path><path d="M11 12.5v1.5h2v-1.5"></path></svg>',
	party: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4.5-12 7.5 7.5z"></path><path d="M7 16l1.5 1.5"></path><path d="M14 4.5c.5 1-.2 2 .3 3"></path><path d="M19.5 10c-1-.5-2 .2-3-.3"></path><path d="M17 3v2"></path><path d="M21 7h-2"></path><circle cx="20" cy="3.5" r=".6" fill="currentColor"></circle><circle cx="12" cy="3" r=".6" fill="currentColor"></circle><circle cx="21" cy="12.5" r=".6" fill="currentColor"></circle></svg>',
};

const SEVERITY_LABEL = { major: 'Major', moderate: 'Moderate', minor: 'Minor' };

// The skill that writes these reports. A source link rather than a docs page,
// because the skill is the documentation: it is the brief the agent followed,
// so it answers what a reader of the report would actually ask. Valid once the
// skill is on main; a report published before then links a page that 404s.
const SKILL_URL = 'https://github.com/posit-dev/positron/blob/main/.claude/skills/exploratory-testing/SKILL.md';

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

/** One keyed item per segment, so the bar can be read without a hover. */
function legend(items) {
	const parts = items
		.filter(i => i.strong || i.word)
		.map(i => `<span class="legend-item"><span class="key" style="background:${i.color}"></span>`
			+ `<span>${i.strong ? `<b>${escapeHtml(String(i.strong))}</b> ` : ''}${escapeHtml(i.word ?? '')}</span></span>`)
		.join('');
	return parts ? `<div class="tile-legend">${parts}</div>` : '';
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
			? `<span class="status">${ICON.check(14)}Confirmed</span>`
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

function renderEvidence(items, n) {
	if (!items.length) {
		return '';
	}
	let shotIndex = 0;
	const tiles = items.map(item => {
		if (item.kind === 'shot') {
			// A real link to the raw image, so the thumbnail still works without
			// JavaScript; the script intercepts the click and opens the lightbox.
			const attrs = `href="${escapeHtml(item.src)}" data-lb="f${n}" data-i="${shotIndex++}"`
				+ ` data-caption="${escapeHtml(item.caption)}" data-file="${escapeHtml(item.file)}"`;
			return `<figure><a class="shot" ${attrs} aria-label="View full size: ${escapeHtml(item.caption)}">`
				+ `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.caption)}" loading="lazy"></a>`
				+ `<figcaption>${item.captionHtml}</figcaption></figure>`;
		}
		if (item.kind === 'log') {
			// A log line that already carries quotes of its own does not get another
			// pair around it; nested quotes read as a transcription error.
			const quote = /["\u201c\u201d]/.test(item.quote)
				? item.quoteHtml
				: `&ldquo;${item.quoteHtml}&rdquo;`;
			return '<div class="logtile">'
				+ `<span class="path">${escapeHtml(item.path)}</span>`
				+ `<span class="quote">${quote}</span>`
				+ (item.noteHtml ? `<span class="note">${item.noteHtml}</span>` : '')
				+ '</div>';
		}
		return `<div class="logtile"><span class="note">${item.textHtml}</span></div>`;
	}).join('');

	// One to three items get exactly that many columns; four or more wrap in a
	// four-column grid.
	const columns = Math.min(items.length, 4);
	return `<div class="evidence" id="f${n}-evidence"><div class="sub">Evidence</div>`
		+ `<div class="shots n${columns}">${tiles}</div></div>`;
}

function renderFindingCard(f) {
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
		+ '</div>';

	const head = `<header>${meta}`
		+ `<h2 class="card-title">${escapeHtml(f.title)}</h2>`
		+ (f.summaryHtml ? `<p class="card-summary">${f.summaryHtml}</p>` : '')
		+ '</header>';

	if (f.proseHtml) {
		return `<article id="f${f.n}" class="card${f.severity === 'major' ? ' major' : ''}">${head}<div class="card-prose">${f.proseHtml}</div></article>`;
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
	const steps = f.steps.length
		? '<div class="repro-group steps"><div class="repro-label">Steps</div>'
		+ `<ol class="repro-steps">${f.steps.map(s => `<li>${s}</li>`).join('')}</ol></div>`
		: '';
	const repro = (preconditions || steps)
		? `<div class="repro"><div class="sub">Reproduce</div>${preconditions}${steps}</div>`
		: '';

	const cause = f.causeHtml
		? `<div class="cause"><div class="sub">Likely cause<span class="hyp"> &middot; Hypothesis</span></div><p>${f.causeHtml}</p></div>`
		: '';

	return `<article id="f${f.n}" class="card${f.severity === 'major' ? ' major' : ''}">
${head}
${observedExpected}
${repro}
${renderEvidence(f.evidence, f.n)}
${cause}
</article>`;
}

function renderCoverage(report) {
	const { exercised, notExercised } = report.coverage;
	if (!exercised.length && !notExercised.length) {
		return '';
	}
	// Each count sits on the heading of the table it counts, rather than as one
	// combined line beside the section label: a reader looking at a table should
	// not have to carry a number down from the top to know how long it is. The
	// label stays primary and the count trails it, quiet.
	const count = n => `<span class="cov-n"> &middot; ${n}</span>`;

	const exercisedRows = exercised.map(row => {
		const reference = row.shot
			? `<a class="ref" href="${escapeHtml(row.shot.href)}" target="_blank" rel="noreferrer">${escapeHtml(row.shot.label)}</a>`
			: '<span class="ref none">&mdash;</span>';
		const result = row.finding
			? `${row.resultHtml} &middot; <a href="#f${row.finding}">Finding ${row.finding}</a>`
			: row.resultHtml;
		// The dot lives in the scenario cell rather than a column of its own, so
		// it reads as that scenario's status instead of as a first field.
		return '<div class="row coverage-grid">'
			+ '<span class="cov-scenario">'
			+ `<span class="cov-dot ${row.finding ? 'issue' : 'pass'}" aria-hidden="true"></span>`
			+ `<span>${row.scenarioHtml}</span></span>`
			+ `<span class="cov-result">${result}</span>`
			+ reference
			+ '</div>';
	}).join('\n');

	const exercisedBlock = exercised.length
		? `<div class="cov-group">
<h3 class="cov-title">Exercised${count(exercised.length)}</h3>
<div class="panel">
<div class="row row-head coverage-grid"><span class="cov-head-scenario">Scenario</span><span>Result</span><span>Screenshot</span></div>
${exercisedRows}
</div>
</div>`
		: '';

	// Not exercised is a separate table under its own heading, never mixed into
	// the rows above. Coverage says what happened; this says what is outside the
	// run, so its dot is neutral: it means "no result", not a bad one.
	const notRows = notExercised.map(row => '<div class="row coverage-grid">'
		+ '<span class="cov-scenario">'
		+ '<span class="cov-dot none" aria-hidden="true"></span>'
		+ `<span>${row.scenarioHtml}</span></span>`
		+ `<span class="cov-reason">${row.reasonHtml}</span>`
		+ '</div>').join('\n');

	const notBlock = notExercised.length
		? `<div class="cov-group gap">
<h3 class="cov-title">Not exercised${count(notExercised.length)}</h3>
<div class="panel dashed">
<div class="row row-head coverage-grid"><span class="cov-head-scenario">Scenario</span><span class="cov-reason">Reason</span></div>
${notRows}
</div>
</div>`
		: '';

	return `<section id="coverage" class="section">
<div class="section-head"><h2 class="section-label">Coverage</h2></div>
${report.scopeHtml ? `<p class="card-summary">${report.scopeHtml}</p>` : ''}
${exercisedBlock}
${notBlock}
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
var shots=Array.prototype.slice.call(document.querySelectorAll('a.shot'));
var group=[],at=0,opener=null;
function show(i){at=(i+group.length)%group.length;var a=group[at];
img.src=a.getAttribute('href');img.alt=a.dataset.caption||'';
cap.textContent=a.dataset.caption||'';
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
closeBtn.addEventListener('click',close);backdrop.addEventListener('click',close);
document.addEventListener('keydown',function(e){
if(lb.hidden){return;}
if(e.key==='Escape'){e.preventDefault();close();}
else if(e.key==='ArrowRight'){e.preventDefault();show(at+1);}
else if(e.key==='ArrowLeft'){e.preventDefault();show(at-1);}
else if(e.key==='Tab'){
// Only two controls are focusable, so the trap is a cycle between them.
var stops=[closeBtn,lb.querySelector('.lb-file a')].filter(Boolean);
var i=stops.indexOf(document.activeElement);
e.preventDefault();
stops[(i+(e.shiftKey?-1:1)+stops.length)%stops.length].focus();}});
}
})();`;

/**
 * Renders the report markdown as a self-contained HTML page.
 *
 * Falls back to nothing: a report whose body does not parse still gets its
 * header, tiles and whatever sections were recognised, and any finding the
 * parser could not break down keeps its prose.
 */
export function renderReportHtml(markdown) {
	const report = parseReport(markdown);
	const chips = report.chips.map(c => `<code>${escapeHtml(c)}</code>`).join('');

	return `<!DOCTYPE html>
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

${report.findings.map(renderFindingCard).join('\n\n')}

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
</body>
</html>
`;
}
