/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The write-up rules a script can check on words alone: steps, preconditions,
 * a finding's title, Observed and Expected, the Result line and the rate.
 * lint-ledger.mjs applies them to the ledger, and lint-json.mjs to report.json.
 * Each rule's ID and severity are in lint-rules.mjs.
 */

import { problem } from './lint-rules.mjs';
import { LOWERCASE_NAMES } from '../shared/text.mjs';
import { FILE_NAME } from '../page/repro-files.mjs';

// A one-line Result, as explorer.md asks; anything longer is a scenario's worth of notes.
export const RESULT_MAX = 160;

// A step is one action, so the verifier can match it to one line of
// actions.log and a check can sit between any two. A lowercase verb after
// "then" is a second action; a capitalized word is a menu item ("More, then Insert Cell Above").
const REPEATED = /\b(twice|thrice|(?:two|three|four|five|six|seven|eight|nine|ten|\d+) times|each of)\b/i;
// A precondition that is something done in the app ("then opened", a running Shiny app, "started in S03"): that is a step. Saying how an earlier scenario made a state ("a console started with ...") is allowed.
// A scratch path the reader does not have; a workspace is named by what it holds.
const SCRATCH_PATH = /(?:^|[\s`'"(])((?:\/private)?\/(?:tmp|var\/folders)\/\S*|\/(?:Users|home)\/\S*)/;
// An app already serving is what the steps start, so the reader sees it start.
const RUNNING_APP = /\b(?:serving|listening)\b|\b(?:running )?on port \d+|\brunning in (?:\w+ ){0,3}console\b/i;
const DONE_IN_APP = /\b(?:(?:started|opened|launched|ran|loaded)\s+code|then\s+(?:(?:\w+\s+){0,3}?\w+ed|ran)|Run(?: Shiny)? App|shown in the|in the session|defined in the|still open|drew|(?:started|opened) (?:in|by) S\d+|S\d+ (?:started|drew|opened|left))\b/i;
// A finding's reader runs the file as its first step; a ledger row's third field may say how a scenario made it.
// Opening a view or typing into it is something the reader does, so it is step 1.
const UI_ACTION = /\btyped (?:into|in)\b|\b(?:editor|pane|panel|view|dialog|palette|picker) open\b/i;
// A setting at its default says it is one and at its default; one the run changed is a saved settings file.
// How to reset a setting is known, and what it then shows is a check.
const SETTING_KEY = /`([a-z][\w-]*(?:\.[\w-]+)+)(?::[^`]*)?`/gi;
const SETTING_WORDS = /\bsettings?\b|\bdefault\b|\b(?:true|false)\b|\bset to\b|`[^`]*: [^`]*`/i;
const SETTING_EXTRA = /\bso (?:the|that|it)\b|\bReset Setting\b|\bgear menu\b|\bnot set in\b/i;
const SETTINGS_FILE = /`files\/(?:[\w.-]+\/)*settings\.json`/;
const WHOLE_FILE_NAME = new RegExp(`^(?:${FILE_NAME.source})$`, 'i');

/** Whether a precondition is about a setting: a dotted key in backticks that is not a file, and words that say so. */
function namesSetting(text) {
	return [...text.matchAll(SETTING_KEY)].some(m => !WHOLE_FILE_NAME.test(m[1]) && !m[1].includes('/')) && SETTING_WORDS.test(text);
}
const RUN_IN_SESSION = /\brun in (?:the |its |their |each |both )?(?:\w+ ){0,3}(?:sessions?|consoles?)\b/i;
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
		...(verb ? [problem('verify-acts', `${where} VERIFY does something ("${verb}"); make it a step of its own before the check, and keep the VERIFY to what you expect to see`)] : []),
		...waitProblems(where, plain),
	];
}

function waitProblems(where, plain) {
	const wait = FIXED_WAIT.exec(plain);
	return wait && !WAIT_REASON.test(plain.slice(wait.index + wait[0].length)) && !/\b(?:without|still|later)\b/i.test(plain.slice(0, wait.index)) ? [problem('fixed-wait', `${where} waits a fixed time ("${wait[0]}"); wait for what the app shows when it is done ("wait for the console prompt"), or say why the time matters ("wait 10 s, past the 5 s timeout")`)] : [];
}

/**
 * The rules a scenario's or a finding's steps follow as a list: each step is
 * one the reader can do from the one before. `steps` is `{ n, verify, text }`.
 */
export function stepListProblems(where, steps) {
	const problems = [];
	const actions = steps.filter(st => !st.verify);
	if (steps.length && !actions.length) {
		problems.push(problem('only-verify-steps', `${where} has only VERIFY steps; write the actions that get the app to what they check`));
	}
	if (/^press\s+esc(?:ape)?\b/i.test(actions[0]?.text ?? '') && actions[0] === steps[0]) {
		problems.push(problem('first-step-escape', `${where} step ${steps[0].n} presses Escape first, closing what an earlier scenario left open; start from the preconditions`));
	}
	const norm = t => t.toLowerCase().replace(/[`"'.]/g, '').replace(/\s+/g, ' ').trim();
	steps.forEach((st, i) => {
		if (!st.verify && /\b(?:row|item|entry)\b.*\bCommand Palette\b/i.test(st.text) && !steps.slice(0, i).some(p => OPENS_PALETTE.test(p.text.replace(/\bin the Command Palette\b/i, '')))) {
			problems.push(problem('palette-row-unopened', `${where} step ${st.n} picks a Command Palette row, but no step before it opens the palette and types the command`));
		}
		if (!st.verify) { return; }
		// The same check after the same actions is a retry: the rate counts it, the steps do not.
		const earlier = steps.slice(0, i).findLastIndex(p => p.verify && norm(p.text) === norm(st.text) && p.result === st.result);
		if (earlier === -1) { return; }
		const before = new Set(steps.slice(0, earlier).filter(p => !p.verify).map(p => norm(p.text)));
		const between = steps.slice(earlier + 1, i).filter(p => !p.verify);
		if (between.every(p => before.has(norm(p.text)))) {
			problems.push(problem('repeated-check', `${where} step ${st.n} repeats step ${steps[earlier].n}'s check after the same actions; write the steps once and count the retry in the rate`));
		}
	});
	return problems;
}

export function stepProblems(where, text) {
	const problems = [];
	const plain = text.replace(/`[^`]*`/g, 'code');
	const repeated = REPEATED.exec(plain);
	if (repeated) {
		problems.push(problem('repeated-action', `${where} repeats an action ("${repeated[1]}"); a step is one action, so write each one as its own step`));
	}
	const then = THEN_ACTION.exec(plain);
	const and = then ? null : AND_ACTION.exec(plain);
	if (then || and) {
		problems.push(problem('two-actions', `${where} is two actions ("${then ? `then ${then[1]}` : and[0].trim()}"); write each as its own step`));
	}
	problems.push(...waitProblems(where, plain));
	const path = SCRATCH_PATH.exec(text);
	if (path) {
		problems.push(problem('step-scratch-path', `${where} names the path ${path[1].replace(/[`'".,)]+$/, '')}, which the reader does not have; name the file by its files/ path or what it holds`));
	}
	if (/^Wait\s+for\b/i.test(plain)) {
		problems.push(problem('wait-only-step', `${where} only waits; merge the wait into the action it waits on, or, when the app does it on its own, make it a precondition: "A Python console, which Positron starts on launch"`));
	}
	if (/^With\b/.test(plain)) {
		problems.push(problem('step-starts-with', `${where} starts "With ..."; make what it assumes a precondition, or do it as a step of its own`));
	}
	const id = SESSION_ID.exec(text);
	if (id) {
		problems.push(problem('session-id', `${where} names ${id[0]}, which changes every launch; write a placeholder such as <Python session ID>`));
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
			problems.push(problem('precondition-runs-command', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" runs \`${command}\`; run it as a step, and keep the precondition to the file or package`));
		}
		const plainText = text.replace(/`[^`]*`/g, 'code');
		const done = /^\*\*/.test(text) || command ? null : DONE_IN_APP.exec(plainText);
		if (done) {
			problems.push(problem('precondition-done-in-app', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" is done in the app ("${done[0]}"); do it as a step, and keep the precondition to the state before step 1`));
		}
		// The scenario that ran it may not be the one whose steps the finding shows, so name what it left.
		const ran = done || !where.startsWith('Finding') ? null : RUN_IN_SESSION.exec(plainText);
		if (ran) {
			problems.push(problem('precondition-done-in-app', `report: ${where} precondition "${name}" says a file was ${ran[0]}; name the state it left instead (the variables it defined, in which session), or, if the failing scenario ran it, make it that scenario's first step`));
		}
		const running = RUNNING_APP.exec(text.replace(/`[^`]*`/g, 'code'));
		if (running) {
			problems.push(problem('precondition-running-app', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" is a running app ("${running[0]}"); start it in the steps, with a check that it runs`));
		}
		const ui = done || running ? null : UI_ACTION.exec(plainText);
		if (ui) {
			problems.push(problem('precondition-ui-action', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" is done in the app ("${ui[0]}"); open or type it in step 1, and keep the precondition to the state before it`));
		}
		// A ledger row's later fields say how the state was made, so only the state counts.
		const state = text.split(' | ')[0];
		const setting = !ui && namesSetting(state);
		const extra = setting ? SETTING_EXTRA.exec(state.replace(/`[^`]*`/g, 'code')) : null;
		if (extra) {
			problems.push(problem('precondition-setting-form', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" says more than the setting ("${extra[0]}"); write \`key\` setting at its default, or save a changed value in \`files/.vscode/settings.json\`, and check what it shows in a step`));
		} else if (setting && /\bat its default\b/i.test(state) && !/\bsetting at its default\b/i.test(state)) {
			problems.push(problem('precondition-setting-form', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" does not say its key is a setting; write \`key\` setting at its default`));
		} else if (setting && !/\bat its default\b/i.test(state) && !SETTINGS_FILE.test(state)) {
			problems.push(problem('precondition-setting-file', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" writes a changed setting out; save it in \`files/.vscode/settings.json\` (or \`files/settings.json\` for one that only works in user settings) and name that path, which the page links`));
		}
		const stepRef = where.startsWith('Finding') ? /\bsteps? \d+\b/i.exec(text) : null;
		if (stepRef) {
			problems.push(problem('precondition-step-reference', `report: ${where} precondition "${name}" points at ${stepRef[0]}; write the name or value itself, so the precondition reads on its own`));
		}
		if (where.startsWith('Finding') && /\bthe run's\b/i.test(text)) {
			problems.push(problem('precondition-the-runs', `report: ${where} precondition "${name}" says "the run's", which the reader does not have; name the interpreter and package ("Python 3.12 with shiny 1.9.1")`));
		}
		const path = SCRATCH_PATH.exec(text);
		if (path) {
			problems.push(problem('precondition-scratch-path', `${where.startsWith('Finding') ? 'report' : 'ledger'}: ${where} precondition "${name}" names the path ${path[1].replace(/`$/, '')}; name the workspace by what it holds ("A workspace with \`app.R\`"), and keep scratch paths in Run details`));
		}
	}
	return problems;
}

// The Result, a finding's summary and a Cause's lead sentence are read at a glance.
export const SUMMARY_WORDS = 60;
export const OPENING_WORDS = 50;
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
	const max = label === 'observed' ? 3 : 2;
	const count = sentencesOf(text).length;
	return count > max
		? [problem('comparison-length', `report: Finding ${n} ${label} is ${count} sentences; keep it to ${label === 'observed' ? '1-2, plus one for a fact such as no error shown or a workaround you saw work' : '1-2'}, and move the rest to the steps or evidence`)]
		: [];
}

// Backends a reference to the right answer usually comes from.
const BACKENDS = [['pandas', /\bpandas\b/i], ['polars', /\bpolars\b/i], ['R', /\bR\b/]];
// A backend giving a value ("pandas shows"), not one named as what was tested ("the R session").
const REPORTS_VALUE = /\s+(?:also\s+)?(?:shows|gives|returns|reports|displays|says)\b/.source;

/**
 * Observed and Expected read as sentences about one thing, each number written
 * one way. The checks are narrow on purpose: each names its fix.
 * - A semicolon joins notes; write sentences.
 * - A backend the title does not name, giving a value, is the reference that
 *   shows the right answer, so it belongs in Expected.
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
		problems.push(problem('title-lowercase', `report: Finding ${n} title starts with a lowercase letter; start it with a capital`));
	}
	if (/\w::\w/.test(title.replace(/`[^`]*`/g, ''))) {
		problems.push(problem('title-code', `report: Finding ${n} title names code; say what a user sees and what triggers it, and leave the mechanism to cause`));
	}
	const prose = text => text.replace(/`[^`]*`/g, '');
	const hedge = /\b(may|might|seems?|appears? to)\b/i.exec(prose(title));
	if (hedge) {
		problems.push(problem('title-hedge', `report: Finding ${n} title hedges with "${hedge[1]}"; state what the run saw as a fact`));
	}
	const plain = text => prose(text).replace(/"[^"]*"/g, '');
	const possessive = /\b\w+s'(?=\s)/.exec(plain(title));
	if (possessive) {
		problems.push(problem('title-possessive', `report: Finding ${n} title uses the possessive "${possessive[0]}"; say "the <thing> of <owner>" or name the thing on screen`));
	}
	if (plain(title).includes('(')) {
		problems.push(problem('title-parenthetical', `report: Finding ${n} title has a parenthetical; fold it into the sentence or move it to observed`));
	}
	for (const [label, text] of [['title', title], ['observed', observed], ['expected', expected]]) {
		const code = text && CODE_NAME.exec(plain(text));
		if (code && !PRODUCT_NAMES.has(code[0])) {
			problems.push(problem('code-name', `report: Finding ${n} ${label} names ${code[0]}, a code name a user never sees; say what is on screen, and leave code to cause`));
		}
	}
	for (const [label, text] of [['observed', observed], ['expected', expected]]) {
		if (text && prose(text).includes(';')) {
			problems.push(problem('semicolon', `report: Finding ${n} ${label} joins notes with a semicolon; write it as sentences`));
		}
		const judged = text && /\b(unfortunately|incorrectly|confusingly|wrongly|strangely)\b/i.exec(prose(text));
		if (judged) {
			problems.push(problem('judgment-word', `report: Finding ${n} ${label} says "${judged[1]}"; say what happened in plain words and let the difference speak`));
		}
	}
	if (observed) {
		const named = BACKENDS.filter(([, re]) => new RegExp(re.source + REPORTS_VALUE, re.flags).test(prose(observed)) && !re.test(title)).map(([name]) => name);
		if (named.length) {
			problems.push(problem('reference-in-observed', `report: Finding ${n} observed names ${named.join(' and ')}, which the title does not; the reference that shows the right answer goes in expected ("as ${named[0]} shows for the same data")`));
		}
	}
	const both = prose(`${observed ?? ''} ${expected ?? ''}`);
	const grouped = new Set([...both.matchAll(/\b\d{1,3}(?:,\d{3})+\b/g)].map(m => m[0].replace(/,/g, '')));
	const mixed = [...new Set([...both.matchAll(/(?<![\d,.])\d{4,}(?![\d,])/g)].map(m => m[0]))].filter(d => grouped.has(d));
	if (mixed.length) {
		problems.push(problem('digit-grouping', `report: Finding ${n} writes ${mixed[0]} both with and without digit grouping; write each number one way (1,234,567), except a value quoted exactly as the UI shows it`));
	}
	return problems;
}

// The rules below take a report's fields; lint-json.mjs gives them report.json's.

/** The rules on the header's Result line. */
export function resultProblems(result) {
	const problems = [];
	if (/^(yes|no|mostly|partly|partially)\b/i.test(result)) {
		problems.push(problem('result-answers-question', 'report: header.result answers a question; state what the change does instead'));
	}
	// Most readers stop at the Result, so it fits in a glance; the Tested line lists the rest.
	const words = wordsOf(result);
	if (words > SUMMARY_WORDS) {
		problems.push(problem('result-length', `report: header.result is ${words} words; keep it to ${SUMMARY_WORDS} or fewer: what works in a phrase, then in bold what is broken`));
	}
	return problems;
}

/**
 * The rules on a finding's replay on a build of main: present on every finding
 * when the run has one, one kind of result, and a count for each check that
 * failed on the change and only those, since one left out may be the step
 * main fails.
 */
export function mainProblems(n, main, steps, { mainBuild, actionsLog, files = [] } = {}) {
	if (main === undefined) {
		return mainBuild ? [problem('main-missing', `report: Finding ${n} has no main; replay it on the main build, or record main.missing or main.couldNotRun`)] : [];
	}
	const kinds = ['missing', 'steps', 'couldNotRun'].filter(k => main[k] !== undefined);
	if (kinds.length !== 1) {
		return [problem('main-shape', `report: Finding ${n} main must hold exactly one of missing, steps or couldNotRun, not ${kinds.length ? kinds.join(' and ') : 'none'}`)];
	}
	if (!main.steps) {
		return [];
	}
	const failing = steps.map((s, i) => (s.kind === 'verify' && s.result === 'fail' ? i + 1 : 0)).filter(Boolean);
	const counted = main.steps.map(s => s.step);
	const problems = [];
	for (const at of [...new Set(counted.filter((at, i) => counted.indexOf(at) !== i))]) {
		problems.push(problem('main-steps', `report: Finding ${n} main.steps counts step ${at} more than once; give each failing check one count`));
	}
	for (const at of counted.filter(at => !failing.includes(at))) {
		problems.push(problem('main-steps', `report: Finding ${n} main.steps names step ${at}, which is not a failing check; ${failing.length ? `count only steps ${failing.join(', ')}` : 'this finding has no failing check to count'}`));
	}
	for (const at of failing.filter(at => !counted.includes(at))) {
		problems.push(problem('main-steps', `report: Finding ${n} main.steps leaves out failing step ${at}; count every one, a step left out may be the one main fails`));
	}
	for (const s of main.steps.filter(s => !(Number.isInteger(s.n) && Number.isInteger(s.m) && s.n >= 0 && s.m >= 1 && s.n <= s.m))) {
		problems.push(problem('main-rate', `report: Finding ${n} main step ${s.step} is ${s.n}/${s.m}; give N/M with N no more than M, M at least 1`));
	}
	for (const s of main.steps.filter(s => !Array.isArray(s.shots) || !s.shots.length)) {
		problems.push(problem('main-shot', `report: Finding ${n} main step ${s.step} has no screenshot; take one of the check on the main build and list it in shots`));
	}
	for (const s of main.steps.filter(s => s.n > 0 && typeof s.same !== 'boolean')) {
		problems.push(problem('main-same', `report: Finding ${n} main step ${s.step} failed on main; say in same whether it failed the same way as on the change`));
	}
	if (actionsLog !== undefined) {
		const why = replayLogProblem(main.log, actionsLog, steps.filter(s => s.kind === 'action').length, files);
		if (why) {
			problems.push(problem('main-log', `report: Finding ${n} main.log ${why}`));
		}
	}
	return problems;
}

/**
 * What is wrong with a main replay's range of action log lines, or '': it
 * must be in the log, hold only the main session's actions, as many as the
 * finding has action steps, and open the files the finding needs.
 */
function replayLogProblem(range, actionsLog, actions, files) {
	const lines = String(actionsLog).split('\n');
	if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 1 || range[0] > range[1] || range[1] > lines.length) {
		return `must give the first and last lines of the replay in actions.log, as [first, last]; the log has ${lines.length} lines`;
	}
	const span = lines.slice(range[0] - 1, range[1]);
	const sessions = span.map(l => /-s=(\S+?):/.exec(l)?.[1]).filter(Boolean);
	if (sessions.some(s => !s.endsWith('-main'))) {
		return `lines ${range[0]}-${range[1]} include actions outside the main replay; give only the replay's lines`;
	}
	if (sessions.length < actions) {
		return `lines ${range[0]}-${range[1]} hold ${sessions.length} actions on main, fewer than the finding's ${actions} action steps`;
	}
	const unopened = files.map(f => f.split('/').pop()).filter(name => !span.some(l => l.includes(name)));
	if (unopened.length) {
		return `lines ${range[0]}-${range[1]} never open ${unopened.join(', ')}, which the finding needs`;
	}
	return '';
}

/** The rules on a finding's severity and its rate, "N/M". */
export function rateProblems(n, severity, reproduction) {
	const problems = [];
	if (!['major', 'moderate', 'minor'].includes(severity?.toLowerCase())) {
		problems.push(problem('severity-value', `report: Finding ${n} severity must be major, moderate or minor, got "${severity ?? ''}"`));
	}
	const rate = /^(\d+)\/(\d+)$/.exec(reproduction ?? '');
	if (!rate) {
		problems.push(problem('rate-format', `report: Finding ${n} reproduced must be { "n": N, "m": M } with N no more than M, got "${reproduction ?? ''}"`));
	} else if (Number(rate[2]) < 2 && ['major', 'moderate'].includes(severity?.toLowerCase())) {
		// One sighting reads as thin to a reviewer, and a repeat in the same instance
		// is cheap. A warning, never an error: severity is the user's impact, and an
		// error here would reward rating a finding lower to get past it.
		problems.push(problem('tried-once', `report: Finding ${n} is ${severity.toLowerCase()} and was tried once (${reproduction}); keep the severity, and repeat its steps if the instance is still up`));
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
			problems.push(problem('precondition-needs-name', `report: Finding ${n} precondition "${text.slice(0, 40)}" needs a name, 2 to 4 words, for Coverage`));
		} else if (name.split(/\s+/).length > 5) {
			problems.push(problem('precondition-name-length', `report: Finding ${n} precondition name "${name}" is ${name.split(/\s+/).length} words; keep it to 2 to 4`));
		}
	}
	// The filed issue's title is `<Feature>: <claim>`.
	if (feature && ((CODE_NAME.test(feature) && !PRODUCT_NAMES.has(CODE_NAME.exec(feature)[0])) || /`|\w\.[a-z]{1,4}\b/.test(feature))) {
		problems.push(problem('feature-code-name', `report: Finding ${n} feature "${feature}" is a code or file name; name the area as a user sees it, such as "data explorer" or "new folder flow"`));
	}
	for (const [label, text] of [['observed', observed], ['expected', expected]]) {
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
			problems.push(problem('step-scenario-id', `report: Finding ${n} step "${line.slice(0, 50)}" names ${id[0]}; steps are instructions for the reader, so leave run notes out`));
		}
	}
	problems.push(...stepListProblems(`report: Finding ${n}`, steps));
	const pointer = lines.find(l => /\b(as (in )?Finding \d+|same as (above|Finding))\b/i.test(l));
	if (pointer) {
		problems.push(problem('points-at-finding', `report: Finding ${n} points at another finding ("${pointer.trim().slice(0, 60)}"); write its steps in full`));
	}
	return problems;
}
