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

import { basename, isDefaultsOnly, isNewTestFile, parseLedger, parseReport } from './report-parse.mjs';
import { FILE_NAME, findFile } from './repro-files.mjs';

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

function lintLedger(ledger, findingNumbers, fileExists) {
	const problems = [];
	const lines = prose(ledger);
	const scenarios = [];
	let current = null;
	for (const { line } of lines) {
		const head = /^##\s+(S\d+)\b/.exec(line);
		if (head) {
			current = { id: head[1], status: null, verifies: 0, evidence: 0, fails: [] };
			scenarios.push(current);
			continue;
		}
		if (/^##\s/.test(line)) { current = null; continue; }
		if (!current) { continue; }
		const status = /^Status:\s*(.*)$/.exec(line);
		if (status) { current.status = status[1].trim(); }
		if (/^\s*\d+\.\s+VERIFY\b/i.test(line)) {
			current.verifies++;
			if (/->\s*FAIL\b/i.test(line)) { current.fails.push({ observed: false, evidence: false, log: false }); }
		}
		const field = /^\s+(Observed|Evidence|Log):(.*)$/i.exec(line);
		if (field) {
			const key = field[1].toLowerCase();
			let named = true;
			if (key === 'evidence') {
				const files = evidenceFiles(field[2]);
				const missing = fileExists ? files.filter(f => !fileExists(`shots/${f}`)) : [];
				for (const f of missing) { problems.push(`ledger: ${current.id} cites Evidence: ${f}, which is not in shots/`); }
				named = files.length > missing.length;
				if (named) { current.evidence++; }
			}
			const fail = current.fails.at(-1);
			if (fail && named) { fail[key] = true; }
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
		}
		if (!s.verifies) { problems.push(`ledger: ${s.id} has no VERIFY step`); }
		if (/^pass$/i.test(s.status ?? '') && !s.evidence) { problems.push(`ledger: ${s.id} passes with no Evidence: naming a screenshot in shots/`); }
		s.fails.forEach((f, k) => {
			const missing = ['observed', 'evidence', 'log'].filter(key => !f[key]);
			if (missing.length) {
				problems.push(`ledger: ${s.id} FAIL check ${k + 1} is missing ${missing.map(m => m === 'evidence' ? 'Evidence: (a screenshot file)' : `${m[0].toUpperCase()}${m.slice(1)}:`).join(', ')}`);
			}
		});
	}
	const notRun = lines.filter(({ line }) => /^-\s+N\d+\b/.test(line)).length;
	return { problems, scenarioCount: scenarios.length, notRun };
}

/**
 * A finding's repro is one ledger scenario's steps: every screenshot its steps
 * cite comes from a single scenario, and that scenario failed for this finding.
 * Other runs belong under Evidence as a Variant.
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
			problems.push(`report: Finding ${f.n}'s steps mix ${ids.join(' and ')}; the repro is one scenario's steps, and other runs go under Evidence as a Variant`);
		} else if (!whole.some(s => s.finding === f.n || s.steps.some(st => st.finding === f.n))) {
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
		for (const m of line.matchAll(/(?<![\w/.-])(files\/[\w./-]*\.\w+)(?!\w|\.\w)/g)) { named.add(m[1]); }
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
		for (const m of String(text).matchAll(FILE_NAME)) {
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

/**
 * @param {string} markdown report.md
 * @param {string | undefined} ledger ledger.md, when the run wrote one
 * @param {{ fileExists?: (path: string) => boolean, listFiles?: () => string[] }} [options]
 * @returns {string[]} one line per problem; empty when the report is clean
 */
export function lintReport(markdown, ledger, { fileExists, listFiles, repoFileExists } = {}) {
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
	for (const row of rows) {
		const n = row['#'];
		if (!['major', 'moderate', 'minor'].includes(row.severity?.toLowerCase())) {
			problems.push(`report: finding ${n} Severity must be major, moderate or minor, got "${row.severity ?? ''}"`);
		}
		if (!/^\d+\/\d+$/.test(row.reproduction ?? '')) {
			problems.push(`report: finding ${n} Reproduction must be N/M, got "${row.reproduction ?? ''}"`);
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
		const end = blocks[j + 1]?.k ?? lines.length;
		const body = lines.slice(b.k + 1, end).map(l => l.line);
		for (const l of body.filter(l => /^\*\*(Repro|Preconditions:)\*\*/.test(l))) {
			needs.push([`Finding ${b.n}`, l]);
		}
		const pre = body.find(l => l.startsWith('**Preconditions:**'));
		if (pre && isDefaultsOnly(pre.slice('**Preconditions:**'.length).trim())) {
			problems.push(`report: Finding ${b.n} Preconditions: says only "defaults"; leave the line out`);
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
	}
	return problems;
}
