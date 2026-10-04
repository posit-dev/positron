/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks a report and its ledger against the format explorer.md specifies.
 *
 * The parser is lenient on purpose, so a malformed report still renders; that
 * also means it renders wrong without saying so. These are the rules a script
 * can check, returned as one line each for the agent to fix and re-render.
 */

import { basename, isDefaultsOnly, isNewTestFile, LOWERCASE_NAMES, parseLedger, parseReport, parseSystemLine } from './report-parse.mjs';
import { FILE_NAME, FILES_PATH, findFile } from './repro-files.mjs';

/** Lines outside fenced code blocks, with their index. */
function prose(markdown) {
	const out = [];
	let fence = null;
	String(markdown ?? '').split('\n').forEach((line, i) => {
		const m = /^\s*(`{3,}|~{3,})/.exec(line);
		if (m) {
			if (!fence) { fence = m[1]; return; }
			if (m[1][0] === fence[0] && m[1].length >= fence.length) { fence = null; return; }
		}
		if (!fence) { out.push({ line, i }); }
	});
	return out;
}

function tableRows(lines, headerTest) {
	const start = lines.findIndex(({ line }) => /^\s*\|/.test(line) && headerTest(line.toLowerCase()));
	if (start === -1) { return null; }
	const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
	const header = cells(lines[start].line).map(h => h.toLowerCase());
	const rows = [];
	for (let k = start + 2; k < lines.length && /^\s*\|/.test(lines[k].line); k++) {
		const c = cells(lines[k].line);
		rows.push(Object.fromEntries(header.map((h, j) => [h, c[j] ?? ''])));
	}
	return rows;
}

/** The files an `Evidence:` value names; prose such as "none, DOM read only" names none. */
function evidenceFiles(value) {
	return value.split(/[\s,;()[\]]+/).map(t => t.replace(/^shots\//, '')).filter(t => /^[\w.-]+\.[a-z0-9]{2,5}$/i.test(t));
}

// A one-line Result, as explorer.md asks; anything longer is a scenario's worth of notes.
const RESULT_MAX = 160;

function lintLedger(ledger, findingNumbers, fileExists) {
	const problems = [];
	const lines = prose(ledger);
	const scenarios = [];
	const citedBy = new Map();
	let current = null;
	for (const { line } of lines) {
		const head = /^##\s+(S\d+)\b/.exec(line);
		if (head) {
			current = { id: head[1], status: null, verifies: [] };
			scenarios.push(current);
			continue;
		}
		if (/^##\s/.test(line)) { current = null; continue; }
		if (!current) { continue; }
		const status = /^Status:\s*(.*)$/.exec(line);
		if (status) { current.status = status[1].trim(); }
		const result = /^Result:\s*(.*)$/.exec(line);
		if (result) { current.result = result[1].trim(); }
		const verify = /^\s*(\d+)\.\s+VERIFY\b/i.exec(line);
		if (verify) {
			current.verifies.push({ step: verify[1], fail: /->\s*FAIL\b/i.test(line), finding: Number(/->\s*FAIL\s*-\s*Finding\s+(\d+)/i.exec(line)?.[1]) || null, observed: false, evidence: false, log: false });
		}
		const field = /^\s+(Observed|Evidence|Log):(.*)$/i.exec(line);
		const check = current.verifies.at(-1);
		if (field && check) {
			const key = field[1].toLowerCase();
			let named = true;
			if (key === 'evidence') {
				const files = evidenceFiles(field[2]);
				const missing = fileExists ? files.filter(f => !fileExists(`shots/${f}`)) : [];
				for (const f of missing) { problems.push(`ledger: ${current.id} cites Evidence: ${f}, which is not in shots/`); }
				const present = files.filter(f => !missing.includes(f));
				for (const f of new Set(present)) {
					if (!citedBy.has(f)) { citedBy.set(f, []); }
					citedBy.get(f).push(`${current.id} step ${check.step}`);
				}
				named = present.length > 0;
			}
			if (named) { check[key] = true; }
		}
	}

	const seen = new Set();
	for (const s of scenarios) {
		if (seen.has(s.id)) { problems.push(`ledger: ${s.id} appears twice; IDs are never reused`); }
		seen.add(s.id);
		if (!s.status) {
			problems.push(`ledger: ${s.id} has no Status: line`);
		} else if (!/^pass$/i.test(s.status)) {
			const m = /^fail\s*-\s*Finding\s+(\d+)$/i.exec(s.status);
			if (!m) {
				problems.push(`ledger: ${s.id} Status: must be "pass" or "fail - Finding N", got "${s.status}"`);
			} else if (!findingNumbers.has(Number(m[1]))) {
				problems.push(`ledger: ${s.id} names Finding ${m[1]}, which the report does not have`);
			}
			// A scenario fails one finding, so its rate counts only checks of that finding.
			for (const v of s.verifies.filter(v => v.finding && v.finding !== Number(m?.[1]))) {
				problems.push(`ledger: ${s.id} step ${v.step} fails Finding ${v.finding} but the scenario's Status names Finding ${m?.[1]}; give Finding ${v.finding}'s check a scenario of its own`);
			}
		}
		if (!s.verifies.length) { problems.push(`ledger: ${s.id} has no VERIFY step`); }
		// A Result that runs on is usually carrying something the run did not
		// expect, and in a pass that is where a finding goes unnoticed.
		if (s.result && (s.result.length > RESULT_MAX || sentencesOf(s.result).length > 1)) {
			problems.push(`ledger: ${s.id} Result: is ${sentencesOf(s.result).length > 1 ? `${sentencesOf(s.result).length} sentences` : `${s.result.length} characters`}; keep it to one short sentence, and give anything you did not expect its own VERIFY step`);
		}
		for (const v of s.verifies) {
			if (!v.evidence) { problems.push(`ledger: ${s.id} step ${v.step} VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own`); }
			const missing = v.fail ? ['observed', 'log'].filter(key => !v[key]) : [];
			if (missing.length) {
				problems.push(`ledger: ${s.id} step ${v.step} FAIL is missing ${missing.map(m => `${m[0].toUpperCase()}${m.slice(1)}:`).join(', ')}`);
			}
		}
	}
	for (const [f, checks] of citedBy) {
		if (checks.length > 1) { problems.push(`ledger: ${f} is Evidence for ${checks.join(' and ')}; take a screenshot for each check`); }
	}
	// The issue button's System details come from this line, so it has to parse.
	const env = lines.findIndex(({ line }) => /^##\s+Environment\b/i.test(line));
	const first = env < 0 ? null : lines.slice(env + 1).find(({ line }) => /^(?:##\s|[-*]\s)/.test(line));
	if (env < 0) {
		problems.push('ledger: no ## Environment section');
	} else if (!first || /^##\s/.test(first.line) || !parseSystemLine(first.line)) {
		problems.push('ledger: the first Environment bullet must read "- Positron <version> build <n>, <kind> of <commit> (Code - OSS <version>), on <OS> <version> (<platform> <arch>)." with "not recorded" for anything unknown');
	}

	const notRun = lines.filter(({ line }) => /^-\s+N\d+\b/.test(line)).length;
	return { problems, scenarioCount: scenarios.length, notRun };
}

/**
 * A finding's repro is one ledger scenario's steps: every screenshot its steps
 * cite comes from a single scenario, and that scenario failed for this finding.
 * Another run's screenshots go under Evidence, captioned with the step they prove.
 */
function lintReproScenario(findings, scenarios) {
	const problems = [];
	const shotsOf = steps => new Set(steps.flatMap(st => st.evidence.map(e => basename(e.file || e.href))));
	const owners = scenarios.map(s => ({ s, shots: shotsOf(s.steps) }));
	for (const f of findings) {
		const cited = [...shotsOf(f.steps)].filter(shot => owners.some(o => o.shots.has(shot)));
		if (!cited.length) { continue; }
		const whole = owners.filter(o => cited.every(shot => o.shots.has(shot))).map(o => o.s);
		if (!whole.length) {
			const ids = owners.filter(o => cited.some(shot => o.shots.has(shot))).map(o => o.s.id);
			problems.push(`report: Finding ${f.n}'s steps mix ${ids.join(' and ')}; the repro is one scenario's steps, and another run's screenshots go under Evidence, captioned "Step N:" for the step they prove`);
		} else if (!whole.some(s => s.findings.includes(f.n) || s.steps.some(st => st.finding === f.n))) {
			problems.push(`report: Finding ${f.n}'s steps come from ${whole.map(s => s.id).join(' or ')}, whose Status does not name Finding ${f.n}`);
		}
	}
	return problems;
}

/**
 * The test-file rules: every file a finding's setup or a scenario's
 * precondition names is saved under `files/` and listed in `## Files`, and the
 * two agree. `needs` is `[where, text]` for each setup line to check.
 */
function lintFiles(markdown, ledger, needs, { fileExists, listFiles }) {
	const problems = [];
	const files = parseLedger(ledger)?.files ?? [];
	for (const f of files) {
		if (!/^files\/./.test(f.path)) {
			problems.push(`ledger: ## Files lists ${f.path}; save it under files/ and list that path`);
		} else if (fileExists && !fileExists(f.path)) {
			problems.push(`ledger: ## Files lists ${f.path}, which is not in the run directory`);
		}
	}
	const listed = new Set(files.map(f => f.path));
	// A path under files/ named in prose is a file the reader will look for.
	// Code blocks don't count: they may quote a file's own contents.
	// Only one with an extension: "files/lines" in a sentence is prose.
	const named = new Set();
	for (const { line } of [...prose(markdown), ...prose(ledger)]) {
		for (const m of line.matchAll(FILES_PATH)) { named.add(m[1]); }
	}
	for (const p of named) {
		if (!listed.has(p)) { problems.push(`ledger: ${p} is named but not listed in ## Files`); }
	}
	for (const p of listFiles ? listFiles() : []) {
		if (!listed.has(p)) { problems.push(`ledger: ${p} is saved but not listed in ## Files`); }
	}
	// A setup that names a file nobody saved is how a finding stops reproducing.
	// One line per file, naming every setup that needs it.
	const unsaved = new Map();
	for (const [where, text] of needs) {
		// A files/ path already shows as its file name, so the bare name beside it repeats it.
		// A ledger row's later fields say how the state was made, so only the state counts.
		const state = String(text).split(' | ')[0];
		const twice = new Set();
		for (const [, path] of state.matchAll(FILES_PATH)) {
			const name = basename(path);
			if (!twice.has(name) && state.includes(`\`${name}\``)) {
				twice.add(name);
				problems.push(`${where} names ${name} twice, bare and as ${path}; write \`${path}\` once in place of the name, and the page shows it as ${name}`);
			}
		}
		for (const m of String(text).matchAll(FILE_NAME)) {
			if (twice.has(m[1])) { continue; }
			// "user settings.json" is the app's own file; the setting goes in the step.
			// A files/ path is the rule above's.
			if (findFile(files, m[1]) || APP_CONFIG.test(m[1]) || m[1].startsWith('files/')) { continue; }
			const same = files.filter(f => basename(f.path) === basename(m[1]));
			if (same.length > 1) {
				problems.push(`${where} names ${m[1]}, which matches ${same.map(f => f.path).join(' and ')}; name it by its files/ path`);
				continue;
			}
			const at = unsaved.get(m[1]) ?? [];
			if (!at.includes(where)) { at.push(where); }
			unsaved.set(m[1], at);
		}
	}
	for (const [name, at] of unsaved) {
		problems.push(`${name} is named by ${at.join(', ')} but not saved; save it to files/ as it was when used and list it under ## Files in the ledger`);
	}
	return problems;
}

// The app's own configuration files, named by where a setting lives.
const APP_CONFIG = /^(settings|keybindings|launch|tasks|extensions|argv)\.json$/i;

/** Each scenario's precondition bullets, as `[where, text]`. */
function ledgerPreconditions(ledger) {
	const out = [];
	let id = null;
	let inPre = false;
	for (const { line } of prose(ledger)) {
		const head = /^##\s+(\S+)/.exec(line);
		if (head) { id = /^S\d+$/.test(head[1]) ? head[1] : null; inPre = false; continue; }
		if (!id) { continue; }
		if (/^\w[\w ]*:/.test(line)) { inPre = /^Preconditions:/i.test(line); continue; }
		if (inPre && /^[-*]\s+/.test(line)) { out.push([id, line]); }
	}
	return out;
}

/** The ledger's `Issue:` lines and issue-naming Not run rows, against the issues fetched for the PR. */
function lintKnownIssues(ledger, knownIssues) {
	const problems = [];
	const byNumber = new Map((knownIssues?.issues ?? []).map(i => [i.number, i]));
	let id = null;
	for (const { line } of prose(ledger)) {
		const head = /^##\s+(\S+)/.exec(line);
		if (head) { id = /^S\d+$/.test(head[1]) ? head[1] : null; continue; }
		const m = /^Issue:\s*(.*)$/.exec(line);
		if (id && m && !/^#\d+\s+(observed|came back|fix held|fix did not hold|fix didn't hold)\s*$/i.test(m[1].trim())) {
			problems.push(`ledger: ${id} "Issue: ${m[1].trim()}" must read "Issue: #<N> observed", "#<N> came back", "#<N> fix held" or "#<N> fix did not hold"`);
		}
	}
	const parsed = parseLedger(ledger);
	for (const s of parsed?.exercised ?? []) {
		for (const { n, kind } of s.issues ?? []) {
			const issue = byNumber.get(n);
			if (!issue) {
				problems.push(`ledger: ${s.id} names #${n}, which is not in known-issues.json; only issues linked to the PR get an Issue: line`);
			} else if (issue.relation === 'fixes' && (kind === 'observed' || kind === 'back')) {
				problems.push(`ledger: ${s.id} #${n} is a fix the PR claims; record "fix held" or "fix did not hold", not "${kind === 'back' ? 'came back' : 'observed'}"`);
			} else if (issue.relation !== 'fixes' && (kind === 'held' || kind === 'failed')) {
				problems.push(`ledger: ${s.id} #${n} is a linked issue, not one the PR fixes; record "${issue.state === 'closed' ? 'came back' : 'observed'}"`);
			} else if (kind === 'observed' && issue.state === 'closed') {
				problems.push(`ledger: ${s.id} #${n} is closed, so seeing it again is a finding; record "came back" with Status: FAIL`);
			} else if (kind === 'back' && issue.state !== 'closed') {
				problems.push(`ledger: ${s.id} #${n} is still open; record "observed", not "came back"`);
			} else if ((kind === 'failed' || kind === 'back') && s.status !== 'fail') {
				problems.push(`ledger: ${s.id} says ${kind === 'failed' ? `the fix for #${n} did not hold` : `#${n} came back`}, so it needs a finding and Status: FAIL`);
			}
		}
	}
	for (const r of parsed?.notExercised ?? []) {
		for (const { n, kind } of r.issues ?? []) {
			if (!byNumber.has(n)) {
				problems.push(`ledger: Not run ${r.id} names #${n}, which is not in known-issues.json`);
			} else if ((byNumber.get(n).relation === 'fixes') !== (kind === 'not-exercised')) {
				problems.push(`ledger: Not run ${r.id} #${n}: use "Fix for #N not exercised" for a fix, "Already filed as #N" for a linked issue`);
			}
		}
	}
	const accounted = new Set([...(parsed?.exercised ?? []), ...(parsed?.notExercised ?? [])].flatMap(r => (r.issues ?? []).map(i => i.n)));
	for (const i of byNumber.values()) {
		if (i.relation === 'fixes' && !accounted.has(i.number)) {
			problems.push(`ledger: the PR fixes #${i.number}; record "Issue: #${i.number} fix held" or "fix did not hold" under a scenario, or a Not run row "Fix for #${i.number} not exercised: <reason>"`);
		}
	}
	return problems;
}

/**
 * Finding screenshots that name no step on the card: no `Step N:` caption and
 * no step citing them, a step past the last, or a bare `Variant:`. A screenshot
 * opens only from the step it proves, so one of these has nowhere to show.
 */
export function untaggedShots(findings) {
	const onStep = (f, e) => Number.isInteger(e.step?.order) && e.step.order >= 1 && e.step.order <= f.steps.length;
	return findings.flatMap(f => f.evidence.filter(e => e.kind === 'shot' && !onStep(f, e)).map(e => ({ n: f.n, file: e.file })));
}

/** Sentences in prose, with code spans masked so a `.` inside one cannot end a sentence. */
function sentencesOf(text) {
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
	for (const [label, text] of [['Observed', observed], ['Expected', expected]]) {
		if (text && prose(text).includes(';')) {
			problems.push(`report: Finding ${n} ${label}: joins notes with a semicolon; write it as sentences`);
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

/**
 * @param {string} markdown report.md
 * @param {string | undefined} ledger ledger.md, when the run wrote one
 * @param {{ fileExists?: (path: string) => boolean, listFiles?: () => string[] }} [options]
 * @returns {string[]} one line per problem; empty when the report is clean
 */
export function lintReport(markdown, ledger, { fileExists, listFiles, repoFileExists, knownIssues, actionsLog } = {}) {
	const problems = [];
	const lines = prose(markdown);
	const text = String(markdown ?? '');

	const h1 = lines.filter(({ line }) => /^#\s/.test(line));
	if (h1.length !== 1) { problems.push(`report: needs exactly one "# " heading, found ${h1.length}`); }

	const firstSection = lines.find(({ line }) => /^##\s/.test(line))?.i ?? Infinity;
	const label = name => lines.find(({ line, i }) => i < firstSection && line.startsWith(`**${name}:**`))?.line.slice(name.length + 5).trim();
	const result = label('Result');
	const tested = label('Tested');
	const notExercised = label('Not exercised');
	for (const [name, value] of [['Result', result], ['Tested', tested], ['Not exercised', notExercised]]) {
		if (!value) { problems.push(`report: missing the **${name}:** line above ## Findings`); }
	}
	if (result && /^(yes|no|mostly|partly|partially)\b/i.test(result)) {
		problems.push('report: **Result:** answers a question; state what the change does instead');
	}

	const rows = tableRows(lines, h => h.includes('finding') && h.includes('severity')) ?? [];
	if (!rows.length && !/^\s*no findings\b/im.test(text) && lines.some(({ line }) => /^###\s+Finding\b/.test(line))) {
		problems.push('report: findings have blocks but no findings table');
	}
	if (rows.length && Object.keys(rows[0]).some(k => /^introduced|^origin/.test(k))) {
		problems.push('report: drop the Introduced?/Origin column; origin goes in Cause, and only when the diff settles it');
	}
	if (rows.length && Object.keys(rows[0]).includes('impact')) {
		problems.push('report: drop the Impact column; the title says what is broken');
	}
	for (const row of rows) {
		const n = row['#'];
		if (!['major', 'moderate', 'minor'].includes(row.severity?.toLowerCase())) {
			problems.push(`report: finding ${n} Severity must be major, moderate or minor, got "${row.severity ?? ''}"`);
		}
		const rate = /^(\d+)\/(\d+)$/.exec(row.reproduction ?? '');
		if (!rate) {
			problems.push(`report: finding ${n} Reproduction must be N/M, got "${row.reproduction ?? ''}"`);
		} else if (Number(rate[2]) < 2 && ['major', 'moderate'].includes(row.severity?.toLowerCase())) {
			// One sighting reads as thin to a reviewer, and a repeat in the same instance is cheap.
			problems.push(`report: finding ${n} is ${row.severity.toLowerCase()} but was tried once (${row.reproduction}); repeat its steps in the same instance and give the rate over at least 2 tries`);
		}
	}

	const blocks = [];
	lines.forEach(({ line }, k) => {
		const m = /^###\s+Finding\s+(\d+):\s*\S/.exec(line);
		if (m) { blocks.push({ n: Number(m[1]), k }); }
		else if (/^###\s+(Finding\s+)?\d+\b/.test(line)) { problems.push(`report: "${line.trim()}" must read "### Finding N: <claim>"`); }
	});
	const tableNumbers = new Set(rows.map(r => Number(r['#'])));
	const blockNumbers = new Set(blocks.map(b => b.n));
	for (const n of tableNumbers) { if (!blockNumbers.has(n)) { problems.push(`report: table row ${n} has no "### Finding ${n}:" block`); } }
	for (const n of blockNumbers) { if (!tableNumbers.has(n)) { problems.push(`report: Finding ${n} has a block but no table row`); } }
	const needs = [];
	blocks.forEach((b, j) => {
		// The last finding ends where Run details or Verification details starts:
		// the verifier's reply can say "same as Finding 1" about the report.
		const next = lines.findIndex(({ line }, k) => k > b.k && /^(<details>|## )/.test(line));
		const end = blocks[j + 1]?.k ?? (next === -1 ? lines.length : next);
		const body = lines.slice(b.k + 1, end).map(l => l.line);
		for (const l of body.filter(l => /^\*\*(Repro|Preconditions:)\*\*/.test(l))) {
			needs.push([`Finding ${b.n}`, l]);
		}
		// The bullets under a bare Preconditions: line are its setup too.
		const at = body.findIndex(l => /^\*\*Preconditions:\*\*\s*$/.test(l));
		for (let k = at + 1; at !== -1 && /^[-*]\s+/.test(body[k] ?? ''); k++) {
			needs.push([`Finding ${b.n}`, body[k]]);
			// The card shows the short name, as Coverage does, and the full text on hover.
			const name = /^[-*]\s+([^|]+?)\s+\|\s+\S/.exec(body[k])?.[1];
			if (!name) {
				problems.push(`report: Finding ${b.n} precondition "${body[k].replace(/^[-*]\s+/, '').slice(0, 40)}" needs "<short name> | <full text>"`);
			} else if (name.split(/\s+/).length > 5) {
				problems.push(`report: Finding ${b.n} precondition name "${name}" is ${name.split(/\s+/).length} words; keep it to 2 to 4`);
			}
		}
		const pre = body.find(l => l.startsWith('**Preconditions:**'));
		if (pre && isDefaultsOnly(pre.slice('**Preconditions:**'.length).trim())) {
			problems.push(`report: Finding ${b.n} Preconditions: says only "defaults"; leave the line out`);
		}
		// The filed issue's title is `<Feature>: <claim>`.
		if (!body.some(l => /^\*\*Feature:\*\*\s*\S/.test(l))) {
			problems.push(`report: Finding ${b.n} has no "**Feature:** <feature>" line`);
		}
		if (body.some(l => /^\*\*Impact:\*\*/.test(l))) {
			problems.push(`report: Finding ${b.n} has an Impact line; drop it, and put a fact the run saw, such as no error shown or only reopening restores it, at the end of Observed`);
		}
		const said = {};
		for (const label of ['Observed', 'Expected']) {
			// The first line of a labelled paragraph, through to the blank line after it.
			const at = body.findIndex(l => l.startsWith(`**${label}:**`));
			if (at !== -1) {
				const end = body.findIndex((l, k) => k > at && !l.trim());
				said[label] = body.slice(at, end === -1 ? body.length : end).join(' ').slice(label.length + 5).trim();
				problems.push(...comparisonProblems(b.n, label, said[label]));
			}
		}
		problems.push(...clarityProblems(b.n, lines[b.k].line.replace(/^###\s+Finding\s+\d+:\s*/, ''), said.Observed, said.Expected));
		// Steps are instructions for the reader; which scenario ran them, and how, is the ledger's.
		for (const step of body.filter(l => /^\d+\.\s/.test(l))) {
			const id = /\b[SN]\d{2,}\b/.exec(step.replace(/`[^`]*`/g, ''));
			if (id) {
				problems.push(`report: Finding ${b.n} step "${step.slice(0, 50)}" names ${id[0]}; steps are instructions for the reader, so leave run notes out`);
			}
		}
		const pointer = body.find(l => /\b(as (in )?Finding \d+|same as (above|Finding))\b/i.test(l));
		if (pointer) { problems.push(`report: Finding ${b.n} points at another finding ("${pointer.trim().slice(0, 60)}"); write its steps in full`); }
	});

	for (const { line } of lines) {
		if (!/^\s*Evidence:/.test(line) && /(^|[^[(])`shots\/[^`]+`/.test(line)) {
			problems.push(`report: cite shots as [shots/<file>](shots/<file>), not in backticks: "${line.trim().slice(0, 60)}"`);
		}
		// A URL or shell variable in place of shots/ renders as a broken image.
		const image = [...line.matchAll(/\]\(([^)\s]+\.(?:png|jpe?g|gif|webp))\)/gi)].map(m => m[1]).find(p => !p.startsWith('shots/'));
		if (image) { problems.push(`report: link screenshots as shots/<file>, not ${image}`); }
	}
	// Only citations: a Run details line may name the workspace path.
	const ABSOLUTE = /^`?(\/|~\/)/;
	for (const [name, source] of [['report', lines], ['ledger', prose(ledger)]]) {
		for (const { line } of source) {
			const cited = [
				...[...line.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]),
				...(/^\s*(?:Log|Evidence):\s*(\S+)/.exec(line)?.slice(1) ?? []),
				...(/^-\s+(\S+)\s+\|/.exec(line)?.slice(1) ?? []),
			];
			const abs = cited.find(p => ABSOLUTE.test(p));
			if (abs) { problems.push(`${name}: cite files relative to the run directory, not ${abs}`); }
		}
	}
	// Stacks sit in fences, so this one reads every line. Only out/vs has maps.
	const frame = text.split('\n').find(line => /^\s+at .*\bout\/vs\/\S+\.js:\d+/.test(line));
	if (frame) { problems.push(`report: map compiled frames to source paths: "${frame.trim().slice(0, 60)}"`); }

	const raw = text.split('\n');
	raw.forEach((line, i) => {
		if (/<\/summary>\s*$/.test(line) && raw[i + 1]?.trim()) { problems.push('report: leave a blank line after </summary>'); }
		if (/^\s*<\/details>/.test(line) && raw[i - 1]?.trim()) { problems.push('report: leave a blank line before </details>'); }
	});

	if (fileExists) {
		const missing = [...new Set([...text.matchAll(/\]\((shots\/[^)\s]+)\)/g)].map(m => m[1]))].filter(p => !fileExists(p));
		for (const p of missing) { problems.push(`report: links ${p}, which is not in the run directory`); }
	}

	problems.push(...lintReproScenario(parseReport(text).findings, parseLedger(ledger)?.exercised ?? []));
	// A precondition is the state the steps start from, so no step runs it again.
	for (const f of parseReport(text).findings) {
		const commands = f.preconditions
			.flatMap(p => [...p.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()))
			.filter(c => /[\s(]|^[%!]/.test(c));
		f.steps.forEach((st, k) => {
			const again = commands.find(c => (st.md ?? '').includes('`' + c + '`'));
			if (again) {
				problems.push(`report: Finding ${f.n} step ${k + 1} runs \`${again}\`, which a precondition already sets up; start the steps after it`);
			}
		});
	}
	for (const { n, file } of untaggedShots(parseReport(text).findings)) {
		problems.push(`report: Finding ${n} screenshot ${file} names no step; caption it "Step N:" for the step it proves, and if no step matches, add the step`);
	}
	// One screenshot shows a check; a second earns its place only by showing a
	// different moment, and says so. A control proves Expected, not the failure.
	for (const f of parseReport(text).findings) {
		const byStep = new Map();
		for (const e of f.evidence.filter(e => e.kind === 'shot' && Number.isInteger(e.step?.order) && e.step.order <= f.steps.length)) {
			byStep.set(e.step.order, [...(byStep.get(e.step.order) ?? []), e]);
		}
		for (const [k, shots] of byStep) {
			if (shots.length > 2) {
				problems.push(`report: Finding ${f.n} step ${k} has ${shots.length} screenshots; keep the one that shows the check, add a second only for a different moment, and make a control its own step or leave it out`);
			} else if (shots.length === 2 && shots[0].caption === shots[1].caption) {
				problems.push(`report: Finding ${f.n} step ${k}'s second screenshot ${shots[1].file} repeats the first one's caption; caption it under Evidence with what it shows that the first does not`);
			}
		}
	}
	if (repoFileExists) {
		for (const f of parseReport(text).findings) {
			const paths = [...f.tests.cases.filter(c => c.path && !isNewTestFile(c)), ...f.tests.related].map(t => t.path);
			for (const p of new Set(paths.filter(p => !repoFileExists(p)))) {
				problems.push(`report: Finding ${f.n} names test file ${p}, which is not in the repository; fix the path, mark it (new file), or drop it`);
			}
		}
	}

	problems.push(...lintFiles(markdown, ledger, [...needs, ...ledgerPreconditions(ledger)], { fileExists, listFiles }));

	if (ledger !== undefined) {
		const l = lintLedger(ledger, blockNumbers, fileExists);
		problems.push(...l.problems);
		if (notExercised && !/^`?none`?\.?$/i.test(notExercised) && !l.notRun) {
			problems.push('ledger: **Not exercised:** names surfaces, so ## Not run needs an N line for each');
		}
		if (knownIssues?.issues?.length) {
			problems.push(...lintKnownIssues(ledger, knownIssues));
		}
		if (actionsLog !== undefined) {
			problems.push(...lintShotNames(ledger, actionsLog));
		}
	}
	return problems;
}

/**
 * Every screenshot the ledger cites must appear in actions.log under that name,
 * so a reader can find when it was taken. A shot renamed after the fact is
 * missing from the log, and the log no longer says what it shows.
 */
export function lintShotNames(ledger, actionsLog) {
	const cited = new Set();
	for (const { line } of prose(ledger)) {
		const evidence = /^\s+Evidence:(.*)$/i.exec(line);
		if (evidence) { evidenceFiles(evidence[1]).filter(f => /\.png$/i.test(f)).forEach(f => cited.add(f)); }
	}
	const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return [...cited]
		.filter(f => !new RegExp(`(^|[^\\w-])${escape(f.replace(/\.png$/i, ''))}(\\.png)?(?![\\w-])`, 'm').test(actionsLog))
		.map(f => `ledger: ${f} is cited as Evidence but actions.log never takes a shot by that name; keep the name a shot was taken with, or log the rename`);
}
