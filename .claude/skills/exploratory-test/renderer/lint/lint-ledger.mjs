/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks the run directory a report was written from: the ledger against the
 * format explorer.md gives, the files its setup names, linked issues,
 * actions.log and the screenshots it took, and the findings as the page shows
 * them against the ledger. The wording rules are lint-wording.mjs's.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileProcess, isPositronLog, parseLedger, parseSystemLine } from '../shared/ledger.mjs';
import { problem } from './lint-rules.mjs';
import { CAUSE_LEAD_WORDS, lintPreconditionActions, OPENING_WORDS, RESULT_MAX, SCENARIO_ID, sentencesOf, stepListProblems, stepProblems, verifyProblems, wordsOf } from './lint-wording.mjs';
import { FILE_NAME, FILES_PATH, findFile } from '../page/repro-files.mjs';
import { basename, escapeRegExp, isNewTestFile } from '../shared/text.mjs';

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

/** The files an `Evidence:` value names; prose such as "none, DOM read only" names none. */
function evidenceFiles(value) {
	return value.split(/[\s,;()[\]]+/).map(t => t.replace(/^shots\//, '')).filter(t => /^[\w.-]+\.[a-z0-9]{2,5}$/i.test(t));
}

/**
 * A log line credited to another process than the one whose log file it is in,
 * which sends the reader to the wrong place; nothing when the file's name does
 * not say whose it is, or no process is named.
 */
function processProblems(where, source, named) {
	const whose = fileProcess(source);
	const norm = p => String(p ?? '').toLowerCase().replace(/\s+process$/, '').trim();
	if (!whose || !named || /^(logged|\d)/i.test(named) || norm(named) === norm(whose)) {
		return [];
	}
	return [problem('log-process-mismatch', `${where} credits ${source} to ${named}, but that file is the ${whose.toLowerCase()}'s log; name the process that wrote it`)];
}

function lintLedger(ledger, findingNumbers, fileExists) {
	const problems = [];
	const lines = prose(ledger);
	const scenarios = [];
	const citedBy = new Map();
	let current = null;
	for (const { line } of lines) {
		const head = /^##\s+(S\d+)\b/.exec(line);
		if (head) {
			current = { id: head[1], status: null, verifies: [], steps: [] };
			scenarios.push(current);
			continue;
		}
		if (/^##\s/.test(line)) { current = null; continue; }
		if (!current) { continue; }
		const status = /^Status:\s*(.*)$/.exec(line);
		if (status) { current.status = status[1].trim(); }
		const result = /^Result:\s*(.*)$/.exec(line);
		if (result) { current.result = result[1].trim(); }
		const action = /^\s*(\d+)\.\s+(?!VERIFY\b)(.*)$/i.exec(line);
		if (action) {
			problems.push(...stepProblems(`ledger: ${current.id} step ${action[1]}`, action[2]));
			current.steps.push({ n: action[1], verify: false, text: action[2] });
			const id = SCENARIO_ID.exec(action[2].replace(/`[^`]*`/g, ''));
			if (id) { problems.push(problem('ledger-step-scenario-id', `ledger: ${current.id} step ${action[1]} names ${id[0]}; the step is copied into the finding, whose reader has no scenarios, so say what is open instead`)); }
		}
		const verify = /^\s*(\d+)\.\s+VERIFY\b(.*)$/i.exec(line);
		if (verify) {
			current.steps.push({ n: verify[1], verify: true, text: verify[2].replace(/\s*->.*$/, '').trim(), result: /->\s*(PASS|FAIL)\b/i.exec(verify[2])?.[1].toUpperCase() });
			problems.push(...verifyProblems(`ledger: ${current.id} step ${verify[1]}`, verify[2]));
			current.verifies.push({ step: verify[1], fail: /->\s*FAIL\b/i.test(line), finding: Number(/->\s*FAIL\s*-\s*Finding\s+(\d+)/i.exec(line)?.[1]) || null, observed: false, evidence: false, log: false });
		}
		const field = /^\s+(Observed|Evidence|Log):(.*)$/i.exec(line);
		const check = current.verifies.at(-1);
		if (field && check) {
			const key = field[1].toLowerCase();
			let named = true;
			if (key === 'evidence') {
				// A saved output (a file's content on disk) or a helper's reading in
				// actions.log may sit beside a check's screenshot, never in place of it.
				const saved = [...field[2].matchAll(/(?:^|[\s,(`])((?:logs|files)\/[\w./-]+\.\w+)/g)].map(m => m[1]);
				const missingSaved = fileExists ? saved.filter(f => !fileExists(f)) : [];
				for (const f of missingSaved) { problems.push(problem('evidence-file-missing', `ledger: ${current.id} cites Evidence: ${f}, which is not in the run directory`)); }
				const files = evidenceFiles(field[2].replace(/(?:logs|files)\/[\w./-]+/g, ''));
				const missing = fileExists ? files.filter(f => !fileExists(`shots/${f}`)) : [];
				for (const f of missing) { problems.push(problem('evidence-shot-missing', `ledger: ${current.id} cites Evidence: ${f}, which is not in shots/`)); }
				const present = files.filter(f => !missing.includes(f));
				// A shot is named for the scenario it was taken in, so another prefix
				// means the scenarios were renumbered after their shots were taken.
				for (const f of new Set(present)) {
					const prefix = /^([SN]\d+)-\d+\.\w+$/.exec(f)?.[1];
					if (prefix && prefix !== current.id) {
						problems.push(problem('shot-scenario-mismatch', `ledger: ${current.id} step ${check.step} cites ${f}, a shot named for ${prefix}; IDs are never renumbered, so give the scenario back the ID its shots were taken under`));
					}
				}
				for (const f of new Set(present)) {
					if (!citedBy.has(f)) { citedBy.set(f, []); }
					citedBy.get(f).push({ at: `${current.id} step ${check.step}`, finding: check.fail ? check.finding : null });
				}
				named = present.some(f => /\.png$/i.test(f));
			}
			if (named) { check[key] = true; }
		}
	}

	const seen = new Set();
	for (const s of scenarios) {
		if (seen.has(s.id)) { problems.push(problem('scenario-id-reused', `ledger: ${s.id} appears twice; IDs are never reused`)); }
		seen.add(s.id);
		if (!s.status) {
			problems.push(problem('status-missing', `ledger: ${s.id} has no Status: line`));
		} else if (!/^pass$/i.test(s.status)) {
			const m = /^fail\s*-\s*Finding\s+(\d+)$/i.exec(s.status);
			if (!m) {
				problems.push(problem('status-format', `ledger: ${s.id} Status: must be "pass" or "fail - Finding N", got "${s.status}"`));
			} else if (findingNumbers && !findingNumbers.has(Number(m[1]))) {
				problems.push(problem('status-unknown-finding', `ledger: ${s.id} names Finding ${m[1]}, which the report does not have`));
			}
			// The Coverage row links to the finding, which says what broke.
			if (m && s.result && !/^Fails \d+\/\d+\.?$/i.test(s.result)) {
				problems.push(problem('failed-result-rate', `ledger: ${s.id} Result: of a failed scenario is its rate only, "Fails N/M"; the finding says what broke`));
			}
			// A scenario fails one finding, so its rate counts only checks of that finding.
			for (const v of s.verifies.filter(v => v.finding && v.finding !== Number(m?.[1]))) {
				problems.push(problem('scenario-fails-other-finding', `ledger: ${s.id} step ${v.step} fails Finding ${v.finding} but the scenario's Status names Finding ${m?.[1]}; give Finding ${v.finding}'s check a scenario of its own`));
			}
		}
		if (!s.verifies.length) { problems.push(problem('scenario-no-verify', `ledger: ${s.id} has no VERIFY step`)); }
		problems.push(...stepListProblems(`ledger: ${s.id}`, s.steps));
		// A Result that runs on is usually carrying something the run did not
		// expect, and in a pass that is where a finding goes unnoticed.
		if (s.result && (s.result.length > RESULT_MAX || sentencesOf(s.result).length > 1)) {
			problems.push(problem('result-too-long', `ledger: ${s.id} Result: is ${sentencesOf(s.result).length > 1 ? `${sentencesOf(s.result).length} sentences` : `${s.result.length} characters`}; keep it to one short sentence, and give anything you did not expect its own VERIFY step`));
		}
		// A repeat failure in the same scenario searches the same logs, so only the
		// scenario's first failed check needs its Log: line.
		const firstFail = s.verifies.find(v => v.fail);
		for (const v of s.verifies) {
			if (!v.evidence) { problems.push(problem('verify-no-shot', `ledger: ${s.id} step ${v.step} VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it`)); }
			const missing = v.fail ? ['observed', ...(v === firstFail ? ['log'] : [])].filter(key => !v[key]) : [];
			if (missing.length) {
				problems.push(problem('fail-missing-fields', `ledger: ${s.id} step ${v.step} FAIL is missing ${missing.map(m => `${m[0].toUpperCase()}${m.slice(1)}:`).join(', ')}`));
			}
		}
	}
	// Two findings seen on one screen share its shot: each check is its own
	// step, failing a different finding. Any other reuse is a check left unshot.
	for (const [f, checks] of citedBy) {
		const findings = checks.map(c => c.finding);
		const shared = findings.every(n => n !== null) && new Set(findings).size === findings.length;
		if (checks.length > 1 && !shared) { problems.push(problem('shot-cited-twice', `ledger: ${f} is Evidence for ${checks.map(c => c.at).join(' and ')}; take a screenshot for each check`)); }
	}
	// The issue button's System details come from this line, so it has to parse.
	const env = lines.findIndex(({ line }) => /^##\s+Environment\b/i.test(line));
	const first = env < 0 ? null : lines.slice(env + 1).find(({ line }) => /^(?:##\s|[-*]\s)/.test(line));
	if (env < 0) {
		problems.push(problem('environment-missing', 'ledger: no ## Environment section'));
	} else if (!first || /^##\s/.test(first.line) || !parseSystemLine(first.line)) {
		problems.push(problem('environment-first-line', 'ledger: the first Environment bullet must read "- Positron <version> build <n>, <kind> of <commit> (Code - OSS <version>), on <OS> <version> (<platform> <arch>)." with "not recorded" for anything unknown'));
	}

	const notRun = lines.filter(({ line }) => /^-\s+N\d+\b/.test(line)).length;
	for (const s of parseLedger(ledger)?.exercised ?? []) {
		for (const [k, st] of s.steps.entries()) {
			problems.push(...processProblems(`ledger: ${s.id} step ${k + 1} Log:`, st.error?.source, st.error?.meta?.[0]));
		}
	}
	return { problems, scenarioCount: scenarios.length, notRun };
}

const failsOf = s => /\bFails (\d+)\/(\d+)\b/.exec(String(s.resultHtml ?? '').replace(/<[^>]+>/g, ''))?.slice(1).map(Number) ?? null;

/**
 * How a finding's rate ("N/M") disagrees with the ledger, or null. It is at
 * least the repro scenario's own and at most every try of every scenario that
 * failed for the finding: a retry the run logged as a scenario of its own counts.
 */
export function rateProblem(rate, owner, failed) {
	const got = /^(\d+)\/(\d+)$/.exec(String(rate ?? '').trim())?.slice(1).map(Number);
	const own = failsOf(owner);
	if (!got || !own) {
		return null;
	}
	const all = failed.map(failsOf).filter(Boolean).reduce(([n, m], [a, b]) => [n + a, m + b], [0, 0]);
	const [max, maxTries] = [Math.max(all[0], own[0]), Math.max(all[1], own[1])];
	if (got[0] >= own[0] && got[1] >= own[1] && got[0] <= max && got[1] <= maxTries && got[0] <= got[1]) {
		return null;
	}
	const base = `is ${got.join('/')}, but ${owner.id}, whose steps the repro shows, fails ${own.join('/')}`;
	return max === own[0] && maxTries === own[1]
		? `${base}; give that rate`
		: `${base} and the scenarios that failed for it fail ${max}/${maxTries} in all; give a rate between the two, counting only tries of the same steps`;
}

/**
 * The test-file rules: every file a finding's setup or a scenario's
 * precondition names is saved under `files/` and listed in `## Files`, and the
 * two agree. `needs` is `[where, text, name?]` for each setup line to check.
 */
function lintFiles(markdown, ledger, needs, { fileExists, listFiles }) {
	const problems = [];
	const files = parseLedger(ledger)?.files ?? [];
	for (const f of files) {
		if (!/^files\/./.test(f.path)) {
			problems.push(problem('files-outside-files', `ledger: ## Files lists ${f.path}; save it under files/ and list that path`));
		} else if (fileExists && !fileExists(f.path)) {
			problems.push(problem('files-listed-missing', `ledger: ## Files lists ${f.path}, which is not in the run directory`));
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
		if (!listed.has(p)) { problems.push(problem('files-named-unlisted', `ledger: ${p} is named but not listed in ## Files`)); }
	}
	for (const p of listFiles ? listFiles() : []) {
		if (!listed.has(p)) { problems.push(problem('files-saved-unlisted', `ledger: ${p} is saved but not listed in ## Files`)); }
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
				problems.push(problem('file-named-twice', `${where} names ${name} twice, bare and as ${path}; write \`${path}\` once in place of the name, and the page shows it as ${name}`));
			}
		}
		// A setup that is about a file not being there names it on purpose.
		const absent = /\b(does not exist|doesn't exist|nonexistent|non-existent|missing|absent|not there|deleted)\b/i.test(String(text).replace(/`[^`]*`/g, ''));
		for (const m of String(text).matchAll(FILE_NAME)) {
			if (twice.has(m[1]) || absent) { continue; }
			// "user settings.json" is the app's own file; the setting goes in the step.
			// A files/ path is the rule above's.
			// A drive-positron helper the run set up with is not a test file.
			if (findFile(files, m[1]) || APP_CONFIG.test(m[1]) || m[1].startsWith('files/') || HELPERS.has(basename(m[1]))) { continue; }
			const same = files.filter(f => basename(f.path) === basename(m[1]));
			if (same.length > 1) {
				problems.push(problem('file-name-ambiguous', `${where} names ${m[1]}, which matches ${same.map(f => f.path).join(' and ')}; name it by its files/ path`));
				continue;
			}
			const at = unsaved.get(m[1]) ?? [];
			if (!at.includes(where)) { at.push(where); }
			unsaved.set(m[1], at);
		}
	}
	for (const [name, at] of unsaved) {
		problems.push(problem('file-not-saved', `${name} is named by ${at.join(', ')} but not saved; save it to files/ as it was when used and list it under ## Files in the ledger`));
	}
	return problems;
}

// The app's own configuration files, named by where a setting lives.
const APP_CONFIG = /^(settings|keybindings|launch|tasks|extensions|argv)\.json$/i;

// drive-positron's helper scripts (run-venv.sh, settings.sh, ...), read from its folder.
const HELPERS = (() => {
	try {
		return new Set(readdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drive-positron', 'scripts')));
	} catch {
		return new Set();
	}
})();

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
function lintKnownIssues(ledger, knownIssues, { final = true } = {}) {
	const problems = [];
	const byNumber = new Map((knownIssues?.issues ?? []).map(i => [i.number, i]));
	let id = null;
	for (const { line } of prose(ledger)) {
		const head = /^##\s+(\S+)/.exec(line);
		if (head) { id = /^S\d+$/.test(head[1]) ? head[1] : null; continue; }
		const m = /^Issue:\s*(.*)$/.exec(line);
		if (id && m && !/^#\d+\s+(observed|came back|fix held|fix did not hold|fix didn't hold)\s*$/i.test(m[1].trim())) {
			problems.push(problem('issue-line-format', `ledger: ${id} "Issue: ${m[1].trim()}" must read "Issue: #<N> observed", "#<N> came back", "#<N> fix held" or "#<N> fix did not hold"`));
		}
	}
	const parsed = parseLedger(ledger);
	for (const s of parsed?.exercised ?? []) {
		for (const { n, kind } of s.issues ?? []) {
			const issue = byNumber.get(n);
			if (!issue) {
				problems.push(problem('issue-not-linked', `ledger: ${s.id} names #${n}, which is not in known-issues.json; only issues linked to the PR get an Issue: line`));
			} else if (issue.relation === 'fixes' && (kind === 'observed' || kind === 'back')) {
				problems.push(problem('issue-fix-kind', `ledger: ${s.id} #${n} is a fix the PR claims; record "fix held" or "fix did not hold", not "${kind === 'back' ? 'came back' : 'observed'}"`));
			} else if (issue.relation !== 'fixes' && (kind === 'held' || kind === 'failed')) {
				// "fix held" tests the PR's claim; a linked issue makes none, so not seeing it says nothing.
				problems.push(problem('issue-linked-kind', issue.state === 'closed'
					? `ledger: ${s.id} #${n} is a closed linked issue, not one the PR fixes; record "came back" only if it showed up again, otherwise leave the Issue: line out`
					: `ledger: ${s.id} #${n} is an open linked issue, not one the PR fixes; record "observed" only if the scenario ran into it, otherwise leave the Issue: line out`));
			} else if (kind === 'observed' && issue.state === 'closed') {
				problems.push(problem('issue-closed-observed', `ledger: ${s.id} #${n} is closed, so seeing it again is a finding; record "came back" with Status: FAIL`));
			} else if (kind === 'back' && issue.state !== 'closed') {
				problems.push(problem('issue-open-came-back', `ledger: ${s.id} #${n} is still open; record "observed", not "came back"`));
			} else if ((kind === 'failed' || kind === 'back') && s.status !== 'fail') {
				problems.push(problem('issue-needs-finding', `ledger: ${s.id} says ${kind === 'failed' ? `the fix for #${n} did not hold` : `#${n} came back`}, so it needs a finding and Status: FAIL`));
			}
		}
	}
	for (const r of parsed?.notExercised ?? []) {
		for (const { n, kind } of r.issues ?? []) {
			if (!byNumber.has(n)) {
				problems.push(problem('not-run-issue-not-linked', `ledger: Not run ${r.id} names #${n}, which is not in known-issues.json`));
			} else if ((byNumber.get(n).relation === 'fixes') !== (kind === 'not-exercised')) {
				problems.push(problem('not-run-issue-kind', `ledger: Not run ${r.id} #${n}: use "Fix for #N not exercised" for a fix, "Already filed as #N" for a linked issue`));
			}
		}
	}
	const accounted = new Set([...(parsed?.exercised ?? []), ...(parsed?.notExercised ?? [])].flatMap(r => (r.issues ?? []).map(i => i.n)));
	// Mid-run, a fix not yet tested is one still to come.
	for (const i of final ? byNumber.values() : []) {
		if (i.relation === 'fixes' && !accounted.has(i.number)) {
			problems.push(problem('fix-not-accounted', `ledger: the PR fixes #${i.number}; record "Issue: #${i.number} fix held" or "fix did not hold" under a scenario, or a Not run row "Fix for #${i.number} not exercised: <reason>"`));
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

/** The rules on findings as the page shows them: reportFromJson's model. */
export function modelProblems(findings, ledger, { repoFileExists } = {}) {
	const problems = [];
	// Readers never see scenario IDs, so a finding's prose says what a run was in words.
	for (const f of findings) {
		const fields = [['title', f.title], ['observed', f.observedHtml], ['expected', f.expectedHtml], ['cause', f.causeHtml]];
		for (const [label, value] of fields) {
			const words = String(value ?? '').replace(/<code[^>]*>[\s\S]*?<\/code>/g, '').replace(/`[^`]*`/g, '').replace(/<[^>]+>/g, '');
			const ids = [...new Set([...words.matchAll(/(?<![\w/.-])[SN]\d{2,}(?![\w-])/g)].map(m => m[0]))];
			if (ids.length) {
				problems.push(problem('finding-scenario-id', `report: Finding ${f.n} ${label} names ${ids.join(', ')}; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs`));
			}
		}
	}
	// The summary opens the issue filed from the finding; without one its description is dropped.
	for (const f of findings) {
		const summary = f.text.summary.trim();
		const sentences = sentencesOf(summary).length;
		if (!summary) {
			problems.push(problem('summary-missing', `report: Finding ${f.n} has no summary; write the sentence that opens its GitHub issue: the visible failure, with exact numbers and on-screen text`));
		} else if (sentences > 2 || wordsOf(summary) > OPENING_WORDS) {
			const size = sentences > 2 ? `has ${sentences} sentences` : `is ${wordsOf(summary)} words`;
			problems.push(problem('summary-length', `report: Finding ${f.n} summary ${size}; keep it to one sentence of ${OPENING_WORDS} words or fewer, two only when the bug needs it`));
		}
	}
	// A reader who stops after a Cause's first sentence still learns the suspect.
	for (const f of findings) {
		const lead = f.text.cause && sentencesOf(f.text.cause)[0];
		if (lead && wordsOf(lead) > CAUSE_LEAD_WORDS) {
			problems.push(problem('cause-lead-length', `report: Finding ${f.n} cause opens with a ${wordsOf(lead)}-word sentence; name the suspect in ${CAUSE_LEAD_WORDS} words or fewer, then give the detail`));
		}
	}
	for (const { n, file } of untaggedShots(findings)) {
		problems.push(problem('shot-no-step', `report: Finding ${n} screenshot ${file} names no step; caption it "Step N:" for the step it proves or "S06:" for the scenario that took it, and if neither fits, add the step`));
	}
	// A shot captioned with a scenario is that scenario's run of the bug, so the ledger shows it there.
	const exercised = parseLedger(ledger)?.exercised;
	for (const f of exercised ? findings : []) {
		for (const e of f.evidence.filter(e => e.kind === 'shot' && e.scenario)) {
			const s = exercised.find(s => s.id === e.scenario);
			if (!s) {
				problems.push(problem('shot-unknown-scenario', `report: Finding ${f.n} screenshot ${e.file} is captioned ${e.scenario}, which the ledger does not have; name the scenario that took it`));
			} else if (!s.steps.some(st => st.evidence.some(x => basename(x.file || x.href) === e.file))) {
				problems.push(problem('shot-scenario-uncited', `report: Finding ${f.n} screenshot ${e.file} is captioned ${e.scenario}, but ${e.scenario} never cites it as Evidence; name the scenario that took it`));
			}
		}
	}
	// One screenshot shows a check; a second earns its place only by showing a
	// different moment, and says so. A control proves Expected, not the failure.
	for (const f of findings) {
		f.steps.forEach((st, i) => {
			// A step's moments are the shots its own Evidence: line cites. One
			// listed under Evidence for the step but not cited by it is another
			// run's, as is another scenario's: not a second moment of this one.
			const own = new Set(st.evidence.map(x => x.file));
			const shots = f.evidence.filter(e => e.kind === 'shot' && !e.scenario && own.has(e.file));
			if (shots.length > 2) {
				problems.push(problem('too-many-shots', `report: Finding ${f.n} step ${i + 1} has ${shots.length} screenshots; keep the one that shows the check, add a second only for a different moment, and make a control its own step or leave it out`));
			} else if (shots.length === 2 && shots[0].caption === shots[1].caption) {
				problems.push(problem('second-shot-caption', `report: Finding ${f.n} step ${i + 1}'s second screenshot ${shots[1].file} repeats the first one's caption; caption it under evidence with what it shows that the first does not`));
			}
		});
	}
	// Evidence shows what Positron logged and nothing else; reasons go in Observed or Cause.
	for (const f of findings) {
		for (const e of f.evidence.filter(x => x.kind === 'log')) {
			problems.push(...processProblems(`report: Finding ${f.n} evidence`, e.path, e.process));
		}
	}
	for (const f of findings) {
		for (const e of f.evidence) {
			if (e.kind === 'note') {
				problems.push(problem('evidence-note', `report: Finding ${f.n} evidence has a note ("${e.text.slice(0, 50)}"); evidence is log lines only, so state it in observed or cause`));
			} else if (e.kind === 'log' && !isPositronLog(e.path)) {
				problems.push(problem('evidence-run-file', `report: Finding ${f.n} evidence cites ${e.path}, which the run wrote, not Positron; cite the Positron log line, or state what happened in observed`));
			} else if ((e.kind === 'log' || e.kind === 'missing') && e.note) {
				problems.push(problem('evidence-trailing-note', `report: Finding ${f.n} evidence follows ${e.path}'s line with "${e.note.slice(0, 50)}"; quote the line alone, and put what it means in observed or cause`));
			}
		}
	}
	for (const f of repoFileExists ? findings : []) {
		const paths = [...f.tests.cases.filter(c => c.path && !isNewTestFile(c)), ...f.tests.related].map(t => t.path);
		for (const p of new Set(paths.filter(p => !repoFileExists(p)))) {
			problems.push(problem('test-file-missing', `report: Finding ${f.n} names test file ${p}, which is not in the repository; fix the path, mark it (new file), or drop it`));
		}
	}
	return problems;
}

// Only citations: a Run details line may name the workspace path.
const ABSOLUTE = /^`?(\/|~\/)/;

/** The files a line cites: link targets, a Log: or Evidence: value, a ## Files row. */
function citedPaths(line) {
	return [
		...[...line.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]),
		...(/^\s*(?:Log|Evidence):\s*(\S+)/.exec(line)?.slice(1) ?? []),
		...(/^-\s+(\S+)\s+\|/.exec(line)?.slice(1) ?? []),
	];
}

/** The first of `paths` that is absolute, as a problem. */
export function absolutePathProblems(name, paths) {
	const abs = paths.find(p => ABSOLUTE.test(p));
	return abs ? [problem('absolute-path', `${name}: cite files relative to the run directory, not ${abs}`)] : [];
}

/**
 * The rules on the run directory the report was written from: the ledger, the
 * files the setup names, linked issues and actions.log. `text` is the
 * report's prose, for the files/ paths it names; `needs` is `[where, text, name?]` for
 * each of its setup lines.
 */
export function runProblems(text, ledger, { needs = [], findingNumbers, notExercised, fileExists, listFiles, knownIssues, actionsLog, session } = {}) {
	const problems = [];
	for (const { line } of prose(ledger)) {
		problems.push(...absolutePathProblems('ledger', citedPaths(line)));
	}
	const preconditions = [...needs, ...ledgerPreconditions(ledger)];
	problems.push(...lintFiles(text, ledger, preconditions, { fileExists, listFiles }));
	problems.push(...lintPreconditionActions(preconditions));
	if (ledger !== undefined) {
		const l = lintLedger(ledger, findingNumbers, fileExists);
		problems.push(...l.problems);
		if (notExercised && !/^`?none`?\.?$/i.test(notExercised) && !l.notRun) {
			problems.push(problem('not-exercised-unlisted', 'ledger: header.notExercised names surfaces, so ## Not run needs an N line for each'));
		}
		if (knownIssues?.issues?.length) {
			problems.push(...lintKnownIssues(ledger, knownIssues));
		}
		if (actionsLog !== undefined) {
			problems.push(...lintShotNames(ledger, actionsLog));
			problems.push(...lintShotTiming(ledger, actionsLog));
		}
	}
	if (actionsLog !== undefined) {
		problems.push(...lintActionsLog(actionsLog, { session }));
	}
	return problems;
}

/**
 * The ledger alone, mid-run: what can be fixed while the instance is still up,
 * such as a check with no shot or a FAIL with no Log:. Nothing that needs the
 * report, and no linked fix still to be tested.
 * @returns {string[]} one line per problem, as lint-json's
 */
export function lintLedgerOnly(ledger, { fileExists, listFiles, knownIssues, actionsLog, session } = {}) {
	const problems = [...lintLedger(ledger, null, fileExists).problems];
	problems.push(...lintFiles('', ledger, ledgerPreconditions(ledger), { fileExists, listFiles }));
	problems.push(...lintPreconditionActions(ledgerPreconditions(ledger)));
	if (knownIssues?.issues?.length) {
		problems.push(...lintKnownIssues(ledger, knownIssues, { final: false }));
	}
	if (actionsLog !== undefined) {
		problems.push(...lintShotNames(ledger, actionsLog), ...lintShotTiming(ledger, actionsLog), ...lintActionsLog(actionsLog, { session }));
	}
	return problems;
}

// How every line drive-positron's log writer (write() in dp-lib.ts) appends
// starts: the UTC time to the second, then a space.
const LOG_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) /;
// Two helpers running at once can append a second out of order; more is an edit.
const LOG_SLACK_MS = 1000;

/**
 * actions.log is append-only and written only by the helpers and `dp.ts log`,
 * so every line starts with the time the writer stamps, and no line is earlier
 * than one above it. A line in another format was written by hand, and one that
 * goes back in time was backdated or moved: either way the log no longer says
 * what happened when, which is what the verifier checks the steps against.
 * With the run's Playwright `session`, a line under another session name drove
 * a window that may be another run's.
 * @returns {string[]} one line per kind of problem
 */
export function lintActionsLog(actionsLog, { session } = {}) {
	const unstamped = [];
	const back = [];
	const other = [];
	let latest = null;
	String(actionsLog ?? '').split('\n').forEach((line, i) => {
		if (!line.trim()) { return; }
		const name = / -s=([^\s:]+):/.exec(line)?.[1];
		if (session && name && name !== session && !name.startsWith(`${session}-`)) {
			other.push({ n: i + 1, name });
		}
		const m = LOG_TIME.exec(line);
		if (!m) {
			unstamped.push({ n: i + 1, line: line.trim() });
			return;
		}
		const t = Date.parse(m[1]);
		if (latest && t < latest.t - LOG_SLACK_MS) {
			back.push({ n: i + 1, at: m[1], after: latest });
		} else if (!latest || t > latest.t) {
			latest = { n: i + 1, t, at: m[1] };
		}
	});
	const lines = list => `${list.length > 1 ? 'lines' : 'line'} ${list.slice(0, 3).map(x => x.n).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}`;
	const problems = [];
	if (unstamped.length) {
		const first = unstamped[0].line;
		problems.push(problem('log-unstamped', `actions.log: ${lines(unstamped)} ${unstamped.length > 1 ? 'do' : 'does'} not start with the UTC time the helpers write ("2026-01-02T03:04:05Z "), such as "${first.length > 50 ? `${first.slice(0, 47)}...` : first}"; log what no helper logged with \`dp.ts log\`, and never write or rewrite a line yourself`));
	}
	if (back.length) {
		const [b] = back;
		const first = `line ${b.n} (${b.at}) is earlier than line ${b.after.n} above it (${b.after.at})`;
		problems.push(problem('log-backdated', `actions.log: ${back.length > 1 ? `${lines(back)} are earlier than a line above them, first ${first}` : first}; the log is append-only, so log a missed action as a note when you notice it, and never backdate or move a line`));
	}
	if (other.length) {
		problems.push(problem('log-other-session', `actions.log: ${lines(other)} drove Playwright session "${other[0].name}", not this run's "${session}" or a name starting "${session}-"; another run on this machine may own that window, so check what those lines read, and use your own session from here`));
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
	return [...cited]
		.filter(f => !new RegExp(`(^|[^\\w-])${escapeRegExp(f.replace(/\.png$/i, ''))}(\\.png)?(?![\\w-])`, 'm').test(actionsLog))
		.map(f => problem('shot-name-unlogged', `ledger: ${f} is cited as Evidence but actions.log never takes a shot by that name; keep the name a shot was taken with, or log the rename`));
}

/**
 * A step cites the shot taken at its check. shot.sh logs each one, so a
 * scenario whose cited shots run backwards in the log cites one for a step it
 * was not taken at. A name taken twice is a file holding only the last capture:
 * fine when that capture falls between the scenario's checks before and after
 * the one citing it, and the wrong picture when it does not.
 */
export function lintShotTiming(ledger, actionsLog) {
	const problems = [];
	const taken = new Map();
	String(actionsLog ?? '').split('\n').forEach((line, i) => {
		const m = /\bshot\.sh\b[^:]*:\s*screenshot\s+(\S+?\.png)\b/i.exec(line);
		if (m) { taken.set(m[1], [...(taken.get(m[1]) ?? []), i]); }
	});
	// Each scenario's cited shots, in the order its steps cite them.
	const scenarios = [];
	let step = null;
	for (const { line } of prose(ledger)) {
		const head = /^##\s+(\S+)/.exec(line);
		if (head) {
			if (/^S\d+$/.test(head[1])) { scenarios.push({ id: head[1], cited: [] }); } else { scenarios.push(null); }
			continue;
		}
		const current = scenarios.at(-1);
		if (!current) { continue; }
		const numbered = /^\s*(\d+)\.\s/.exec(line);
		if (numbered) { step = numbered[1]; continue; }
		const evidence = /^\s+Evidence:(.*)$/i.exec(line);
		if (!evidence) { continue; }
		for (const f of evidenceFiles(evidence[1]).filter(f => taken.has(f))) {
			current.cited.push({ f, step, when: taken.get(f).at(-1) });
		}
	}
	const twice = new Set();
	for (const { id, cited } of scenarios.filter(Boolean)) {
		let last = null;
		cited.forEach((c, k) => {
			const at = taken.get(c.f);
			if (at.length > 1 && !twice.has(c.f)) {
				twice.add(c.f);
				const next = cited.slice(k + 1).find(n => n.f !== c.f);
				const inPlace = (!last || c.when > last.when) && (!next || c.when < next.when);
				problems.push(inPlace
					? problem('shot-retaken-in-place', `ledger: ${c.f} was taken ${at.length} times in actions.log; the file is the last capture, taken before ${id} step ${c.step}'s check and after the one before it, so check that it shows step ${c.step}`)
					: problem('shot-retaken', `ledger: ${c.f} was taken ${at.length} times in actions.log, so the file is only the last capture; give each capture its own name and cite the one taken at the check`));
			}
			if (last && c.when < last.when) {
				problems.push(problem('shot-out-of-order', `ledger: ${id} step ${c.step} cites ${c.f}, which actions.log took before ${last.f} (step ${last.step}); cite the shot taken at each check`));
			} else {
				last = c;
			}
		});
	}
	return problems;
}
