/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// What a finding card sends elsewhere: the prompt for an agent, the GitHub
// issue, and the team's feedback form, with the evidence and error text they
// share.

import { parseSystemLine } from '../shared/ledger.mjs';
import { escapeHtml, escapeRegExp } from '../shared/text.mjs';
import { promptFilesSection, filesNamedIn, fileSource } from './repro-files.mjs';
import { absolutePath, capitalize, countText, escapeLoneTildes, ICON, logFile, REPO_URL, safeLinks, SEVERITY_LABEL, statusWord } from './page-common.mjs';

/**
 * A finding's Evidence as list items. `where` places a path beside the report;
 * `shot` names a screenshot.
 */
function evidenceItems(f, where, shot) {
	return f.evidence.map(e => {
		if (e.kind === 'shot') {
			return `- ${shot(e)} \u2014 ${e.step ? `${e.step.label}: ` : ''}${e.caption}`;
		}
		if (e.kind === 'log' || e.kind === 'missing') {
			const text = e.quote.replace(/==([^=\n]+)==/g, '$1');
			const quote = /["\u201c\u201d]/.test(text) ? text : `\u201c${text}\u201d`;
			return `- ${e.kind === 'missing' ? `Not logged in ${where(e.path)}${e.window ? ` (${e.window})` : ''}` : where(e.path)} \u2014 ${quote}${e.note ? ` (${capitalize(e.note)})` : ''}`;
		}
		return `- ${e.text}`;
	}).concat(f.errors.map(e => {
		// A logged error is evidence in its own right: where it is, and what it said.
		const file = logFile(e.source);
		if (!file || f.evidence.some(ev => ev.kind === 'log' && ev.path === e.source)) {
			return null;
		}
		const [at, ...counts] = e.meta;
		const said = e.message.split('\n')[0];
		return `- ${where(e.source)}${said ? ` \u2014 \u201c${said}\u201d` : ''}`
			+ (e.meta.length ? ` (${[at, ...counts.map(countText)].filter(Boolean).join(', ')})` : '');
	}).filter(Boolean)).join('\n');
}

/** Each error fenced, then where it was logged. `clip` shortens the fenced text. */
function errorOutput(f, where, clip = text => text) {
	return f.errors.map(e => {
		if (!logFile(e.source)) {
			return [[e.source, ...e.meta].filter(Boolean).join(' | '), e.raw && fenced(clip(e.raw))].filter(Boolean).join('\n');
		}
		const [at, ...counts] = e.meta;
		const tail = [at && ` (${at})`, counts.length && `, ${counts.map(countText).join(', ')}`].filter(Boolean).join('');
		return [e.raw && fenced(clip(e.raw)), `Logged in ${where(e.source)}${tail}.`].filter(Boolean).join('\n');
	}).join('\n\n');
}

/** The test gap's suggested cases as `{ heading, body }`, or null when there are none to suggest. */
function regressionTest(f) {
	const { cases, related } = f.tests;
	if (!cases.length || f.verified === 'disputed') {
		return null;
	}
	const named = new Set(cases.map(c => c.path));
	const others = related.filter(r => !named.has(r.path));
	return {
		heading: f.verified === 'unresolved' ? 'Test gap (suggestion; the verifier left this finding unresolved)' : 'Test gap (suggestion)',
		body: [
			...cases.map(c => `- ${c.text}${c.path ? ` \u2192 add to ${c.path}${c.level ? ` (${c.level})` : ''}` : c.level ? ` \u2192 ${c.level} test; place it per the repo's test guidance` : ''}`),
			others.length && `Other tests that touch this code: ${others.map(r => `${r.path}${r.level ? ` (${r.level})` : ''}`).join(', ')}`,
		].filter(Boolean).join('\n'),
	};
}

/**
 * The finding as a Markdown prompt an agent can be handed, from the same parsed
 * fields the card renders. A section with nothing in it is left out rather than
 * printed as an empty heading.
 */
function buildAgentPrompt(f, report, options = {}) {
	const base = options.base;
	const t = f.text;
	const word = statusWord(f);
	const title = capitalize(safeLinks(/[.!?]$/.test(f.title) ? f.title : `${f.title}.`));
	const out = [`## Finding ${f.n} \u2014 ${SEVERITY_LABEL[f.severity]}`, '', title, ''];
	const status = [
		word && `Status: ${capitalize(word)}`,
		f.reproduced && `Reproduced: ${f.reproduced}`,
	].filter(Boolean);
	out.push(...status, '');
	const section = (heading, body) => {
		if (body) {
			out.push(`### ${heading}`, safeLinks(body), '');
		}
	};
	// So the agent checks these before fixing or filing it again.
	section('Possible duplicates', possiblyKnown(f, options.ki).map(n => {
		const issue = options.ki?.byNumber.get(n);
		return `- ${REPO_URL}/issues/${Number(n)}${issue ? ` (${issue.state === 'closed' ? 'closed' : 'open'}): ${issue.title}` : ''}`;
	}).join('\n'));
	// A match on a not-planned issue: check it was not judged intended before fixing.
	section('Closed as not planned', (f.intended ?? []).map(n => `- ${REPO_URL}/issues/${Number(n)}`).join('\n'));
	section('Observed', capitalize(t.observed));
	section('Expected', capitalize(t.expected));
	section('Preconditions', t.preconditions.length === 1
		? t.preconditions[0]
		: t.preconditions.map(p => `- ${p}`).join('\n'));
	// The files the setup and steps name, with their text: the agent cannot
	// reproduce from a file it only knows by name.
	section('Files', promptFilesSection(options.files ?? [], [...t.preconditions, ...t.steps].join('\n'),
		p => absolutePath(p, base), fenced));
	// A step's own block stays under its number.
	section('Reproduction', t.steps.map((step, i) => `${i + 1}. ${step.replace(/\n/g, '\n   ')}`).join('\n'));
	section('Evidence', evidenceItems(f, p => absolutePath(p, base), e => absolutePath(e.src, base)));
	// Every error, including the ones the card hides for having no stack: a bare
	// message is still a lead for whoever picks this up.
	section('Error output', errorOutput(f, p => absolutePath(p, base)));
	section('Likely cause (hypothesis, not verified)', capitalize(t.cause));
	const regression = regressionTest(f);
	if (regression) {
		section(regression.heading, regression.body);
	}
	const [branch, sha] = report.chips;
	section('Context', [report.pr && `PR: ${report.pr.url}`, branch && `Branch: ${branch}`, sha && `Commit: ${sha}`, options.diff && `Diff: ${options.diff}`]
		.filter(Boolean).join('\n'));
	out.push('Please investigate this finding using the repository and the evidence above.');
	return out.join('\n');
}

// A fence longer than any backtick run inside, so a log line starting with
// ``` cannot close the block early.
function fenced(text, lang = '') {
	const longest = Math.max(2, ...(text.match(/`+/g) || []).map(run => run.length));
	const fence = '`'.repeat(longest + 1);
	return `${fence}${lang}\n${text}\n${fence}`;
}

export function renderCopyButton(f) {
	return `<button type="button" class="cp-btn" data-tip="Copy agent prompt" data-prompt="prompt-f${f.n}" aria-label="Copy prompt for an agent: finding ${f.n}">`
		+ `${ICON.copy}${ICON.copied}</button>`;
}

export function renderLinkButton(f) {
	return `<button type="button" class="ln-btn" data-link-to="f${f.n}" data-tip="Copy link" aria-label="Copy link to finding ${f.n}">`
		+ `${ICON.link}${ICON.linked}</button>`;
}

/**
 * Text for a `text/plain` script element. A closing tag ends it early, and a
 * comment opener before a `<script` makes the parser skip the real closing tag
 * and swallow the page; a saved HTML file brings both. The copy handlers undo this.
 */
function scriptText(text) {
	return text.replace(/<(?=\/script|!--)/gi, '<\\');
}

export function renderPromptBlock(f, report, options) {
	return `<script type="text/plain" id="prompt-f${f.n}">${scriptText(buildAgentPrompt(f, report, options))}</script>`;
}

const ISSUE_NEW_URL = `${REPO_URL}/issues/new`;
// GitHub rejects a new-issue link much longer than this.
const ISSUE_URL_MAX = 8000;
// An issue quotes this many lines of each error; the report has the rest.
const ISSUE_ERROR_LINES = 6;

/** The page's public URL: CI publishes one; a local run has only a path, which is never linked. */
function reportUrl(base) {
	return /^https?:\/\//i.test(base ?? '') ? `${base.replace(/\/+$/, '')}/index.html` : null;
}

// Posit team feedback: one Google Form per finding, pre-filled by entry ID. The finding form takes anyone, since a
// background submit cannot tell when Google refuses a signed-out reader.
const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc98gL34VYnh7oZAJ1MVj0HRvFUV9YI4xc8nFvMtWiqrsxiiw/viewform?usp=pp_url';
const FEEDBACK_SUBMIT_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc98gL34VYnh7oZAJ1MVj0HRvFUV9YI4xc8nFvMtWiqrsxiiw/formResponse';
const FEEDBACK_ENTRY = { report: 'entry.1746253506', version: 'entry.1873070470', finding: 'entry.890833928', verdict: 'entry.427792690' };
// A random ID kept per browser, so a count can take each browser's latest
// answer: collecting email would stop a background submit.
export const FEEDBACK_ID_ENTRY = 'entry.1280428395';
// The button's label, then the form's option text. Google silently drops a
// multiple-choice value that does not match its option exactly, apostrophe
// included, so these are copied from the form rather than from the labels.
const FEEDBACK_VERDICTS = [
	['Real issue', 'Real issue'],
	['Not a bug', 'Not a bug'],
	// Useful, but an improvement rather than a defect: filed as `enhancement`.
	['Enhancement', 'Enhancement idea'],
	['Not worth reporting', 'Real, but not worth reporting'],
	['Couldn&rsquo;t tell', 'Couldn\'t tell from the report'],
];

/**
 * A finding's pre-filled answers. The finding is shown above its verdict, so
 * the form says which one it asks about.
 */
function feedbackValues(report, version, finding, verdict) {
	return [
		[FEEDBACK_ENTRY.report, report],
		// With a v, so Sheets keeps it as text: 1.10 would otherwise read as 1.1.
		[FEEDBACK_ENTRY.version, version ? `v${version}` : 'unknown'],
		[FEEDBACK_ENTRY.finding, `Finding ${finding.n} \u00B7 ${finding.title}`],
		[FEEDBACK_ENTRY.verdict, verdict],
	].map(([entry, value]) => `${entry}=${encodeURIComponent(value)}`);
}

function feedbackHref(report, version, finding, verdict) {
	return FEEDBACK_FORM_URL + feedbackValues(report, version, finding, verdict).map(v => `&${v}`).join('');
}

/**
 * What an answer names the report by: its URL once published. A local page
 * has only a path, which is never sent, so it sends `local:`, who ran it, and
 * the run directory's name, the run's timestamp. A published page is public,
 * so it never carries who ran it.
 */
function feedbackReport(base, author) {
	// Either separator, so a Windows path is cut to its name too.
	const name = (base ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
	return reportUrl(base) ?? (name ? `local:${author ? `${author}/` : ''}${name}` : null);
}

// A verdict's `href` is the pre-filled form, for "Add a note" and a modified
// click; `data-submit` records it in one click.
export function renderFeedbackRow(f, options) {
	const url = feedbackReport(options.base, options.author);
	if (!url) {
		return '';
	}
	const report = `${url}#f${f.n}`;
	const links = FEEDBACK_VERDICTS.map(([label, verdict]) => {
		const submit = `${FEEDBACK_SUBMIT_URL}?${feedbackValues(report, options.skillVersion, f, verdict).join('&')}&submit=Submit`;
		return `<a href="${escapeHtml(feedbackHref(report, options.skillVersion, f, verdict))}" data-submit="${escapeHtml(submit)}" data-verdict="${escapeHtml(verdict)}" target="_blank" rel="noopener">${label}</a>`;
	});
	return `<div class="fb" role="group" aria-live="polite" data-report="${escapeHtml(url)}" data-finding="f${f.n}" aria-label="Provide feedback on finding ${f.n}"><span class="fb-q">Is this finding right?</span>${links.join('')}</div>`;
}

/** Positron, OS and each recorded kernel as a bullet; the session is in the steps. */
function systemDetails(report) {
	const env = report.environment.map(l => l.trim().replace(/^[-*]\s+/, '')).filter(Boolean);
	const system = env.map(parseSystemLine).find(Boolean);
	// "Kernels: Ark 0.1.252, Kallichore 0.1.71." gives one bullet per kernel.
	const kernels = (env.map(l => /^Kernels:\s*(.+?)\.?$/i.exec(l)?.[1]).find(Boolean) ?? '')
		.split(/,\s*/).map(k => /^(\S+)\s+(.+)$/.exec(k.trim())).filter(Boolean);
	return [
		'## System details',
		'',
		`- **Positron:** ${system?.positron ?? 'not recorded'}`,
		`- **OS:** ${system?.os ?? 'not recorded'}`,
		...kernels.map(([, name, version]) => `- **${name}:** ${version}`),
	].join('\n');
}

/** The first mention of a saved file in `text`, as "`name` (below)"; a mention inside a code span is left alone. */
function markBelow(text, file) {
	const names = [...new Set([file.path, file.rel, file.name])].map(escapeRegExp).join('|');
	const bare = new RegExp(`(?<![\\w/.-])(?:${names})(?!\\w|\\.\\w)`);
	const quoted = new RegExp(`^\`(?:${names})\`$`);
	let done = false;
	const out = text.split(/(`[^`\n]*`)/).map(part => {
		if (done || (part.startsWith('`') && !quoted.test(part))) {
			return part;
		}
		return part.replace(part.startsWith('`') ? quoted : bare, () => {
			done = true;
			return `\`${file.name}\` (below)`;
		});
	}).join('');
	return { text: out, done };
}

/** A step as the issue writes it: its result in bold, and no log line, which Error messages has. */
function issueStep(step, observed) {
	const result = step.result
		? ` \u2192 **${step.result.toUpperCase()}**${observed && step.observed ? ` (observed: ${step.observed})` : ''}`
		: '';
	return [step.md + result, ...step.rest].join('\n');
}

/**
 * The finding as a GitHub issue body, for an engineer rather than an agent:
 * loosely Positron's issue template, from the same parsed fields as the card.
 * No severity or status, which triage sets; no instructions, and no local path.
 * Evidence is a pointer to the report, not a list: its file names open nothing here.
 * `trim` (0 to ISSUE_TRIMS.length) drops that many of ISSUE_TRIMS, least
 * needed first, for a body too long for the new-issue link.
 */
function buildIssueBody(f, report, options = {}, { trim = 0 } = {}) {
	const drop = new Set(ISSUE_TRIMS.slice(0, trim));
	const t = f.text;
	const [branch, sha] = report.chips;
	const url = reportUrl(options.base);
	const by = url ? `[exploratory test](${url}#f${f.n})` : 'exploratory test';
	const at = [branch && `\`${branch}\``, sha && `\`${sha}\``].filter(Boolean).join(' @ ');
	const of = report.pr ? `#${report.pr.number}${at ? ` (${at})` : ''}` : at;
	const opening = t.opening;
	const out = [`<sub>Reported by ${by}${of ? ` of ${of}` : ''}</sub>`, '', systemDetails(report), ''];
	// Linked both ways, so GitHub cross-references the fix and its PR.
	const failedFixes = options.ki?.fixFailed.get(f.n);
	const back = options.ki?.cameBack.get(f.n);
	const pr = report.pr?.number ?? options.knownIssues?.pr;
	const inPr = pr ? ` in #${pr}` : '';
	const refs = issues => issues.map(i => `#${i.number}`).join(', ');
	if (back) {
		out.unshift(`${refs(back)} regressed${inPr}.`, '');
	}
	if (failedFixes) {
		out.unshift(`The fix for ${refs(failedFixes)}${inPr} didn't hold.`, '');
	}
	const section = (heading, body) => {
		if (body) {
			out.push(`## ${heading}`, escapeLoneTildes(safeLinks(body)), '');
		}
	};
	const fold = (summary, body) => out.push(`<details><summary>${summary}</summary>`, '', escapeLoneTildes(safeLinks(body)), '', '</details>', '');

	section('Describe the issue', opening ? [opening.summary, opening.where].filter(Boolean).map(capitalize).join('\n\n') : capitalize(t.summary));

	const files = filesNamedIn(options.files ?? [], [...t.preconditions, ...t.steps].join('\n')).filter(file => file.kind !== 'missing');
	const marked = new Set();
	const preconditions = t.preconditions.map(p => files.reduce((text, file) => {
		if (marked.has(file.path)) {
			return text;
		}
		const m = markBelow(text, file);
		if (m.done) {
			marked.add(file.path);
		}
		return m.text;
	}, p));
	// The card's rule: a step repeats what it observed only when two failed checks saw different things.
	const failed = f.steps.filter(st => st.result === 'fail');
	const observed = failed.length >= 2 && new Set(failed.map(st => st.observed)).size >= 2;
	section('Steps to reproduce', [
		preconditions.map(p => `- ${p.replace(/\n/g, '\n  ')}`).join('\n'),
		f.steps.map((st, i) => `${i + 1}. ${issueStep(st, observed).replace(/\n/g, '\n   ')}`).join('\n'),
	].filter(Boolean).join('\n\n'));
	section('Observed', capitalize(t.observed));
	section('Expected', capitalize(t.expected));

	const clip = raw => {
		const lines = raw.split('\n');
		return lines.length > ISSUE_ERROR_LINES ? [...lines.slice(0, ISSUE_ERROR_LINES), '    \u2026'].join('\n') : raw;
	};
	const errors = errorOutput(f, p => p, clip);
	section('Error messages', !errors ? 'None recorded by the run.' : drop.has('errors') ? `In the ${by} report for this run.` : errors);
	section('Evidence', evidenceItems(f, p => p, e => e.file) && `Screenshots and logs are in the ${by} report for this run.`);

	if (t.cause && !drop.has('cause')) {
		fold('Likely cause (hypothesis, not verified)', capitalize(t.cause));
	}
	const regression = regressionTest(f);
	if (regression && !drop.has('regression')) {
		fold(regression.heading, regression.body);
	}
	for (const file of files) {
		const source = drop.has('fileText') ? null : fileSource(file);
		if (source) {
			fold(escapeHtml(file.name), fenced(source.text, source.lang));
		} else {
			out.push(`\`${file.name}\` is in the report's \`files/\` folder.`, '');
		}
	}
	return out.join('\n').trimEnd();
}

/**
 * The claim with its first letter lowercased, unless its first word is a name:
 * a single letter other than A (R), a word with more capitals or digits (PyPI), or one the
 * finding's own text capitalizes mid-sentence (the Quarto preview).
 */
function lowerFirstWord(claim, f) {
	const word = /^[A-Z][A-Za-z0-9'-]*/.exec(claim)?.[0];
	if (!word || (word.length === 1 && word !== 'A') || /[A-Z0-9]/.test(word.slice(1))) {
		return claim;
	}
	const prose = Object.values(f.text ?? {}).flat().join(' ').replace(/`[^`]*`/g, '');
	if (new RegExp(`[a-z,;]\\s+${word}\\b`).test(prose)) {
		return claim;
	}
	return word[0].toLowerCase() + claim.slice(1);
}

function issueHref(title, body) {
	return `${ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&labels=ai-discovered${body === undefined ? '' : `&body=${encodeURIComponent(body)}`}`;
}

// What a body too long for the link gives up, in order: each is on the report,
// and what is left is the repro an engineer files from.
const ISSUE_TRIMS = ['fileText', 'regression', 'cause', 'errors'];

/**
 * The new-issue link for a finding, as `{ href, text, copy }`. The body goes in
 * the link with as few of ISSUE_TRIMS dropped as it takes to fit. When even the
 * shortest does not fit, the link carries the title alone and `copy` is set:
 * the page copies `text`, the full body, on click instead.
 */
export function issueLink(f, report, options = {}) {
	// Positron issues are titled `<Feature>: <description>`.
	const title = f.feature ? `${f.feature}: ${lowerFirstWord(f.title, f)}` : f.title;
	const full = buildIssueBody(f, report, options);
	for (let trim = 0; trim <= ISSUE_TRIMS.length; trim++) {
		const text = trim ? buildIssueBody(f, report, options, { trim }) : full;
		const href = issueHref(title, text);
		if (href.length <= ISSUE_URL_MAX) {
			return { href, text, copy: false };
		}
	}
	return { href: issueHref(title), text: full, copy: true };
}

// A plain link, so it works without JavaScript; the reader files the issue on GitHub with their own account.
export function renderIssueButton(f, issue) {
	return `<a class="gh-btn" href="${escapeHtml(issue.href)}" target="_blank" rel="noopener" data-tip="File a GitHub issue"`
		+ (issue.copy ? ` data-issue="issue-f${f.n}"` : '')
		+ ` aria-label="File a GitHub issue for finding ${f.n} (opens GitHub in a new tab)">${ICON.bug}</a>`;
}

export function renderIssueBlock(f, issue) {
	return `<script type="text/plain" id="issue-f${f.n}">${scriptText(issue.text)}</script>`;
}

/** The verifier's matches, less the finding's own issues. */
export function possiblyKnown(f, ki) {
	return ki ? ki.known.get(f.n) ?? [] : f.known ?? [];
}
