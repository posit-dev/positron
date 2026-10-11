/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The write-up rules a script can check on words alone: steps, preconditions,
 * a finding's title, Observed and Expected, the Result line and the rate.
 * lint-ledger.mjs applies them to the ledger, and lint-json.mjs to report.json.
 * splitProblems sorts every lint line into errors, which make a repro or its
 * evidence wrong, and warnings, which are wording.
 */

import { LOWERCASE_NAMES } from './text.mjs';

// A one-line Result, as explorer.md asks; anything longer is a scenario's worth of notes.
export const RESULT_MAX = 160;

// A step is one action, so the verifier can match it to one line of
// actions.log and a check can sit between any two. A lowercase verb after
// "then" is a second action; a capitalized word is a menu item ("More, then Insert Cell Above").
const REPEATED = /\b(twice|thrice|(?:two|three|four|five|six|seven|eight|nine|ten|\d+) times|each of)\b/i;
// A precondition saying how it was done in the app ("started with Run App", "then opened"): that is a step.
// A scratch path the reader does not have; a workspace is named by what it holds.
const SCRATCH_PATH = /(?:^|[\s`'"(])((?:\/private)?\/(?:tmp|var\/folders)\/\S*|\/(?:Users|home)\/\S*)/;
// An app already serving is what the steps start, so the reader sees it start.
const RUNNING_APP = /\b(?:serving|listening)\b|\b(?:running )?on port \d+|\brunning in (?:\w+ ){0,3}console\b/i;
const DONE_IN_APP = /\b(?:(?:started|opened|launched|clicked|pressed|typed|selected|loaded|sourced|run|ran|executed)\s+(?:with|from|via|by|using)|(?:started|opened|launched|ran|loaded)\s+code|then\s+(?:started|opened|launched|clicked|pressed|typed|selected|ran)|Run(?: Shiny)? App|shown in the|in the session|defined in the|still open|drew|(?:started|opened) (?:in|by) S\d+|S\d+ (?:started|drew|opened|left))\b/i;
// Code a precondition runs rather than describes: loading it is step 1.
const RUN_COMMAND = /^(?:%run\b|%load\b|!|source\(|library\(|require\(|exec\(|import\s|from\s+\S+\s+import\s|install\.packages\(|pip\s)/;
const THEN_ACTION = /(?:,|;|\band)\s+then\s+(run|click|press|open|close|save|type|choose|select|pick|put|untick|tick|evaluate|reload|restart|drag|scroll|copy|paste|delete|remove|add|insert|switch|start|stop|focus|clear|set|toggle|expand|collapse|resize|rename|wait)\b/;
// A session ID changes every launch, so a step that names one cannot be replayed.
// A scenario ID, but not one inside a file name ("settings.S08.json").
export const SCENARIO_ID = /(?<![.\w-])[SN]\d{2,}\b(?!\.\w)/;
const SESSION_ID = /\b(?:python|r)-[0-9a-f]{8}\b/i;
// A second action joined by "and" or a semicolon. "and wait for <state>" is how
// the reader knows the first one finished, so it stays.
const AND_ACTION = /(?:,\s*and\s+(?!wait\s+(?:for|until)\b)(\w+)|;\s*(\w+)|\band\s+(pick|choose|select|click|press|type|run|open|close)\b)/;
// A wait the reader cannot see end; the state it waits for can be. A time is
// kept when the step says what it waits for or why the time matters: a check
// that something does not happen, a timeout, a race.
const WAIT_REASON = /^\s*(?:\S+\s+){0,2}?(?:for\b|until\b)|\b(?:past|longer than|without|timeout|times? out|debounce|expir\w*|throttl\w*|nothing|still|later)\b/i;
const FIXED_WAIT = /\bwait(?:s|ing)?\s+(?:about\s+|at least\s+|up to\s+)?\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|minutes?)\b/i;
const OPENS_PALETTE = /ctrl\+shift\+p|cmd\+shift\+p|\bF1\b|command palette|show all commands/i;

/** The rules every action step follows, in the ledger and on a finding card. */
// An action inside a VERIFY, as most past runs wrote it: "typing `n` shows ...",
// "after running `x`, ...", or a command after a comma ("In the panel, type ...").
// Measured on 3,199 VERIFY lines from 98 runs: 25 hits, none of them a real check.
const VERIFY_ING = 'typing|clicking|double-clicking|right-clicking|pressing|running|executing|opening|closing|expanding|collapsing|scrolling|selecting|hovering|dragging|choosing|entering|saving|switching|toggling|resizing|reloading|restarting';
const VERIFY_IMP = 'type|click|double-click|right-click|press|run|open|expand|collapse|scroll|select|hover|drag|choose|enter|save|switch|toggle|resize|reload|restart';
const VERIFY_ACTION = [
	new RegExp(`(?:^|[,;]\\s*|\\b(?:and|after|before|while|on|when|by|then)\\s+)(${VERIFY_ING})\\s+\\S`, 'i'),
	// Lowercase, and before an object: "Enter creates" is the key, "type int" a label.
	new RegExp(`(?:^|[,;]\\s*)(${VERIFY_IMP})\\s+(?:the|a|an|code|it|on|in)\\b`),
];

export function verifyProblems(where, text) {
	const plain = text.replace(/`[^`]*`/g, 'code').replace(/\s*->.*$/, '').trim();
	const verb = VERIFY_ACTION.map(re => re.exec(plain)?.[1]).find(Boolean);
	return [
		...(verb ? [`${where} VERIFY does something ("${verb}"); make it a step of its own before the check, and keep the VERIFY to what you expect to see`] : []),
		...waitProblems(where, plain),
	];
}

function waitProblems(where, plain) {
	const wait = FIXED_WAIT.exec(plain);
	return wait && !WAIT_REASON.test(plain.slice(wait.index + wait[0].length)) && !/\b(?:without|still|later)\b/i.test(plain.slice(0, wait.index)) ? [`${where} waits a fixed time ("${wait[0]}"); wait for what the app shows when it is done ("wait for the console prompt"), or say why the time matters ("wait 10 s, past the 5 s timeout")`] : [];
}

/**
 * The rules a scenario's or a finding's steps follow as a list: each step is
 * one the reader can do from the one before. `steps` is `{ n, verify, text }`.
 */
export function stepListProblems(where, steps) {
	const problems = [];
	const actions = steps.filter(st => !st.verify);
	if (steps.length && !actions.length) {
		problems.push(`${where} has only VERIFY steps; write the actions that get the app to what they check`);
	}
	if (/^press\s+esc(?:ape)?\b/i.test(actions[0]?.text ?? '') && actions[0] === steps[0]) {
		problems.push(`${where} step ${steps[0].n} presses Escape first, closing what an earlier scenario left open; start from the preconditions`);
	}
	const norm = t => t.toLowerCase().replace(/[`"'.]/g, '').replace(/\s+/g, ' ').trim();
	steps.forEach((st, i) => {
		if (!st.verify && /\b(?:row|item|entry)\b.*\bCommand Palette\b/i.test(st.text) && !steps.slice(0, i).some(p => OPENS_PALETTE.test(p.text.replace(/\bin the Command Palette\b/i, '')))) {
			problems.push(`${where} step ${st.n} picks a Command Palette row, but no step before it opens the palette and types the command`);
		}
		if (!st.verify) { return; }
		// The same check after the same actions is a retry: the rate counts it, the steps do not.
		const earlier = steps.slice(0, i).findLastIndex(p => p.verify && norm(p.text) === norm(st.text) && p.result === st.result);
		if (earlier === -1) { return; }
		const before = new Set(steps.slice(0, earlier).filter(p => !p.verify).map(p => norm(p.text)));
		const between = steps.slice(earlier + 1, i).filter(p => !p.verify);
		if (between.every(p => before.has(norm(p.text)))) {
			problems.push(`${where} step ${st.n} repeats step ${steps[earlier].n}'s check after the same actions; write the steps once and count the retry in the rate`);
		}
	});
	return problems;
}

export function stepProblems(where, text) {
	const problems = [];
	const plain = text.replace(/`[^`]*`/g, 'code');
	const repeated = REPEATED.exec(plain);
	if (repeated) {
		problems.push(`${where} repeats an action ("${repeated[1]}"); a step is one action, so write each one as its own step`);
	}
	const then = THEN_ACTION.exec(plain);
	const and = then ? null : AND_ACTION.exec(plain);
	if (then || and) {
		problems.push(`${where} is two actions ("${then ? `then ${then[1]}` : and[0].trim()}"); write each as its own step`);
	}
	problems.push(...waitProblems(where, plain));
	const path = SCRATCH_PATH.exec(text);
	if (path) {
		problems.push(`${where} names the path ${path[1].replace(/[`'".,)]+$/, '')}, which the reader does not have; name the file by its files/ path or what it holds`);
	}
	if (/^Wait\s+for\b/i.test(plain)) {
		problems.push(`${where} only waits; merge the wait into the action it waits on, or, when the app does it on its own, make it a precondition: "A Python console, which Positron starts on launch"`);
	}
	if (/^With\b/.test(plain)) {
		problems.push(`${where} starts "With ..."; make what it assumes a precondition, or do it as a step of its own`);
	}
	const id = SESSION_ID.exec(text);
	if (id) {
		problems.push(`${where} names ${id[0]}, which changes every launch; write a placeholder such as <Python session ID>`);
	}
	return problems;
}

/** Preconditions that are something done in the app, which the rules make steps, or that name a scratch path or the run. */
export function lintPreconditionActions(preconditions) {
	const problems = [];
	for (const [where, line, label] of preconditions) {
		const text = line.replace(/^[-*]\s+/, '');
		// A ledger row's first field is its name; report.json gives the name apart.
		const name = (label || text.split(' | ')[0]).slice(0, 40);
		const command = /^\*\*/.test(text) ? null : [...text.matchAll(/`([^`]+)`/g)].map(m => m[1].trim()).find(c => RUN_COMMAND.test(c));
		if (command) {
			problems.push(`${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" runs \`${command}\`; run it as a step, and keep the precondition to the file or package`);
		}
		const done = /^\*\*/.test(text) || command ? null : DONE_IN_APP.exec(text.replace(/`[^`]*`/g, 'code'));
		if (done) {
			problems.push(`${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" is done in the app ("${done[0]}"); do it as a step, and keep the precondition to the state before step 1`);
		}
		const running = RUNNING_APP.exec(text.replace(/`[^`]*`/g, 'code'));
		if (running) {
			problems.push(`${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" is a running app ("${running[0]}"); start it in the steps, with a check that it runs`);
		}
		if (where.startsWith('Finding') && /\bthe run's\b/i.test(text)) {
			problems.push(`report: ${where} precondition "${name}" says "the run's", which the reader does not have; name the interpreter and package ("Python 3.12 with shiny 1.9.1")`);
		}
		const path = SCRATCH_PATH.exec(text);
		if (path) {
			problems.push(`${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" names the path ${path[1].replace(/`$/, '')}; name the workspace by what it holds ("A workspace with \`app.R\`"), and keep scratch paths in Run details`);
		}
	}
	return problems;
}

// The Result, and a Cause's lead sentence, are read at a glance.
export const SUMMARY_WORDS = 60;
export const CAUSE_LEAD_WORDS = 40;

/** Words in prose, a code span counting as one. */
export function wordsOf(text) {
	return text.replace(/`[^`]*`/g, 'code').split(/\s+/).filter(Boolean).length;
}

/** Sentences in prose, with code spans masked so a `.` inside one cannot end a sentence. */
export function sentencesOf(text) {
	return text.replace(/`[^`]*`/g, 'code').split(/(?<=[.!?])\s+(?=["A-Z])/).filter(Boolean);
}

/**
 * Observed and Expected sit side by side, so each is one or two sentences.
 * Observed may add one more for a fact the run saw that makes it worse or
 * gets past it: no error shown, only reopening restores it, another trigger.
 */
function comparisonProblems(n, label, text) {
	const max = label === 'Observed' ? 3 : 2;
	const count = sentencesOf(text).length;
	return count > max
		? [`report: Finding ${n} ${label}: is ${count} sentences; keep it to ${label === 'Observed' ? '1-2, plus one for a fact such as no error shown or a workaround you saw work' : '1-2'}, and move the rest to Reproduce or Evidence`]
		: [];
}

// Backends a reference to the right answer usually comes from.
const BACKENDS = [['pandas', /\bpandas\b/i], ['polars', /\bpolars\b/i], ['R', /\bR\b/]];

/**
 * Observed and Expected read as sentences about one thing, each number written
 * one way. The checks are narrow on purpose: each names its fix.
 * - A semicolon joins notes; write sentences.
 * - A backend the title does not name is the reference that shows the right
 *   answer, so it belongs in Expected.
 * - The same number grouped in one place and ungrouped in another reads as
 *   two numbers.
 */

// camelCase, or PascalCase of three or more words: a class or function name.
const CODE_NAME = /\b(?:[a-z]+(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+){2,})\b/;
// Product names CODE_NAME would mistake for code.
const PRODUCT_NAMES = new Set(['macOS', 'iPython', 'JavaScript', 'TypeScript', 'PowerShell', 'JupyterLab']);

function clarityProblems(n, title, observed, expected) {
	const problems = [];
	// A title says what a user sees, so it reads as a sentence, not as code.
	// Package names that are lowercase by convention may lead it.
	const first = /^([a-z][\w.-]*)/.exec(title)?.[1];
	if (first && !LOWERCASE_NAMES.has(first)) {
		problems.push(`report: Finding ${n} title starts with a lowercase letter; start it with a capital`);
	}
	if (/\w::\w/.test(title.replace(/`[^`]*`/g, ''))) {
		problems.push(`report: Finding ${n} title names code; say what a user sees and what triggers it, and leave the mechanism to Cause`);
	}
	const prose = text => text.replace(/`[^`]*`/g, '');
	const hedge = /\b(may|might|seems?|appears? to)\b/i.exec(prose(title));
	if (hedge) {
		problems.push(`report: Finding ${n} title hedges with "${hedge[1]}"; state what the run saw as a fact`);
	}
	const plain = text => prose(text).replace(/"[^"]*"/g, '');
	const possessive = /\b\w+s'(?=\s)/.exec(plain(title));
	if (possessive) {
		problems.push(`report: Finding ${n} title uses the possessive "${possessive[0]}"; say "the <thing> of <owner>" or name the thing on screen`);
	}
	if (plain(title).includes('(')) {
		problems.push(`report: Finding ${n} title has a parenthetical; fold it into the sentence or move it to Observed`);
	}
	for (const [label, text] of [['title', title], ['Observed', observed], ['Expected', expected]]) {
		const code = text && CODE_NAME.exec(plain(text));
		if (code && !PRODUCT_NAMES.has(code[0])) {
			problems.push(`report: Finding ${n} ${label} names ${code[0]}, a code name a user never sees; say what is on screen, and leave code to Cause`);
		}
	}
	for (const [label, text] of [['Observed', observed], ['Expected', expected]]) {
		if (text && prose(text).includes(';')) {
			problems.push(`report: Finding ${n} ${label}: joins notes with a semicolon; write it as sentences`);
		}
		const judged = text && /\b(unfortunately|incorrectly|confusingly|wrongly|strangely)\b/i.exec(prose(text));
		if (judged) {
			problems.push(`report: Finding ${n} ${label}: says "${judged[1]}"; say what happened in plain words and let the difference speak`);
		}
	}
	if (observed) {
		const named = BACKENDS.filter(([, re]) => re.test(prose(observed)) && !re.test(title)).map(([name]) => name);
		if (named.length) {
			problems.push(`report: Finding ${n} Observed: names ${named.join(' and ')}, which the title does not; the reference that shows the right answer goes in Expected ("as ${named[0]} shows for the same data")`);
		}
	}
	const both = prose(`${observed ?? ''} ${expected ?? ''}`);
	const grouped = new Set([...both.matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)].map(m => m[0].replace(/,/g, '')));
	const mixed = [...new Set([...both.matchAll(/(?<![\d,.])\d{4,}(?![\d,])/g)].map(m => m[0]))].filter(d => grouped.has(d));
	if (mixed.length) {
		problems.push(`report: Finding ${n} writes ${mixed[0]} both with and without digit grouping; write each number one way (1,234,567), except a value quoted exactly as the UI shows it`);
	}
	return problems;
}

// The rules below take a report's fields; lint-json.mjs gives them report.json's.

/** The rules on the header's Result line. */
export function resultProblems(result) {
	const problems = [];
	if (/^(yes|no|mostly|partly|partially)\b/i.test(result)) {
		problems.push('report: **Result:** answers a question; state what the change does instead');
	}
	// Most readers stop at the Result, so it fits in a glance; the Tested line lists the rest.
	const words = wordsOf(result);
	if (words > SUMMARY_WORDS) {
		problems.push(`report: **Result:** is ${words} words; keep it to ${SUMMARY_WORDS} or fewer: what works in a phrase, then in bold what is broken`);
	}
	return problems;
}

/** The rules on a finding's severity and its rate, "N/M". */
export function rateProblems(n, severity, reproduction) {
	const problems = [];
	if (!['major', 'moderate', 'minor'].includes(severity?.toLowerCase())) {
		problems.push(`report: finding ${n} Severity must be major, moderate or minor, got "${severity ?? ''}"`);
	}
	const rate = /^(\d+)\/(\d+)$/.exec(reproduction ?? '');
	if (!rate) {
		problems.push(`report: finding ${n} Reproduction must be N/M, got "${reproduction ?? ''}"`);
	} else if (Number(rate[2]) < 2 && ['major', 'moderate'].includes(severity?.toLowerCase())) {
		// One sighting reads as thin to a reviewer, and a repeat in the same instance
		// is cheap. A warning, never an error: severity is the user's impact, and an
		// error here would reward rating a finding lower to get past it.
		problems.push(`report: finding ${n} is ${severity.toLowerCase()} and was tried once (${reproduction}); keep the severity, and repeat its steps if the instance is still up`);
	}
	return problems;
}

/**
 * The rules on one finding's words: its preconditions, Feature, title,
 * Observed, Expected and steps. `preconditions` is `{ name, text }`, `steps`
 * as stepListProblems takes them (with `raw`, a VERIFY's text and result, and
 * `line`, as written), and `lines` all of its prose.
 */
export function findingProblems(n, { title, feature, observed, expected, preconditions = [], steps = [], lines = [] }) {
	const problems = [];
	// The card shows the short name, as Coverage does, and the full text on hover.
	for (const { name, text } of preconditions) {
		if (!name) {
			problems.push(`report: Finding ${n} precondition "${text.slice(0, 40)}" needs a name, 2 to 4 words, for Coverage`);
		} else if (name.split(/\s+/).length > 5) {
			problems.push(`report: Finding ${n} precondition name "${name}" is ${name.split(/\s+/).length} words; keep it to 2 to 4`);
		}
	}
	// The filed issue's title is `<Feature>: <claim>`.
	if (feature && ((CODE_NAME.test(feature) && !PRODUCT_NAMES.has(CODE_NAME.exec(feature)[0])) || /`|\w\.[a-z]{1,4}\b/.test(feature))) {
		problems.push(`report: Finding ${n} Feature "${feature}" is a code or file name; name the area as a user sees it, such as "data explorer" or "new folder flow"`);
	}
	for (const [label, text] of [['Observed', observed], ['Expected', expected]]) {
		if (text !== undefined) {
			problems.push(...comparisonProblems(n, label, text));
		}
	}
	problems.push(...clarityProblems(n, title, observed, expected));
	// Steps are instructions for the reader; which scenario ran them, and how, is the ledger's.
	for (const st of steps) {
		const where = `report: Finding ${n} step ${st.n}`;
		problems.push(...(st.verify ? verifyProblems(where, st.raw ?? st.text) : stepProblems(where, st.text)));
		const line = st.line ?? st.text;
		const id = SCENARIO_ID.exec(line.replace(/`[^`]*`/g, ''));
		if (id) {
			problems.push(`report: Finding ${n} step "${line.slice(0, 50)}" names ${id[0]}; steps are instructions for the reader, so leave run notes out`);
		}
	}
	problems.push(...stepListProblems(`report: Finding ${n}`, steps));
	const pointer = lines.find(l => /\b(as (in )?Finding \d+|same as (above|Finding))\b/i.test(l));
	if (pointer) {
		problems.push(`report: Finding ${n} points at another finding ("${pointer.trim().slice(0, 60)}"); write its steps in full`);
	}
	return problems;
}

// Errors make a repro or its evidence wrong, or leave the page unable to show
// it: they block a clean render. Warnings are wording and length: worth fixing
// when quick, never worth another render. A rule not listed here is an error.
const WARNINGS = [
	/ repeats an action \(/,
	/ waits a fixed time \(/,
	/ presses Escape first, closing what an earlier scenario left open/,
	/ repeats step \d+'s check after the same actions/,
	/; the step is copied into the finding, whose reader has no scenarios/,
	/ is two actions \(/,
	/ VERIFY does something \(/,
	/ starts "With \.\.\."/,
	/Result: of a failed scenario is its rate only/,
	/Result: is \S+ (?:characters|sentences)/,
	/\*\*Result:\*\* answers a question/,
	/\*\*Result:\*\* is \d+ words/,
	/ Cause opens with a \d+-word sentence/,
	/drop the Introduced\?\/Origin column/,
	/drop the Impact column/,
	/ precondition ".*?" needs a name/,
	/ precondition name ".*?" is \S+ words/,
	/ Preconditions: says only "/,
	/ has an Impact line/,
	/ (?:Observed|Expected): is \S+ sentences/,
	/ title starts with a lowercase letter/,
	/ title names code/,
	/ title hedges with /,
	/ title uses the possessive /,
	/ title has a parenthetical/,
	/ names \S+, a code name a user never sees/,
	/ joins notes with a semicolon/,
	/ (?:Observed|Expected): says "/,
	/ Observed: names .*, which the title does not/,
	/ both with and without digit grouping/,
	/steps are instructions for the reader, so leave run notes out/,
	/cite shots as \[shots\//,
	/map compiled frames to source paths/,
	/ has \S+ screenshots; keep the one/,
	/ repeats the first one's caption/,
	/ twice, bare and as /,
	/; the file is the last capture, taken before /,
	/ and was tried once \(/,
];

/** True when a lint line is a warning: wording or length, not a wrong repro or evidence. */
export function isWarning(problem) {
	return WARNINGS.some(re => re.test(problem));
}

/** Lint lines split into the errors to fix before the report is done and the warnings to fix if quick. */
export function splitProblems(problems) {
	return { errors: problems.filter(p => !isWarning(p)), warnings: problems.filter(p => isWarning(p)) };
}
