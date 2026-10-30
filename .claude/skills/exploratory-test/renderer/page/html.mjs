/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders the report as a page.
//
// The structure comes from report-json.mjs's model of report.json and the
// tokens from report-css.mjs, so this file is only the template: what goes where, and in
// what order. The output is one self-contained file -- inline CSS and JS, with
// Google Fonts the only external request and a system fallback behind every
// family.

// escapeHtml is shared with the model rather than copied: both sides guard the
// same untrusted report text, and two copies drift.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileProcess, isPositronLog } from '../shared/ledger.mjs';
import { basename, escapeHtml, isNewTestFile, readJson } from '../shared/text.mjs';
import { REPORT_CSS, FONT_HREF } from './report-css.mjs';
import { knownIssueOutcomes, openedLabel, readIssueRefs } from '../known-issues.mjs';
import { resolveFiles, linkFiles, linkFilePaths, renderFileViewers, renderTestFilesPart, FILE_SCRIPT } from './repro-files.mjs';
import { CARD_FILE, CARD_HEIGHT, CARD_WIDTH, writeCard } from './og-card.mjs';
import { readKnownIssues } from '../agents/finish.mjs';
import { issueLink, possiblyKnown, renderCopyButton, renderFeedbackRow, renderIssueBlock, renderIssueButton, renderLinkButton, renderPromptBlock } from './card-actions.mjs';
import { capitalize, ICON, logFile, REPO_URL, SEVERITY_LABEL, statusWord } from './page-common.mjs';
import { BOOT_SCRIPT, CODE_CHIP_SCRIPT, COPY_SCRIPT, FEEDBACK_SCRIPT, HEADER_ACTIONS, ISSUE_SCRIPT, KI_LIST_SCRIPT, KI_SCRIPT, LINK_SCRIPT, PAGE_SCRIPT } from './page-scripts.mjs';

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

/** A footer duration, `11m` or `<1m`, in minutes; a pass under half a minute counts as half. */
function minutes(text) {
	const m = /^(<)?(\d+)m$/.exec(String(text ?? ''));
	return m ? (m[1] ? 0.5 : Number(m[2])) : 0;
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

	const scenarioSegments = [
		{ count: scenarios.pass, color: 'var(--success)', word: 'passed' },
		{ count: scenarios.issues, color: 'var(--moderate-dot)', word: 'failed' },
		{ count: scenarios.notRun, color: 'var(--notrun-bar)', word: 'not run' },
	].filter(s => s.count > 0);
	const scenariosTile = tile(hasCoverage ? '#coverage' : null, 'Jump to Coverage',
		'<div class="tile-label">Coverage</div>'
		+ `<div class="tile-figure"><span class="tile-num">${scenarios.exercised + scenarios.notRun}</span><span class="unit">scenarios</span></div>`
		+ bar(scenarioSegments)
		+ legend(scenarioSegments.map(s => ({ ...s, strong: s.count }))));

	// Sized by cost, or by time when a pass's cost is unknown, as a local
	// explorer's is: counting it as $0 drew the verifier as the whole run.
	const byCost = cost.passes.every(p => p.cost);
	const stages = cost.passes.map((p, i) => ({
		count: byCost ? Math.round(dollars(p.cost) * 100) : Math.round(minutes(p.duration) * 10),
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

/** The line a chat app's link preview shows under the title; the image carries the counts. */
export function previewSummary(report) {
	return [report.pr ? `PR #${report.pr.number}` : '', report.chips[0] ?? ''].filter(Boolean).join(' on ');
}

/** "2 major, 1 minor": the severities with findings, worst first. */
function severityWords(sev) {
	return [[sev.major, 'major'], [sev.moderate, 'moderate'], [sev.minor, 'minor']]
		.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`).join(', ');
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

/**
 * A GitHub issue or PR number as a link. One the run fetched carries what the
 * preview card shows; the text is from GitHub, so every attribute is escaped.
 */
function kiNum(n, refs) {
	const issue = refs?.byNumber.get(n);
	return `<a class="ki-num" href="${REPO_URL}/${issue?.kind === 'pr' ? 'pull' : 'issues'}/${Number(n)}" target="_blank" rel="noopener"${kiData(issue, refs)}>#${Number(n)}</a>`;
}

/** What the preview card shows, as escaped data attributes; empty for a number the run did not fetch. */
function kiData(issue, refs) {
	const state = issue?.state === 'merged' || issue?.state === 'closed' ? issue.state : 'open';
	return issue
		? ` data-state="${state}"${issue.kind === 'pr' ? ' data-kind="pr"' : ''} data-opened="${escapeHtml(openedLabel(issue.createdAt, refs.now))}"`
		+ ` data-title="${escapeHtml(issue.title)}" data-summary="${escapeHtml(issue.summary ?? '')}"`
		: '';
}

/**
 * A finding's matches split by what GitHub says each one is, issues first,
 * each kind with its own label. A PR closed without merging is neither a
 * duplicate nor a fix, so it is left out; a number the run did not fetch
 * counts as an issue.
 */
function matchesByKind(numbers, refs) {
	const kind = n => {
		const ref = refs?.byNumber.get(n);
		return ref?.kind !== 'pr' ? 'issue' : ref.state === 'merged' ? 'merged' : ref.state === 'open' ? 'open' : null;
	};
	return [
		{ numbers: numbers.filter(n => kind(n) === 'issue'), label: nums => `Dupe? ${nums}`, noun: 'possible duplicates' },
		{ numbers: numbers.filter(n => kind(n) === 'open'), label: nums => `Fix in PR? ${nums}`, noun: 'possible fixes' },
		{ numbers: numbers.filter(n => kind(n) === 'merged'), label: nums => `Fixed in ${nums}?`, noun: 'possible fixes' },
	].filter(m => m.numbers.length);
}

/** Links the fetched issue and PR numbers in rendered text, leaving tags and existing links alone. */
function linkIssues(html, refs) {
	if (!refs?.byNumber.size) {
		return html;
	}
	let inLink = 0;
	return html.split(/(<[^>]+>)/).map(part => {
		if (part.startsWith('<')) {
			inLink += /^<a\b/i.test(part) ? 1 : /^<\/a>/i.test(part) ? -1 : 0;
			return part;
		}
		return inLink ? part : part.replace(/(?<![\w&#/])#(\d+)\b/g, (whole, n) => refs.byNumber.has(Number(n)) ? kiNum(Number(n), refs) : whole);
	}).join('');
}

/** The Coverage rows in display order, and their ids, which the Findings table links to. */
function coverageOrder(coverage) {
	// Finding rows in finding order, then passes as they ran, then what was not
	// run. Sort is stable, so rows citing the same finding keep their run order.
	const isIssue = r => r.status === 'fail' || Boolean(r.finding);
	const issues = coverage.exercised.filter(isIssue).sort((a, b) => (a.finding ?? Infinity) - (b.finding ?? Infinity));
	const passes = coverage.exercised.filter(r => !isIssue(r));
	const ordered = [...issues, ...passes, ...coverage.notExercised];
	return { issues, passes, rowId: new Map(ordered.map((row, i) => [row, `cv-row-${i + 1}`])) };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The block that stands in for the finding rows when there are none: the
 * scenario counts, then every linked-issue count, in the "Linked issues" row's
 * order (there's no such row then).
 */
function renderNoFindings(report, ki) {
	const { exercised = 0, pass = 0, notRun = 0 } = report.scenarios ?? {};
	const counts = [
		pass ? `<b>${pass}</b> passed` : '',
		notRun ? `<b>${notRun}</b> not run` : '',
		...kiCounts(ki, {
			fix: n => `${plural(n, 'fix', 'fixes')} verified`,
			part: n => `${plural(n, 'fix', 'fixes')} partly held`,
			obs: n => `${plural(n, 'known issue', 'known issues')} observed`,
			no: n => `${plural(n, 'linked issue', 'linked issues')} not observed`,
		}),
	].filter(Boolean).join(KI_DOT);
	const see = exercised + notRun ? '<a class="ki-ev ki-empty-go" href="#coverage">See Coverage</a>' : '';
	return `<div class="ki-empty"><span class="ki-empty-ic">${ICON.check(14)}</span>`
		+ `<span><b>No new findings</b>${counts ? `<span class="ki-empty-sum">${counts}</span>` : ''}</span>${see}</div>`;
}

const KI_DOT = '<span class="ki-dot" aria-hidden="true">&middot;</span>';
const kiCnt = (id, text) => `<span class="ki-cnt" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}">${text}</span>`;

/** Whether the report's findings were replayed on main, which groups them. */
const replayed = report => Boolean(report.verification?.originReason?.size) || report.findings.some(f => f.main);

/**
 * A finding's group from its replay on main's latest daily build: 'pr' when
 * it did not reproduce there (or main lacks what it needs), 'ex' when it did
 * (or it is a fix that did not hold), 'un' when the replay did not settle it,
 * and 'none' for a finding not confirmed. Null on a run with no comparison,
 * a run on main or a report from before main replays, which shows no groups.
 */
function groupOf(report, f, base, ki) {
	if (base?.usable !== true || !replayed(report)) {
		return null;
	}
	if (statusWord(f) !== 'confirmed') {
		return 'none';
	}
	if (ki?.fixFailed.has(f.n)) {
		return 'ex';
	}
	return { introduced: 'pr', inherited: 'ex' }[report.verification?.origin?.get(f.n)] ?? 'un';
}

const changeWord = report => (report.pr ? 'PR' : 'branch');
const groupLabel = (report, group) => ({ pr: `Only in ${changeWord(report)}`, ex: 'Also in latest build', un: 'Unknown' })[group];
const fewestTries = main => Math.min(...(main?.steps ?? []).map(s => s.m));
/** A finding's rate on the change, `{ n, m }`, from its "N/M". */
const rateOf = f => {
	const [n, m] = String(f.reproduced ?? '').split('/').map(Number);
	return { n, m };
};

/** Why a finding is Unknown, in a phrase for its card. */
function unknownShort(report, f) {
	const { reason } = report.verification?.originReason?.get(f.n) ?? {};
	const { n, m } = rateOf(f);
	return {
		'no main build': 'no main build',
		'not replayed': 'not replayed on the latest build',
		'could not run': 'couldn&rsquo;t run on the latest build',
		'too few tries': n < m ? 'intermittent, needs more tries on the latest build' : 'needs more tries on the latest build',
		'drift': 'main has changed in this area',
		'drift unchecked': 'cause not traced',
		'not verified': 'not verified',
		'fails differently': 'fails differently on the latest build',
	}[reason] ?? 'not replayed on the latest build';
}

/** The evidence for a finding's group, for its number's tooltip and its card. */
function groupEvidence(report, f, group, ki) {
	const change = changeWord(report);
	if (group === 'pr') {
		return f.main?.missing?.length
			? `Main doesn&rsquo;t have ${f.main.missing.map(escapeHtml).join(', ')} yet.`
			: `Didn&rsquo;t reproduce in the latest build (0 of ${fewestTries(f.main)} tries).`;
	}
	if (group === 'ex') {
		const failed = ki?.fixFailed.get(f.n);
		if (failed?.length) {
			const part = ki.fixesPartly?.find(p => p.issue.number === failed[0].number);
			return part
				? `Fixed in &ldquo;${part.held[0].scenarioHtml}&rdquo;, but still happens in &ldquo;${part.failed[0].scenarioHtml}&rdquo;. #${Number(failed[0].number)} is open for it.`
				: `Still happens. #${Number(failed[0].number)} is open for it.`;
		}
		const steps = [...(f.main?.steps ?? [])].sort((a, b) => a.step - b.step);
		if (steps.length === 1) {
			return `Also reproduced in the latest build (${steps[0].n} of ${steps[0].m} tries).`;
		}
		const seen = steps.filter(s => s.n > 0).map(s => `step ${s.step} (${s.n} of ${s.m} tries)`);
		return seen.length ? `Also reproduced in the latest build: ${seen.join(', ')}.` : 'Also reproduced in the latest build.';
	}
	const { reason, detail } = report.verification?.originReason?.get(f.n) ?? {};
	if (reason === 'too few tries') {
		const { n, m } = rateOf(f);
		const k = fewestTries(f.main);
		return n < m
			? `This issue only shows up sometimes (${n} of ${m} tries here). It didn&rsquo;t show up in ${k} tries on the latest build, but that could be luck, so we can&rsquo;t say either way.`
			: `It showed up every time here (${n} of ${m} tries), but the latest build was tried only ${k} time${k === 1 ? '' : 's'}, so we can&rsquo;t say yet.`;
	}
	return {
		'no main build': 'No build of main was available for this run.',
		'not verified': 'Verification didn&rsquo;t finish, so this finding&rsquo;s comparison with main wasn&rsquo;t checked.',
		'fails differently': `It also failed on the latest build, but differently (${escapeHtml(f.main?.steps?.find(s => s.n > 0)?.saw ?? '')}), so this run can&rsquo;t say whether it&rsquo;s the same issue.`,
		'could not run': detail ? `It couldn&rsquo;t run on the latest build: ${escapeHtml(detail.replace(/\.$/, ''))}.` : 'It couldn&rsquo;t run on the latest build.',
		'drift': `Main has changed the code where the fix likely goes, so the latest build can&rsquo;t show how this behaved before this ${change}.`,
		'drift unchecked': `It didn&rsquo;t reproduce on the latest build, but its cause wasn&rsquo;t traced, so main may have changed in this area since this ${change} started.`,
	}[reason] ?? 'This finding wasn&rsquo;t replayed on the latest build.';
}

const originTip = (title, text, hidden = true) => `<span class="og-tip"${hidden ? ' aria-hidden="true"' : ''} role="tooltip">${title ? `<b>${title}</b>` : ''}<span>${text}</span></span>`;

/**
 * A finding row's number. With a comparison it is a badge that marks its
 * group (a ring for Only in PR, plain for Also in latest build, a dashed ring
 * for Unknown) and opens the evidence on hover; the row is a link, so the
 * tooltip is hidden from screen readers, which hear the group in the row.
 */
function findingNumber(report, f, group, ki) {
	if (group === null) {
		return `<span class="n">${f.n}</span>`;
	}
	if (group === 'none') {
		return `<span class="f-b f-n">${f.n}</span>`;
	}
	return `<span class="f-b f-b-${group}">${f.n}${originTip(groupLabel(report, group), groupEvidence(report, f, group, ki))}</span>`;
}

/** A card's group in its meta line, after "Reproduced x/y": none for a finding not confirmed or a fix that did not hold. */
function cardGroup(report, f, group, ki) {
	if (!group || group === 'none' || ki?.fixFailed.has(f.n)) {
		return '';
	}
	const label = groupLabel(report, group);
	const text = group === 'un' ? `Unknown: ${unknownShort(report, f)}` : label;
	return `<span class="og og-meta" tabindex="0">${text}${originTip(label, groupEvidence(report, f, group, ki), false)}</span>`;
}

const INFO_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.25"/><path d="M8 7.2v3.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="8" cy="5" r=".8" fill="currentColor"/></svg>';

/** The tabs over the findings table, one per group with findings, and the button that explains them. */
function groupTabs(report, groups, mainBuild) {
	const count = id => groups.filter(g => g === id).length;
	const kinds = [
		{ id: 'all', label: 'All', n: groups.length },
		...['pr', 'ex', 'un'].map(id => ({ id, label: groupLabel(report, id), n: count(id) })),
	].filter(k => k.id === 'all' || k.n > 0);
	const radios = kinds.map(k => `<input type="radio" name="ff" id="ff-${k.id}" class="cf-radio"${k.id === 'all' ? ' checked' : ''}>`).join('');
	// The hidden semibold copy reserves the selected width, so the row never shifts.
	const tabs = kinds.map(k => `<label for="ff-${k.id}" class="cf-tab ff-tab ff-tab-${k.id}">`
		+ `<span class="cf-l">${k.label} <span class="cf-cnt">${k.n}</span></span>`
		+ `<span class="cf-g" aria-hidden="true">${k.label} ${k.n}</span></label>`).join('');
	const change = changeWord(report);
	const explain = {
		pr: `Reproduced on this ${change}&rsquo;s build but not in the latest build of main.`,
		ex: `Issues that already exist. They also reproduced in the latest build of main, so they weren&rsquo;t caused by this ${change}&rsquo;s changes.`,
		un: 'Not enough evidence to tell. Hover a finding&rsquo;s number to see why.',
	};
	const rows = kinds.filter(k => k.id !== 'all').map(k => `<div class="ffi-row"><b>${k.label}</b><span>${explain[k.id]}</span></div>`).join('');
	const commit = String(mainBuild?.commit ?? '');
	const build = mainBuild?.version && /^[0-9a-f]{7,40}$/.test(commit)
		? `Compared with the latest build of main: <a href="${REPO_URL}/commit/${commit}" target="_blank" rel="noopener">daily ${escapeHtml(mainBuild.version)} (${commit.slice(0, 7)})</a>`
		: 'No build of main was available for this run.';
	// The button names the popover, so a screen reader reads the explanation too.
	const info = `<span class="ffi"><button type="button" class="ffi-btn" aria-label="How findings are grouped" aria-describedby="ffi-pop">${INFO_ICON}</button>`
		+ `<span class="ffi-pop" id="ffi-pop" role="tooltip"><span class="ffi-h">How findings are grouped</span>${rows}<span class="ffi-f">${build}</span></span></span>`;
	return { radios, bar: `<div class="cf-tabs" role="group" aria-label="Filter findings by whether they happen on main">${tabs}${info}</div>` };
}

/** A verdict other than Confirmed: verify rejected the finding, or it was never shown to hold. */
function isRejected(word) {
	return Boolean(word) && word !== 'confirmed';
}

const VERDICT_TIPS = {
	disputed: 'The verifier thinks this may not be a bug. The finding explains why.',
	unresolved: 'The verifier couldn&rsquo;t confirm or rule this out. The finding has the details.',
	// The run's own label for a finding seen but reproduced 0 times; a verifier's verdict replaces it.
	unproven: 'The run saw this but couldn&rsquo;t reproduce it, and verification didn&rsquo;t check it.',
};
const VERDICT_TIP_OTHER = 'The verifier didn&rsquo;t confirm this finding. The finding has the details.';

/** The square tag that marks a rejected finding: in its table row, or focusable in its card's meta line. */
function verdictTag(word, focusable = true) {
	const label = escapeHtml(capitalize(word));
	const tip = originTip(label, VERDICT_TIPS[word] ?? VERDICT_TIP_OTHER, !focusable);
	return `<span class="og vtag"${focusable ? ' tabindex="0"' : ''}>${label}${tip}</span>`;
}

/** `html` with `tag` after its last word, the two kept on one line so the tag never wraps alone. */
function withLastWord(html, tag) {
	// The last space outside a tag starts the last word.
	let depth = 0;
	let at = -1;
	for (let i = 0; i < html.length; i++) {
		depth += html[i] === '<' ? 1 : html[i] === '>' ? -1 : 0;
		if (html[i] === ' ' && depth === 0) {
			at = i;
		}
	}
	return `${html.slice(0, at + 1)}<span class="nowrap">${html.slice(at + 1)}${tag}</span>`;
}

function renderFindingsList(report, ki = null, refs = null, changeBase = null, mainBuild = null) {
	const grid = 'findings-grid';
	const groups = report.findings.map(f => groupOf(report, f, changeBase, ki));
	const grouped = groups.some(g => g !== null);
	const rows = report.findings.map((f, i) => {
		const group = groups[i];
		const word = statusWord(f);
		// Plain numbers, not links: the whole row is already a link to the card. They still preview on hover.
		const num = n => `<span class="ki-num-t"${kiData(refs?.byNumber.get(n), refs)}>#${Number(n)}</span>`;
		// Two of one kind show both; three or more the first and "+N more", with
		// the rest in a tooltip. The card lists them all, for screen readers too.
		const first = (list, noun) => (list.length <= 2 ? list.map(num).join(' ')
			: `${num(list[0])}<span class="ki-more">+${list.length - 1} more<span class="og-tip" aria-hidden="true" role="tooltip"><b>${list.length - 1} more ${noun}</b>`
			+ `${list.slice(1).map(n => `<span>#${Number(n)} ${escapeHtml(refs?.byNumber.get(n)?.title ?? '')}</span>`).join('')}</span></span>`);
		const failed = ki?.fixFailed.get(f.n)?.map(i => i.number) ?? [];
		const back = ki?.cameBack.get(f.n)?.map(i => i.number) ?? [];
		const line = html => `<span class="ki-mt">${html}</span>`;
		const muted = text => line(`<span class="ki-state">${text}</span>`);
		const lines = [];
		// A finding verify rejected never reads as a fix that failed or an issue
		// that came back: it keeps only the issue's number.
		const rejected = isRejected(word);
		if (failed.length || back.length) {
			const own = first(failed.length ? failed : back, failed.length ? 'fixes that didn&rsquo;t hold' : 'issues that came back');
			lines.push(rejected ? muted(own) : line(`<span class="ki-reg">${ICON.x}${failed.length ? (failed.some(n => ki.partly?.has(n)) ? 'Partly fixed' : 'Not fixed') : 'Regressed'}</span><span class="ki-state">${own}</span>`));
		}
		// Every match the card shows, linked to the PR or found by search, one line per kind.
		lines.push(...matchesByKind(possiblyKnown(f, ki), refs).map(m => muted(m.label(first(m.numbers, m.noun)))));
		// A match closed as not planned: the team chose to leave this behavior.
		if (f.intended?.length) {
			lines.push(muted(`Won&rsquo;t fix? ${first(f.intended, 'issues closed as not planned')}`));
		}
		const up = i === report.findings.length - 1 ? ' og-up' : '';
		const status = lines.length
			? `<span class="ki-st">${lines.join('')}</span>`
			: `<span class="ki-st"><span class="og og-none${up}"><span aria-hidden="true">&mdash;</span><span class="og-sr">No matches</span>`
				+ `${originTip('', 'No matching issues or PRs found.')}</span></span>`;
		// The tag is read as part of the row link, so its tooltip is hidden from screen readers.
		const title = rejected ? withLastWord(f.rowTitle, verdictTag(word, false)) : f.rowTitle;
		// The number's tooltip is hidden from screen readers, so the row starts with the group.
		const heard = group && group !== 'none' ? `<span class="og-sr">${groupLabel(report, group)}, </span>` : '';
		const claim = group === null
			? `<span class="claim">${findingNumber(report, f, group, ki)}${title}</span>`
			: `<span class="claim f-t">${findingNumber(report, f, group, ki)}<span>${title}</span></span>`;
		return `<a href="#f${f.n}"${group ? ` data-og="${group}"` : ''} class="row ${grid}${rejected ? ' is-rej' : ''}">`
			+ `<span>${heard}${pill(f.severity)}</span>`
			+ `<span class="finding-cell">${claim}</span>`
			+ status
			+ '</a>';
	});

	const matchesHead = `<span><span class="og og-h" tabindex="0">Matches${originTip('Matches', 'Existing GitHub issues or PRs that match or may match this finding. A dash means no match was found.', false)}</span></span>`;
	const head = rows.length
		? `<div class="row row-head ${grid}"><span>Severity</span><span>Finding</span>${matchesHead}</div>\n`
		: '';
	const body = `${head}${[...(rows.length ? rows : [renderNoFindings(report, ki)]), renderLinkedIssues(report, ki, !rows.length)].filter(Boolean).join('\n')}`;
	if (!grouped) {
		return `<section id="findings" class="section">
<h2 class="section-label">Findings</h2>
<div class="panel">
${body}
</div>
</section>`;
	}
	// Visually hidden radios ahead of the tabs and the table, so CSS can filter
	// the rows by group, as Coverage does.
	const { radios, bar } = groupTabs(report, groups, mainBuild);
	return `<section id="findings" class="section">
<h2 class="section-label">Findings</h2>
<div class="cf ff">
${radios}
${bar}
<div class="panel ff-card">
${body}
</div>
</div>
</section>`;
}

/** The linked-issue counts above zero, fix verified first, each opening its list. */
function kiCounts(ki, label) {
	const n = { fix: ki?.fixesHeld?.length ?? 0, part: ki?.fixesPartly?.length ?? 0, obs: ki?.observed?.length ?? 0, no: ki?.notObserved?.length ?? 0 };
	return ['fix', 'part', 'obs', 'no'].filter(k => n[k] && label[k]).map(k => kiCnt(`ki-list-${k}`, label[k](n[k])));
}

/**
 * The "Linked issues" row under the findings: one count per list, each list
 * shown on hover. Nothing when every count is zero; with no findings the counts
 * sit in the empty block instead, leaving only the lists.
 */
function renderLinkedIssues(report, ki, noFindings = false) {
	const observed = ki?.observed ?? [];
	const held = ki?.fixesHeld ?? [];
	const partly = ki?.fixesPartly ?? [];
	const unseen = ki?.notObserved ?? [];
	if (!observed.length && !held.length && !partly.length && !unseen.length) {
		return '';
	}
	const { rowId } = coverageOrder(report.coverage);
	// Hidden sources the script copies into its panel as they are, so every
	// title and scenario name is escaped here.
	const item = (issue, meta) => `<div class="ki-lc-it"><a class="ki-lc-n" href="${REPO_URL}/issues/${Number(issue.number)}" target="_blank" rel="noopener">#${Number(issue.number)}</a>`
		+ `<span>${escapeHtml(issue.title)}<span class="ki-lc-m">${kiState(issue)} &middot; ${meta}</span></span></div>`;
	const list = (id, heading, items) => items.length ? `<div class="ki-list" id="${id}" hidden><div class="ki-lc-h">${heading}</div>${items.join('')}</div>` : '';
	const quote = row => `&ldquo;${row.scenarioHtml}&rdquo;`;
	const seen = o => {
		const [first, ...rest] = o.rows;
		const names = rest.length ? `${o.rows.slice(0, -1).map(quote).join(', ')} and ${quote(rest.at(-1))}` : quote(first);
		const ev = rowId.has(first) ? ` &middot; <a class="ki-ev" href="#${rowId.get(first)}">View evidence</a>` : '';
		return `seen in ${names}${ev}`;
	};
	const skipped = ki?.skipped ?? new Set();
	const lists = list('ki-list-obs', 'Known issues observed this run', observed.map(o => item(o.issue, seen(o))))
		+ list('ki-list-fix', 'Fix verified this run', held.map(h => item(h.issue, `passed in ${quote(h.rows[0])}`)))
		+ list('ki-list-part', 'Partly fixed this run', partly.map(p => item(p.issue, `passed in ${quote(p.held[0])}, failed in ${quote(p.failed[0])}`)))
		+ list('ki-list-no', 'Linked to this PR, not observed', unseen.map(i => item(i, skipped.has(i.number) ? 'skipped on purpose, see Coverage' : 'no scenario reached it')));
	if (noFindings) {
		return lists;
	}
	const counts = kiCounts(ki, { fix: n => `${n} fix verified`, part: n => `${n} partly fixed`, obs: n => `${n} observed`, no: n => `${n} not observed` }).join(KI_DOT);
	return `<div class="ki-grp"><div class="ki-bar"><span class="ki-lbl"><b>Linked issues</b></span><span class="ki-sum">${counts}</span></div></div>\n${lists}`;
}

const kiState = issue => issue.state === 'closed' ? 'Closed' : 'Open';

const size14 = svg => svg.replace('width="15" height="15"', 'width="14" height="14"');
const CODE_COPY = '<button type="button" class="code-cp" data-tip="Copy code" aria-label="Copy code">'
	+ `${size14(ICON.copy)}${size14(ICON.copied)}</button>`;

/** A step's code block, with a copy button for code the reader has to paste exactly. */
function withCodeCopy(html) {
	// Marked ends the code with a newline; drop it so a paste does not run the last line early.
	return html.replace(/<pre>[\s\S]*?<\/pre>/g, pre => `<div class="code-blk">${pre.replace(/\n<\/code><\/pre>$/, '</code></pre>')}${CODE_COPY}</div>`);
}

/**
 * Inline code becomes click-to-copy: Steps to Reproduce and Coverage steps are full of
 * short commands people run one at a time. Code blocks are left alone, since they have a Copy button,
 * and so is a file chip, which linkFiles has already made a link.
 */
function copyableCode(html) {
	return html.split(/(<pre[\s\S]*?<\/pre>)/).map((part, i) =>
		i % 2 ? part : part.replace(/<code>/g, '<code class="cc" data-tip="Copy">')).join('');
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

/** A finding's screenshots, in step order; the replay on main's are paired with them instead. */
function findingShots(f) {
	return f.evidence.filter(item => item.kind === 'shot' && !item.main);
}

/**
 * A confirmed finding's step whose check the replay on main screenshotted:
 * the change's shots and main's, paired by order, and each side's result.
 * Null for any other step, which shows its shots as before.
 */
function stepComparison(report, f, group, mainBuild, k) {
	if (!['pr', 'ex', 'un'].includes(group)) {
		return null;
	}
	const mains = f.evidence.filter(e => e.kind === 'shot' && e.main && e.step?.order === k);
	if (!mains.length) {
		return null;
	}
	// The step's own screenshot pairs with main's; evidence from another scenario
	// that opens from this step has no counterpart, so it comes after.
	const own = new Set((f.steps[k - 1]?.evidence ?? []).map(e => e.file));
	const prs = findingShots(f).map((item, i) => ({ item, i })).filter(({ item }) => item.step?.order === k)
		.sort((a, b) => Number(own.has(b.item.file)) - Number(own.has(a.item.file)));
	const counted = f.main?.steps?.find(s => s.step === k);
	const result = !counted ? ''
		: counted.n > 0 ? (counted.same === false ? 'Fails differently' : 'Also fails')
			: group === 'pr' ? 'Passes' : `Didn&rsquo;t fail in ${counted.m} ${counted.m === 1 ? 'try' : 'tries'}`;
	const daily = mainBuild?.version ? `daily ${escapeHtml(mainBuild.version)}` : '';
	return {
		pairs: Array.from({ length: Math.max(prs.length, mains.length) }, (_, j) => ({ pr: prs[j] ?? null, main: mains[j] ?? null })),
		prH: `This ${changeWord(report)}`,
		prR: 'Fails',
		mainR: [daily, result].filter(Boolean).join(' &middot; '),
	};
}

/** Whether a screenshot opens from one of the card's steps. */
function onStep(f, item) {
	const order = item.step?.order;
	return Number.isInteger(order) && order >= 1 && order <= f.steps.length;
}

/**
 * The lightbox's links to a finding's screenshots, one group per step, as
 * hidden links: the step's icon opens them, so the card shows each once. A
 * shot that names no step on the card has nowhere to open from, so lint
 * requires one; it stays in the agent prompt's Evidence.
 */
function renderShotLinks(f, comparisonOf = () => null) {
	const n = f.n;
	const groups = new Map();
	findingShots(f).forEach((item, i) => {
		if (onStep(f, item)) {
			groups.set(item.step.order, [...(groups.get(item.step.order) ?? []), { item, i }]);
		}
	});
	// A step only main screenshotted still opens its comparison.
	for (const k of f.steps.map((_, i) => i + 1).filter(k => !groups.has(k) && comparisonOf(k))) {
		groups.set(k, []);
	}
	// A real link to the raw image, so it still works without JavaScript; the
	// script intercepts the click and opens the lightbox, which links the step back.
	const link = (id, item, i, lb, extra = '') => `<a class="shot" id="${id}" href="${escapeHtml(item.src)}" data-lb="${lb}" data-i="${i}"`
		+ ` data-caption="${escapeHtml(item.caption)}" data-file="${escapeHtml(item.file)}"`
		+ ` data-step="${escapeHtml(item.step.label)}" data-step-href="#f${n}-s${item.step.order}"${extra} hidden></a>`;
	const links = [...groups].sort(([a], [b]) => a - b).map(([k, group], g) => {
		const cmp = comparisonOf(k);
		if (!cmp) {
			return group.map(({ item, i }) => link(`shot-f${n}-${i + 1}`, item, i, `f${n}-g${g + 1}`)).join('');
		}
		// One link per pair, the viewer showing both builds side by side; the
		// arrows move through every compared step of the finding.
		return cmp.pairs.map(({ pr, main }, j) => link(pr ? `shot-f${n}-${pr.i + 1}` : `shot-f${n}-m${k}-${j + 1}`, pr?.item ?? main, j, `f${n}-cmp`,
			` data-pr="${escapeHtml(pr?.item.src ?? '')}" data-main="${escapeHtml(main?.src ?? '')}" data-pr-h="${cmp.prH}" data-pr-r="${cmp.prR}" data-main-r="${cmp.mainR}"`
			+ ` data-pair="${j + 1}" data-pairs="${cmp.pairs.length}"`)).join('');
	}).join('');
	return links ? `<div class="shot-links" hidden>${links}</div>` : '';
}

/** A PNG's width and height in CSS px, read from its header; shots are taken at CSS scale. */
function pngSize(bytes) {
	return bytes?.length >= 24 && bytes.toString('latin1', 12, 16) === 'IHDR'
		? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
		: null;
}

/**
 * What a screenshot icon previews: the crop shot.sh saved beside the shot, at
 * its own size, or else the whole window fitted to the preview. A whole
 * window shrunk that far has text about 2px high, so the crop is the point.
 */
function shotPreview(src, readFile) {
	const crop = String(src).replace(/\.png$/i, '.crop.png');
	const cropSize = crop !== src && readFile ? pngSize(readFile(crop)) : null;
	if (cropSize) {
		return { src: crop, cls: 'shot-crop', ...cropSize };
	}
	return { src, cls: 'shot-full', ...(readFile ? pngSize(readFile(src)) : null) };
}

/**
 * The preview on an icon's hover or focus. Placed by the page script, since
 * it is fixed to the window so a wide one is never cut off. Lazy, so it loads
 * only once it shows; sized, so it keeps its space while it does.
 */
function evPop(src, readFile, count = 1, compareAs = '') {
	const p = shotPreview(src, readFile);
	const size = p.width ? ` width="${p.width}" height="${p.height}"` : '';
	const img = `<img class="${p.cls}" src="${escapeHtml(p.src)}" alt=""${size} loading="lazy">`;
	// A comparison names the build it shows, and what a click does, above the image.
	if (compareAs) {
		return `<span class="ev-pop" aria-hidden="true"><span class="ev-hd"><b>${compareAs}</b><span>Click to compare with latest build</span></span>${img}</span>`;
	}
	return `<span class="ev-pop" aria-hidden="true">${img}`
		+ `<span class="ev-cap">${count > 1 ? `1 of ${count} &middot; click for full window` : 'Click for full window'}</span></span>`;
}

/**
 * A finding step's screenshot icon: previews the first of that step's shots
 * and opens it full size, with a count when there is more than one.
 */
function stepShotIcon(f, k, readFile, cmp = null) {
	if (cmp) {
		const first = cmp.pairs[0];
		const id = first.pr ? `shot-f${f.n}-${first.pr.i + 1}` : `shot-f${f.n}-m${k}-1`;
		const preview = first.pr ? evPop(first.pr.item.src, readFile, 1, cmp.prH) : evPop(first.main.src, readFile, 1, 'Latest build');
		return ` <span class="st-sep" aria-hidden="true">&middot;</span> <a class="st-ev" href="#${id}" data-open="${id}"`
			+ ` aria-label="Compare screenshots from this ${cmp.prH.replace(/^This /, '')} and the latest build">${preview}${ICON.photo}<span class="st-cmp">PR vs latest build</span></a>`;
	}
	const shots = findingShots(f);
	const mine = shots.map((item, i) => ({ item, i })).filter(({ item }) => item.step?.order === k);
	if (!mine.length) {
		return '';
	}
	const count = mine.length;
	const label = count > 1 ? `${count} screenshots for this step` : 'Screenshot for this step';
	// A preview on hover or focus keeps the screenshot a glance away without
	// putting it in the reading flow.
	return ` <span class="st-sep" aria-hidden="true">&middot;</span> <a class="st-ev" href="#shot-f${f.n}-${mine[0].i + 1}" data-open="shot-f${f.n}-${mine[0].i + 1}"`
		+ ` aria-label="${label}">${evPop(mine[0].item.src, readFile, count)}${ICON.photo}${count > 1 ? `<span class="st-n">${count}</span>` : ''}</a>`;
}

/** Every file beside the report the page links to as a log, for a check that each exists. */
export function linkedLogs(report) {
	const paths = [
		...report.logs.map(l => l.path).filter(p => !/\/$/.test(p) && logFile(p)),
		...report.findings.flatMap(f => f.errors.map(e => logFile(e.source)?.path)).filter(Boolean),
	];
	return [...new Set(paths)];
}

/**
 * A repo-relative path as a link to that file at the report's commit, or null
 * for anything that is not one: an absolute path, a URL, or no commit to pin.
 */
function sourceHref(path, sha, line) {
	const p = String(path ?? '').replace(/^\.\//, '');
	// An installed package, such as a Python traceback's frame in a venv, is not in the repo.
	if (!p || !/^[0-9a-f]{7,40}$/i.test(sha ?? '') || /^([a-z][a-z0-9+.-]*:|\/|~|\.\.)/i.test(p) || /(^|\/)(site-packages|node_modules)\//.test(p)) {
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

/** One closed row at the end of a card: a label, a quiet tail, and its content. */
function collapsedRow(cls, label, tail, body) {
	return `<details class="lc${cls}"><summary>${ICON.disclose('lc-chev')}`
		+ `<span>${label}<span class="lc-tail"> &middot; ${tail}</span></span></summary>`
		+ `<div class="lc-body">${body}</div></details>`;
}

/** A file beside the report as a link, or plain text when it is not there to open. */
function logLink(path, text, exists, cls = 'log-link') {
	return !/\/$/.test(path) && (!exists || exists(path))
		? `<a href="${escapeHtml(path)}" class="${cls}" title="Open the full log" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`
		: `<span class="${cls}">${escapeHtml(text)}</span>`;
}

// Where an error was logged, named so a developer knows where to look.
const PROCESSES = [
	[/^renderer( process)?$/i, 'Renderer process', 'Logged by Positron’s renderer process (the UI), not the extension host or a language runtime'],
	[/^extension host$/i, 'Extension host', 'Logged by the extension host, the process extensions run in'],
	[/^main( process)?$/i, 'Main process', 'Logged by Positron’s main process, which runs the app and its windows'],
	[/^kernel supervisor$/i, 'Kernel supervisor', 'Logged by the kernel supervisor (Kallichore), which starts and watches the language runtimes'],
	[/^(python|r) (kernel|console)$/i, null, 'Logged by the language runtime'],
];

/** The process field of an error's meta, with a tooltip saying what it means. */
function processHtml(text, html) {
	const known = PROCESSES.find(([re]) => re.test(text.trim()));
	return known
		? `<span title="${escapeHtml(known[2])}">${known[1] ? escapeHtml(known[1]) : html}</span>`
		: `<span>${html}</span>`;
}

/** The process a log line was logged by: the bullet's own, else its file's. */
function logProcess(e) {
	return e.process || fileProcess(logFile(e.path)?.path ?? e.path);
}

/** Verbatim log text, with `==value==` as a highlight. */
function logTextHtml(text) {
	return escapeHtml(text).replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
}

/** One piece of evidence: a muted header line over the text as logged. */
function evidenceSnippet(cls, head, code) {
	return `<div class="ev-snip${cls}"><div class="ev-snip-h">${head.filter(Boolean).join('')}</div>`
		+ `<div class="ev-snip-b">${code}</div></div>`;
}

/**
 * Proof that is not tied to a step, as logs only: logged errors, log lines and
 * lines that should have been logged and were not. Every screenshot is on the
 * step it proves, and interpretation belongs in Observed or Likely cause, so a
 * card with neither has no Evidence row.
 */
function renderEvidenceRow(f, sha, exists) {
	// A message with no stack and no file:line is not something a reader can act
	// on here; it stays in the agent prompt.
	const errors = f.errors.filter(e => e.frames.length || /[\w.-]+\.\w+:\d+/.test(e.message));
	const logs = f.evidence.filter(e => e.kind === 'log' && e.quote && isPositronLog(e.path));
	const missing = f.evidence.filter(e => e.kind === 'missing' && e.quote);
	if (!errors.length && !logs.length && !missing.length) {
		return '';
	}
	// The line is in the text, not the href: a static file cannot jump to it.
	const link = path => (logFile(path) ? logLink(logFile(path).path, path, exists) : `<span class="log-link">${escapeHtml(path)}</span>`);
	const errorHtml = errors.map(e => {
		const frames = e.frames.map(fr => {
			const loc = fileLink(fr.path, sourceHref(fr.path, sha, fr.line), 'err-loc', `:${fr.line}`);
			return `\n  at ${fr.fn ? `${escapeHtml(fr.fn)} (${loc})` : loc}`;
		}).join('');
		return evidenceSnippet('', [
			e.source && link(e.source),
			...e.metaHtml.map((m, k) => (k === 0 ? processHtml(e.meta[0], m) : `<span>${m}</span>`)),
		], `${e.message ? `<span class="ev-err">${escapeHtml(e.message)}</span>` : ''}${frames}`);
	}).join('');
	const logHtml = logs.map(e => {
		const process = logProcess(e);
		const when = e.when || /\b\d{2}:\d{2}:\d{2}\b/.exec(e.quote)?.[0];
		return evidenceSnippet('', [
			link(e.path),
			process && processHtml(process, escapeHtml(process)),
			when && `<span>${escapeHtml(when)}</span>`,
		], logTextHtml(e.quote));
	}).join('');
	const missingHtml = missing.map(e => evidenceSnippet(' ev-miss', [
		'<span class="ev-miss-k">Not logged</span>',
		link(e.path),
		e.window && `<span>${escapeHtml(e.window)}</span>`,
	], logTextHtml(e.quote))).join('');
	const count = errors[0]?.count ?? 1;
	const lines = logs.reduce((n, e) => n + e.quote.split('\n').length, 0);
	const tail = [
		errors.length === 1 ? `1 error${count > 1 ? `, <span class="n-x">${count}x</span>` : ''}` : errors.length ? plural(errors.length, 'error', 'errors') : '',
		lines ? plural(lines, 'log line', 'log lines') : '',
		missing.length ? `${missing.length} missing` : '',
	].filter(Boolean).join(', ');
	return collapsedRow(' ev', 'Evidence', tail, errorHtml + logHtml + missingHtml);
}

function renderRegressionTest(f, sha) {
	const { cases, related } = f.tests;
	// Tests are aimed at the Cause, so they are no better than the finding the verifier judged.
	if (!cases.length || f.verified === 'disputed') {
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
		return row(c.level, [`Add to ${fileLink(c.path, isNewTestFile(c) ? null : sourceHref(c.path, sha), 'rt-file')}`, c.noteHtml]);
	};
	const plural = cases.length > 1;
	const named = new Set(cases.map(c => c.path));
	const others = related.filter(r => !named.has(r.path));
	const othersHtml = others.length
		? '<div class="rt-group"><div class="rt-label">Other tests that touch this code</div><ul class="rt-other">'
			+ others.map(r => `<li>${row(r.level, [fileLink(r.path, sourceHref(r.path, sha), 'rt-file'), r.noteHtml])}</li>`).join('')
			+ '</ul></div>'
		: '';
	const tail = `${cases.length} missing case${plural ? 's' : ''}${f.verified === 'unresolved' ? ' \u00b7 finding unresolved' : ''}`;
	return collapsedRow(' regtest', 'Test gap', tail,
		`<div class="rt-group"><div class="rt-label">Suggested case${plural ? 's' : ''}</div>`
		+ `<ol class="rt-cases">${cases.map(c => `<li>${c.textHtml}${where(c)}</li>`).join('')}</ol></div>`
		+ othersHtml);
}

/** Proof, then hypothesis, then the missing test; each only when it has something to say. */
function renderCardDetails(f, report, options = {}) {
	const sha = report.chips[1];
	const rows = [
		renderEvidenceRow(f, sha, options.fileExists),
		f.causeHtml ? collapsedRow(' hyp', 'Likely cause', f.corrected?.includes('cause') ? 'Revised in review' : 'Hypothesis', `<p>${f.causeHtml}</p>`) : '',
		renderRegressionTest(f, sha),
	].filter(Boolean);
	return rows.length ? `<div class="card-details">${rows.join('')}</div>` : '';
}

/**
 * The card's linked-issue status, as items for the end of its meta line: a fix
 * that did not hold or an issue that came back, then its matches by kind.
 * When verify rejected the finding, its issue line stands in without the claim.
 */
function cardIssueItems(f, word, ki, refs) {
	const rejected = isRejected(word);
	const failed = ki?.fixFailed.get(f.n) ?? [];
	const back = ki?.cameBack.get(f.n) ?? [];
	// A label is a prefix, or a function of the numbers when they sit mid-label (`Fixed in #N?`).
	const item = (label, numbers) => {
		const nums = numbers.map(n => kiNum(n, refs)).join(' ');
		return `<span class="f-ki">${typeof label === 'function' ? label(nums) : `${label} ${nums}`}</span>`;
	};
	const items = [];
	if (failed.length) {
		items.push(item(rejected ? 'Fixes' : failed.some(i => ki.partly?.has(i.number)) ? 'Partly fixed' : 'Not fixed', failed.map(i => i.number)));
	} else if (back.length) {
		items.push(item(rejected ? 'Closed &middot;' : 'Regressed', back.map(i => i.number)));
	}
	for (const m of matchesByKind(possiblyKnown(f, ki), refs)) {
		items.push(item(m.label, m.numbers));
	}
	if (f.intended?.length) {
		items.push(item('Won&rsquo;t fix?', f.intended));
	}
	return items;
}

function renderFindingCard(f, report, options) {
	const prompts = options.agentPrompts !== false;
	const issue = issueLink(f, report, options);
	const context = [];
	const word = statusWord(f);
	if (word === 'confirmed') {
		context.push(`<span class="confirmed">${ICON.check(12)}Confirmed</span>`);
	} else if (word) {
		context.push(verdictTag(word));
	}
	if (f.reproduced) {
		context.push(`<span class="reproduced">Reproduced ${escapeHtml(f.reproduced)}</span>`);
	}
	// After the verdict and its rate, as in the table, before the linked issues.
	const origin = cardGroup(report, f, groupOf(report, f, options.changeBase, options.ki), options.ki);
	if (origin) {
		context.push(origin);
	}
	// Linked issues describe the finding as these do, so they close the meta line.
	context.push(...cardIssueItems(f, word, options.ki, options.refs));
	const contextHtml = context.join('<span class="sep" aria-hidden="true">&middot;</span>');

	const meta = '<div class="meta">'
		+ `<span class="group identity"><span class="who">Finding ${f.n}</span>${pill(f.severity)}</span>`
		+ '<span class="rule" aria-hidden="true"></span>'
		+ `<span class="group context">${contextHtml}</span>`
		+ renderIssueButton(f, issue)
		+ (prompts ? renderCopyButton(f) : '')
		+ renderLinkButton(f)
		+ '</div>';

	const head = `<header>${meta}`
		+ `<h2 class="card-title">${escapeHtml(f.title)}</h2>`
		+ '</header>';

	const promptBlock = (prompts ? renderPromptBlock(f, report, options) : '') + renderIssueBlock(f, issue);
	const feedback = renderFeedbackRow(f, options);
	// A saved file the card names opens its viewer. Not the prompt block: that
	// is raw text, and it carries the files itself.
	const files = options.files ?? [];

	// The claim's facts before the procedure, as one comparison: what the run
	// saw, marked by severity, beside what should have happened.
	const half = (cls, label, html) => (html ? `<div class="${cls}"><div class="f-lab">${label}</div><p class="f-txt">${html}</p></div>` : '');
	const comparison = f.observedHtml || f.expectedHtml
		? `<div class="f-cmp ${f.severity}">${half('f-cmp-o', 'Observed', f.observedHtml)}${half('f-cmp-e', 'Expected', f.expectedHtml)}</div>`
		: '';

	// Text only: each step's screenshots open from its icon.
	// Setup is a list, one line per precondition, each with its own P over the
	// step numbers. The line is the full item, with its versions, file and
	// command in view; Coverage keeps the short names.
	const preconditions = f.preconditions.length
		? '<ul class="f-pl" aria-label="Preconditions">'
		+ f.preconditions.map((p, k) => `<li><span class="f-pl-p tip" aria-hidden="true" data-tip="Precondition">P</span>${withCodeCopy(p || f.preconditionNames?.[k] || '')}</li>`).join('')
		+ '</ul>'
		: '';
	// The card's Observed says what went wrong, so a step repeats it only when
	// two failed checks saw different things.
	const failed = f.steps.filter(st => st.result === 'fail');
	const observed = failed.length >= 2 && new Set(failed.map(st => st.observed)).size >= 2;
	// A step the replay on main screenshotted compares the two builds.
	const group = groupOf(report, f, options.changeBase, options.ki);
	const comparisonOf = k => stepComparison(report, f, group, options.mainBuild, k);
	const steps = f.steps.length
		? '<div class="repro-group steps">'
		+ `<ol class="repro-steps steps">${f.steps.map((st, k) => renderStep(st, { id: `f${f.n}-s${k + 1}`, observed, ev: st.kind === 'verify' ? stepShotIcon(f, k + 1, options.readFile, comparisonOf(k + 1)) : '' })).join('\n')}</ol></div>`
		: '';
	// Linked first: a bare code span naming a saved file becomes its chip, not a copy target.
	const repro = (preconditions || steps)
		? copyableCode(linkFiles(`<div class="f-sec repro"><div class="f-lab">Steps to Reproduce</div>${preconditions}${steps}</div>`, files))
		: '';

	const details = renderCardDetails(f, report, options);

	return `<article id="f${f.n}" class="card${f.severity === 'major' ? ' major' : ''}">
${linkIssues(linkFiles(`${head}
${comparison}
${repro}
${details}`, files), options.refs)}
${renderShotLinks(f, comparisonOf)}
${feedback}
${promptBlock}
</article>`;
}

// Under All, the passes past the first few wait behind "Show all": issues and
// not-run rows are always listed, since those are what a reviewer scans for.
const COVERAGE_PASSES_SHOWN = 4;

function renderCoverage(report, options = {}) {
	const files = options.files ?? [];
	const { exercised, notExercised } = report.coverage;
	if (!exercised.length && !notExercised.length) {
		return '';
	}

	// One table, in a fixed order. Rows are numbered in display order, so a
	// precondition can link to the row of the scenario that created its state.
	const { issues, passes, rowId } = coverageOrder(report.coverage);
	const total = exercised.length + notExercised.length;
	const hidden = Math.max(0, passes.length - COVERAGE_PASSES_SHOWN);
	const ki = options.ki;
	// What the row showed about the linked issues leads its result, after any
	// finding link. One tag per outcome, listing its issues: "Also observed #1, #2".
	// The issues of findings verify rejected: never "Not fixed" or "Regressed".
	const rejectedIssues = new Set((report.findings ?? []).filter(f => isRejected(statusWord(f)))
		.flatMap(f => [...(ki?.fixFailed.get(f.n) ?? []), ...(ki?.cameBack.get(f.n) ?? [])].map(i => i.number)));
	const kiTags = row => {
		const groups = new Map();
		for (const { n, kind } of row.issues ?? []) {
			const issue = ki?.byNumber.get(n);
			const rejected = rejectedIssues.has(n);
			const label = !issue ? null
				: issue.relation === 'fixes' ? (kind === 'held' ? 'Fix verified for' : rejected ? 'Fixes' : 'Not fixed')
					: kind === 'observed' ? 'Also observed' : kind === 'back' ? (rejected ? 'Closed &middot;' : 'Regressed') : null;
			if (label) { groups.set(label, [...(groups.get(label) ?? []), kiNum(n, ki)]); }
		}
		return [...groups].map(([label, nums]) => `${label} ${nums.join(', ')}`);
	};
	const result = (row, lead = []) => [...lead, ...kiTags(row), row.resultHtml && linkIssues(row.resultHtml, options.refs)].filter(Boolean).join(' &middot; ');
	const byLedgerId = new Map(exercised.filter(r => r.id).map(r => [r.id, r]));

	// A passing row's screenshot hangs off the verify step it proves rather than
	// a column. A row's shots are one lightbox group.
	const photo = (row, i, shot) => {
		const name = row.scenario;
		return ` <span class="st-sep" aria-hidden="true">&middot;</span> <a class="st-ev" href="${escapeHtml(shot.href)}" data-lb="cv-${i}"`
			+ ` data-caption="${escapeHtml(name)}" data-file="${escapeHtml(shot.file)}"`
			+ ` aria-label="Screenshot for this step: ${escapeHtml(name)}">${evPop(shot.href, options.readFile)}${ICON.photo}</a>`;
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
			// A saved file the how-to names opens its viewer from here too.
			return `<span class="pre-i"><b>${p.nameHtml}</b>${from}${linkFilePaths(p.howHtml, files)}</span>`;
		}).join('');
		return '<p class="cv-pre" tabindex="0" aria-label="Preconditions">'
			+ '<span class="pre-mark" aria-hidden="true">P</span>'
			+ row.pre.map(p => p.nameHtml).join(', ')
			+ `<span class="pre-pop" role="tooltip"><span class="pre-t">Preconditions</span>${items}</span></p>`;
	};

	// The finding link leads: it is where a reader goes next. A finding row does
	// not expand: its steps are on the card it links to. It only maps the
	// scenario to its findings; the card has the bug and its rate.
	const issueRows = issues.map(row => {
		// Every finding the row hit, not just its first: a step can fail on another.
		const ns = [...new Set([row.finding, ...(row.findings ?? []), ...(row.steps ?? []).map(st => st.finding)].filter(Boolean).map(Number))].sort((a, b) => a - b);
		const links = ns.map(n => `<a href="#f${n}" class="cv-f">Finding ${n}</a>`);
		const html = ns.length ? [...links, ...kiTags(row)].join(' &middot; ') : result(row);
		return `<div class="row coverage-grid cf-r cf-i" id="${rowId.get(row)}">`
			+ scenario(row, 'issue')
			+ `<span class="cov-result">${html}</span>`
			+ '<span></span></div>';
	});

	// A passing row opens on its preconditions and the steps that exercised it.
	const passRows = passes.map((row, i) => {
		const cls = `cf-r cf-p${i < COVERAGE_PASSES_SHOWN ? '' : ' cov-extra'}`;
		const cells = scenario(row, 'pass') + `<span class="cov-result">${result(row)}</span>`;
		const steps = row.steps.length
			? copyableCode(`<ol class="steps">${row.steps.map(st => renderStep(st, { tail: st.evidence.map(e => photo(row, i, e)).join('') })).join('\n')}</ol>`)
			: '';
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
		+ `<span class="cov-notrun"><span class="cov-nr">Not run</span>${row.reasonHtml ? ` &middot; ${linkIssues(row.reasonHtml, options.refs)}` : ''}</span>`
		+ '</div>');

	// Visually hidden radios ahead of the tabs and card, so CSS can filter the
	// rows and arrow keys move between tabs. A kind with no rows gets no tab.
	const kinds = [
		{ id: 'all', label: 'All', n: total },
		{ id: 'i', label: 'Failed', n: issues.length },
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
<div class="section-head"><h2 class="section-label">Exploratory Coverage</h2></div>
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

/** The ledger and every file the run kept, as two Run details parts. */
function runFiles(report, options) {
	const sep = ' <span class="log-sep" aria-hidden="true">&middot;</span> ';
	const parts = [];
	if (options.ledger) {
		parts.push({ title: 'Test ledger', html: '<p>Every scenario\u2019s preconditions, steps and checks, recorded as the run went: '
			+ '<a href="ledger.md" class="log-file">ledger.md</a></p>' });
	}
	if (report.logs.length) {
		const rows = report.logs.map(l => `<li>${logLink(l.path, l.path, options.fileExists, 'log-file')}`
			+ [l.sourceHtml, l.noteHtml].filter(Boolean).map(t => `${sep}<span class="log-note">${t}</span>`).join('')
			+ '</li>');
		parts.push({ title: 'Logs', html: '<p>Everything captured during the run, saved next to this report. '
			+ 'Error lines are also in each finding\u2019s Evidence and agent prompt.</p>'
			+ `<ul class="log-list">${rows.join('')}</ul>` });
	}
	const files = renderTestFilesPart(options.files ?? []);
	if (files) {
		parts.push(files);
	}
	return parts;
}

function renderFolds(report, options = {}) {
	const folds = [];
	// Files sit after what the run did and before how the build was proved.
	const written = report.runDetails ?? [];
	const at = written.findIndex(s => /^branch verification$/i.test(s.title));
	const files = runFiles(report, options);
	const details = at === -1 ? [...written, ...files] : [...written.slice(0, at), ...files, ...written.slice(at)];
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
 * The signature: a maker's mark linking to the skill, not a report section (the cost stays on the Run tile).
 * The copyright is dated by the run, not the render, so re-rendering an old run keeps its year.
 */
function renderSignature(startedAt = new Date(), version = null) {
	// Read like a package name. Left out, never blank, when there is no version.
	const name = `exploratory-test ${version ? `<span class="sig-ver">v${escapeHtml(version)}</span> ` : ''}&#8599;`;
	const link = `<a class="sig-link" href="${escapeHtml(SKILL_URL)}" target="_blank" rel="noreferrer">${name}</a>`;

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
<p class="sig-legal">&copy; ${startedAt.getFullYear()} Posit Software, PBC</p>
</footer>`;
}

/**
 * Renders the report model, reportFromJson's, as a self-contained HTML page.
 * `options.ledger` is the run's ledger.md. `options.startedAt` is when the run
 * began, which dates the footer's copyright; it defaults to now.
 */
export function renderReportHtml(report, options = {}) {
	// `readFile` reads a path beside the report; the viewer, the Test files
	// list and the prompt all show the same resolved files.
	options = { ...options, files: resolveFiles(report.files, options.readFile) };
	// The issues linked to the PR, fetched before the run, and what it found about each.
	const ki = options.knownIssues?.issues?.length
		? { ...knownIssueOutcomes(options.knownIssues, report.coverage, report.verification?.linked, new Map(report.findings.map(f => [f.n, f.known ?? []]))), now: options.startedAt ?? new Date() }
		: null;
	options.ki = ki;
	// Every issue or PR the report names, for its preview card: the PR's list, then the rest it mentions.
	options.refs = {
		byNumber: new Map([...(options.issueRefs ?? []).map(i => [i.number, i]), ...(ki?.byNumber ?? [])]),
		now: options.startedAt ?? new Date(),
	};
	// A fix the ledger says nothing about is still listed: an untested fix is never invisible.
	for (const issue of ki?.unaccounted ?? []) {
		report.coverage.notExercised.push({
			id: '',
			scenarioHtml: escapeHtml(issue.title),
			reasonHtml: `Fix for #${issue.number} not exercised: the run did not record it`,
			issues: [{ n: issue.number, kind: 'not-exercised' }],
		});
		report.scenarios.notRun++;
	}
	const viewers = renderFileViewers(options.files);
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

	// What Slack and other chat apps show when the link is pasted.
	const previewText = escapeHtml(previewSummary(report));
	// Absolute, or chat apps show no image; the caller passes it only once og.png is written.
	const severities = severityWords(report.severityCounts);
	const { major, moderate, minor } = report.severityCounts;
	const findings = major + moderate + minor === 1 ? 'finding' : 'findings';
	const ogImage = options.ogImage ? `
<meta property="og:image" content="${escapeHtml(options.ogImage)}">
<meta property="og:image:width" content="${CARD_WIDTH}">
<meta property="og:image:height" content="${CARD_HEIGHT}">
<meta property="og:image:alt" content="${severities ? `${severities} ${findings}` : 'No findings'}">` : '';

	const page = `<!DOCTYPE html>
<html lang="en" data-theme="professional">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
${previewText ? `<meta name="description" content="${previewText}">\n` : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="Positron exploratory test">
<meta property="og:title" content="${escapeHtml(capitalize(report.title))}">${previewText ? `\n<meta property="og:description" content="${previewText}">` : ''}${ogImage}
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
<div class="eyebrow"><span class="kicker">Exploratory test</span>${chips ? '<span class="bullet"></span>' : ''}${chips}${HEADER_ACTIONS}</div>
<h1 class="title">${escapeHtml(report.title)}</h1>
${report.leadHtml ? `<p class="lead">${linkIssues(report.leadHtml, options.refs)}</p>` : ''}
</header>

${renderTiles(report)}

${renderFindingsList(report, ki, options.refs, options.changeBase, options.mainBuild)}

${report.findings.map(f => renderFindingCard(f, report, options)).join('\n\n')}

${linkFiles(renderCoverage(report, options), options.files)}

${linkIssues(renderFolds(report, options), options.refs)}

${renderSignature(options.startedAt, options.skillVersion)}

</main>
<div class="lb" id="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" hidden>
<button type="button" class="lb-backdrop" tabindex="-1" aria-label="Close"></button>
<div class="lb-panel">
<div class="lb-img"><img alt="">
<div class="lb-cmp" hidden><div><div class="lb-cmp-h"><b></b><span></span></div><img class="shot-full" alt=""><p class="lb-none" hidden></p></div><div><div class="lb-cmp-h"><b>Latest build</b><span></span></div><img class="shot-full" alt=""><p class="lb-none" hidden></p></div></div>
<button type="button" class="lb-nav lb-prev" hidden>${ICON.prev}</button>
<button type="button" class="lb-nav lb-next" hidden>${ICON.next}</button>
</div>
<div class="lb-foot">
<div class="lb-meta"><span class="lb-cap"></span><span class="lb-file"></span></div>
<span class="lb-pos" hidden></span>
<button type="button" class="lb-close" aria-label="Close">${ICON.close}</button>
</div>
</div>
</div>
${viewers}
<a class="to-top tip" href="#top" data-tip="Back to top" aria-label="Back to top" tabindex="-1">${ICON.up}</a>
</div>
<script>${PAGE_SCRIPT}</script>
${viewers ? `<script>${FILE_SCRIPT}</script>\n` : ''}`;
	// Each script ships only when the page has what it drives. Code blocks in
	// steps have copy buttons even when agent prompts are off.
	const scripts = [
		[prompts || page.includes('class="code-cp"'), COPY_SCRIPT],
		[page.includes(' data-issue="'), ISSUE_SCRIPT],
		[page.includes(' data-link-to="'), LINK_SCRIPT],
		[page.includes('<code class="cc"'), CODE_CHIP_SCRIPT],
		[page.includes(' data-title="'), KI_SCRIPT],
		[page.includes('<span class="ki-cnt"'), KI_LIST_SCRIPT],
		[page.includes('<div class="fb" '), FEEDBACK_SCRIPT],
	].filter(([on]) => on).map(([, script]) => `<script>${script}</script>\n`).join('');
	return `${page}${scripts}</body>
</html>
`;
}

/**
 * What the page reads from the run directory besides report.json: the ledger,
 * the linked issues known-issues.mjs fetched, the base finish.mjs recorded in
 * change-base.json, and the files the report names.
 */
export function readRunDir(dir) {
	const ledgerPath = join(dir, 'ledger.md');
	const fileExists = path => existsSync(join(dir, path));
	const files = join(dir, 'files');
	return {
		ledger: existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : undefined,
		actionsLog: existsSync(join(dir, 'actions.log')) ? readFileSync(join(dir, 'actions.log'), 'utf8') : undefined,
		// Set by a local pipeline run, which names a session per run; CI drives its own.
		session: process.env.PW_SESSION || undefined,
		knownIssues: readKnownIssues(dir) ?? undefined,
		issueRefs: readIssueRefs(dir),
		changeBase: readJson(join(dir, 'change-base.json'), undefined),
		// The build of main the explorer replayed findings on, when the run had one.
		mainBuild: readJson(join(dir, 'main-build.json'), undefined),
		fileExists,
		readFile: path => (fileExists(path) && statSync(join(dir, path)).isFile() ? readFileSync(join(dir, path)) : null),
		// Every file saved under files/, so lint can find one the ledger never listed.
		listFiles: () => (existsSync(files)
			? readdirSync(files, { recursive: true }).map(p => join(files, p)).filter(p => statSync(p).isFile()).map(p => relative(dir, p).split('\\').join('/'))
			: []),
	};
}

/** The logs and test files the report lists that are not in the run directory. */
export function missingFiles(parsed, fileExists) {
	return {
		logs: linkedLogs(parsed).filter(p => !fileExists(p)),
		files: parsed.files.map(f => f.path).filter(p => !fileExists(p)),
	};
}

/**
 * Writes the page to `out`, with its link card beside it when `base` is a URL:
 * chat apps need an absolute one to fetch the image from.
 *
 * @param {string} out
 * @param {{ severityCounts: object }} report reportFromJson's model
 * @param {object} options renderReportHtml's options; `base` is required
 */
export async function writeRunPage(out, report, options) {
	const { base } = options;
	const ogImage = /^https?:\/\//.test(base ?? '') && await writeCard(join(dirname(out), CARD_FILE), report.severityCounts)
		? `${base.replace(/\/$/, '')}/${CARD_FILE}`
		: undefined;
	writeFileSync(out, renderReportHtml(report, { ...options, ogImage }));
}
