/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The verification step every run ends with, shared by CI (run.mjs) and a
// local run, so a report reads the same wherever it was made. The verifier is
// an agent and each side runs it its own way; everything around it is here.
// The pipeline calls writeVerifyPrompt and applyVerifyReply.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownFixLines, knownIssueOutcomes } from '../known-issues.mjs';
import { lintActionsLog } from '../lint/lint-ledger.mjs';
import { mainProblems } from '../lint/lint-wording.mjs';
import { parseLedger } from '../shared/ledger.mjs';
import { originFromMain } from '../shared/main-check.mjs';
import { readJson } from '../shared/text.mjs';

/**
 * The verify pass's prompt: verifier.md with the run's paths and diff range
 * filled in, and lint's check of actions.log, read from the run directory
 * unless `actionsLog` is given. A placeholder with no value, or a value with
 * no placeholder, throws, so the template and this list cannot drift apart quietly.
 */
export function buildVerifyPrompt(template, { workDir, repoRoot, baseSha, headSha, actionsLog, session, reportFile = join(workDir, 'report.json') }) {
	const logPath = join(workDir, 'actions.log');
	const log = actionsLog ?? (existsSync(logPath) ? readFileSync(logPath, 'utf8') : undefined);
	const logProblems = log === undefined ? [] : lintActionsLog(log, { session });
	const values = {
		LOG_CHECK: log === undefined
			? 'no actions.log in the run directory.'
			: logProblems.length ? `\n\n${logProblems.map(p => `- ${p.text}`).join('\n')}\n` : 'clean: every line is stamped as the helpers stamp it, in time order.',
		REPORT: reportFile,
		ACTIONS_LOG: `${workDir}/actions.log`,
		LEDGER: `${workDir}/ledger.md`,
		FILES: `${workDir}/files/`,
		KNOWN_ISSUES: `${workDir}/known-issues.json`,
		REPO: repoRoot,
		DIFF: `${baseSha}...${headSha}`,
		SEARCH: `node ${join(dirname(fileURLToPath(import.meta.url)), '..', 'known-issues.mjs')} --search`,
	};
	const used = new Set();
	const missing = new Set();
	const prompt = String(template).replace(/\{\{(\w+)\}\}/g, (whole, key) => {
		if (!(key in values)) {
			missing.add(key);
			return whole;
		}
		used.add(key);
		return values[key];
	});
	const unused = Object.keys(values).filter(k => !used.has(k));
	if (missing.size || unused.length) {
		throw new Error(`verifier.md placeholders out of step: ${[...[...missing].map(k => `no value for {{${k}}}`), ...unused.map(k => `{{${k}}} not in the template`)].join(', ')}`);
	}
	return prompt.trim();
}

/**
 * Whether the run has a base a finding's origin can be judged against: a base
 * SHA, not the head, with commits and a diff between them. A main run has none. `name`
 * is the base ref the reader knows, when the caller has it.
 */
export function changeBase(repoRoot, baseSha, headSha, name) {
	const out = reason => ({ usable: !reason, reason, name: name || null });
	if (!baseSha || !headSha) {
		return out('no base commit');
	}
	if (baseSha === headSha) {
		return out('the base is the head');
	}
	try {
		const count = execFileSync('git', ['-C', repoRoot, 'rev-list', '--count', `${baseSha}..${headSha}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		if (count === '0') {
			return out('no commits between the base and the head');
		}
	} catch {
		return out('git could not list the commits between the base and the head');
	}
	try {
		execFileSync('git', ['-C', repoRoot, 'diff', '--quiet', `${baseSha}...${headSha}`], { stdio: 'ignore' });
		return out('the diff is empty');
	} catch (e) {
		// --quiet exits 1 when there is a diff.
		return out(e.status === 1 ? '' : 'git could not diff the base and the head');
	}
}

/** Writes what the renderer needs of changeBase to <run dir>/change-base.json. */
export function writeChangeBase(dir, base) {
	writeFileSync(join(dir, 'change-base.json'), `${JSON.stringify({ usable: base.usable, name: base.name })}\n`);
}

const VERDICTS = { 'confirmed': 'confirmed', 'false positive': 'disputed', 'unresolved': 'unresolved' };
const SEVERITIES = ['major', 'moderate', 'minor'];

/**
 * The verifier's reply: the fenced `json` block it opens with, and its notes
 * after the block. Anything before the block is its notes to itself, and is
 * dropped. `findings` maps a finding number to `{ verified, known, intended,
 * feature, title, fix }`, `linked` an issue number to its severity, and
 * `problem` says why the block could not be read, or is ''. An entry it
 * cannot read is skipped, so one bad entry costs only that finding.
 */
export function parseVerifyReply(text) {
	const raw = String(text ?? '');
	const out = { findings: new Map(), linked: new Map(), notes: raw.trim(), problem: '' };
	const block = /```json[ \t]*\n([\s\S]*?)\n```[ \t]*$/m.exec(raw);
	if (!block) {
		out.problem = 'the reply has no ```json block';
		return out;
	}
	out.notes = raw.slice(block.index + block[0].length).trim();
	let data;
	try {
		data = JSON.parse(block[1]);
	} catch (err) {
		out.problem = `its json block does not parse: ${err.message}`;
		return out;
	}
	const issues = value => (Array.isArray(value) ? [...new Set(value.filter(Number.isInteger))] : []);
	// A title or feature lands in the filed issue's title, where `|` breaks the table.
	const words = value => (typeof value === 'string' && value.trim() && !value.includes('|') ? value.trim() : null);
	// A corrected Cause or Observed goes in the issue's body, where `|` is safe.
	const prose = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
	for (const f of Array.isArray(data?.findings) ? data.findings : []) {
		const verified = VERDICTS[String(f?.verdict ?? '').trim().toLowerCase()];
		if (Number.isInteger(f?.n) && verified) {
			const log = Array.isArray(f.log) && f.log.length === 2 && f.log.every(Number.isInteger) && f.log[0] >= 1 && f.log[0] <= f.log[1] ? f.log : null;
			// A bare file name is read as a shot listed without saying what it shows.
			const shots = Array.isArray(f.shots)
				? f.shots.map(x => (typeof x === 'string' ? { file: x } : x)).filter(x => typeof x?.file === 'string').map(x => ({ file: basename(x.file.trim()), shows: typeof x.shows === 'string' ? x.shows.trim() : '' }))
				: null;
			// An entry without what it is is kept, with `what` empty, so it is asked for.
			const setup = Array.isArray(f.setup)
				? f.setup.filter(x => x && typeof x === 'object').map(x => ({ what: typeof x.what === 'string' ? x.what.trim() : '', log: Number.isInteger(x.log) ? x.log : null, alone: x.alone === true, why: typeof x.why === 'string' ? x.why.trim() : '' }))
				: null;
			out.findings.set(f.n, { verified, known: issues(f.known), intended: issues(f.intended), feature: words(f.feature), title: words(f.title), cause: prose(f.cause), observed: prose(f.observed), tests: testsCorrection(f.tests), fix: Array.isArray(f.fix) ? f.fix.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [], log, shots, setup });
		}
	}
	for (const l of Array.isArray(data?.linked) ? data.linked : []) {
		const severity = String(l?.severity ?? '').toLowerCase();
		if (Number.isInteger(l?.issue) && SEVERITIES.includes(severity)) {
			out.linked.set(l.issue, severity);
		}
	}
	return out;
}

/**
 * A reply's corrected `tests`, in the report's shape, or null when it gave none
 * or one that is not that shape. Entries missing a field report.schema.json
 * requires are dropped; empty lists are kept, since a wrong test claim may be removed.
 */
function testsCorrection(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || (!Array.isArray(value.cases) && !Array.isArray(value.related))) {
		return null;
	}
	const text = x => typeof x === 'string' && x.trim();
	const level = x => TEST_LEVELS.includes(x);
	const items = (list, ok) => (Array.isArray(list) ? list.filter(x => x && typeof x === 'object' && ok(x)) : []);
	return {
		cases: items(value.cases, x => text(x.text) && level(x.level) && typeof x.path === 'string' && typeof x.isNew === 'boolean'),
		related: items(value.related, x => text(x.path) && level(x.level) && text(x.note)),
	};
}

const TEST_LEVELS = ['unit', 'extension', 'e2e'];

/** JSON with each object's keys sorted, so two values compare equal whatever order their keys were written in. */
function canonical(value) {
	return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

/** Finding number to the issues the reply matched it with, under `key` (`known` or `intended`). */
export function issueMatches(reply, key) {
	return new Map([...reply.findings].filter(([, f]) => f[key].length).map(([n, f]) => [n, f[key]]));
}

/**
 * True when report.json has at least one finding.
 *
 * A run that found nothing has nothing to verify, and asking anyway produced a
 * page of prose auditing claims nobody disputed.
 */
export function hasFindings(report) {
	return findingNumbers(report).length > 0;
}

/** report.json's finding numbers, in its order. */
export function findingNumbers(report) {
	return (report?.findings ?? []).map(f => f.n);
}

/**
 * Why the reply's verdicts cannot be applied to this report, or '' when they
 * can: one per finding number, no more, no fewer. A verifier that keyed them
 * by position instead of by number gives a number the report lacks or misses
 * one it has whenever the numbers are not exactly 1..n; within 1..n it cannot
 * be told apart here, which is why the prompt says it plainly.
 */
export function verdictMismatch(report, reply) {
	const want = [...new Set(findingNumbers(report))].sort((a, b) => a - b);
	const got = [...reply.findings.keys()].sort((a, b) => a - b);
	const missing = want.filter(n => !got.includes(n));
	const extra = got.filter(n => !want.includes(n));
	if (!missing.length && !extra.length) {
		return '';
	}
	return `the verdicts give findings ${got.join(', ') || 'none'}, but the report's findings are ${want.join(', ')}`
		+ `${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; not in the report: ${extra.join(', ')}` : ''}.`
		+ ' Key each verdict by the finding\'s number, its `n`, not by its position.';
}

/** The actions.log lines the ledger cites in each scenario that failed for finding `n`. */
function citedLogLines(ledger, n) {
	const failing = String(ledger ?? '').split(/\n(?=## )/).filter(s => new RegExp(`^## [SN]\\d+\\b[\\s\\S]*?(?:Status: fail|FAIL)\\W+Finding ${n}\\b`).test(s));
	return [...new Set(failing.flatMap(s => [...s.matchAll(/actions\.log:(\d+)/g)].map(m => Number(m[1]))))].sort((a, b) => a - b);
}

/** The screenshots finding `f`'s failing VERIFY steps cite, by file name. */
function failShots(f) {
	return [...new Set((f.steps ?? []).filter(st => st.kind === 'verify' && st.result === 'fail').flatMap(st => st.shots ?? []).map(p => basename(p)))];
}

/**
 * Each check the reply does not show it made, as `{ n, kind, why }`: a
 * finding with no `log` range, a range past the log's end or one that misses a
 * line its failing scenario cites (`kind` 'log'); and a finding whose `shots`
 * leave out a screenshot its failing VERIFY steps cite, or list one the
 * session never opened ('shots'); and a finding with no `setup` list, or
 * confirmed with a setup that alone would show it and no `why` ('setup').
 * `opened` is the files the verifier's session
 * read, when its runner records them; without it only the reply's own word is
 * checked. Without an action log there is nothing to check the steps against.
 */
export function checkGaps(report, reply, { ledger, actionsLog, opened = null }) {
	// A shot the notes say was not opened was not checked, whatever the list says.
	const unopened = new Set([...String(reply.notes ?? '').matchAll(/\b(?:did not|didn't|could not|couldn't) (?:open|view|look at|check|read)\s+`?([\w.-]+\.(?:png|jpe?g))/gi)].map(m => m[1]));
	// A shot is seen only by reading it: its "shows" can be copied from the ledger.
	const seen = opened ? new Set([...opened].map(p => basename(String(p)))) : null;
	const lines = String(actionsLog ?? '').split('\n').filter(Boolean).length;
	return (report?.findings ?? []).flatMap(f => {
		const { n } = f;
		const got = reply.findings.get(n);
		const gaps = [];
		const range = got?.log;
		if (lines && !range) {
			gaps.push({ n, kind: 'log', why: 'gave no actions.log lines' });
		} else if (lines && range[1] > lines) {
			gaps.push({ n, kind: 'log', why: `gave actions.log lines ${range[0]}-${range[1]}, but the log has ${lines}` });
		} else if (lines) {
			const missed = citedLogLines(ledger, n).filter(line => line < range[0] || line > range[1]);
			if (missed.length) {
				gaps.push({ n, kind: 'log', why: `gave actions.log lines ${range[0]}-${range[1]}, which miss line${missed.length > 1 ? 's' : ''} ${missed.join(', ')} that its failing scenario cites` });
			}
		}
		const listed = new Map((got?.shots ?? []).map(x => [x.file, x.shows]));
		const cited = failShots(f);
		const missing = [
			[cited.filter(shot => !listed.has(shot)), 'did not list'],
			[cited.filter(shot => listed.has(shot) && !listed.get(shot)), 'listed without saying what it shows'],
			[cited.filter(shot => listed.get(shot) && unopened.has(shot)), 'listed but says it did not open'],
			[seen ? [...listed.keys()].filter(shot => listed.get(shot) && !unopened.has(shot) && !seen.has(shot)) : [], 'listed but never opened'],
		].filter(([shots]) => shots.length);
		for (const [shots, what] of missing) {
			gaps.push({ n, kind: 'shots', why: what === 'listed but never opened' ? `${what} ${shots.join(', ')}` : `${what} ${shots.join(', ')}, which its failing VERIFY steps cite` });
		}
		if (got && !got.setup) {
			gaps.push({ n, kind: 'setup', why: 'gave no setup list' });
		} else if (got?.setup.some(x => !x.what)) {
			gaps.push({ n, kind: 'setup', why: 'listed a setup without saying what it is' });
		} else if (got?.verified === 'confirmed') {
			const unsettled = got.setup.filter(x => x.alone && !x.why).map(x => x.what);
			if (unsettled.length) {
				gaps.push({ n, kind: 'setup', why: `is confirmed with a setup that alone would show it, ${unsettled.join('; ')}, and does not say what settles it` });
			}
		}
		return gaps;
	});
}

/** The message that asks the verifier for the checks it did not show it made. */
export function checkMessage(gaps) {
	const asks = {
		log: 'For a log gap, read the lines of actions.log its failing scenario covers and check its steps and VERIFY lines against them, giving that range as `log`.',
		shots: 'For a screenshot gap, open each screenshot its failing VERIFY steps cite with the Read tool and check its Observed against it, listing each in `shots` with what it shows. List only screenshots you opened.',
		setup: 'For a setup gap, list each setup the run made, as question 2 asks, in `setup`, reading the code each one reaches, and settle any that alone would show the finding or mark it unresolved.',
	};
	const kinds = Object.keys(asks).filter(kind => gaps.some(g => g.kind === kind));
	return `Your reply ${gaps.map(g => `for Finding ${g.n} ${g.why}`).join('; ')}. ${kinds.map(kind => asks[kind]).join(' ')} Reply again in full, in the same format.`;
}

/**
 * The linked issues the ledger says the run ran into, which the verifier
 * rates. Empty without a list or a ledger.
 */
export function observedLinked(knownIssues, ledger) {
	const coverage = knownIssues?.issues?.length && parseLedger(ledger);
	return coverage ? knownIssueOutcomes(knownIssues, coverage).observed.map(o => o.issue.number) : [];
}

/**
 * Run-log lines about the linked issues after verify: each observed one the
 * reply gave no severity, and each known match on a fix or a closed issue.
 * `reply` is parseVerifyReply's.
 */
export function verifyLogLines(knownIssues, ledger, reply) {
	const coverage = knownIssues?.issues?.length && parseLedger(ledger);
	if (!coverage) {
		return [];
	}
	const ki = knownIssueOutcomes(knownIssues, coverage, reply.linked, issueMatches(reply, 'known'));
	return [...ki.unrated.map(n => `Couldn't rate #${n}: verifier line missing or malformed`), ...knownFixLines(ki)];
}

/** Reads a run directory's known-issues.json, or null when there is none or it does not parse. */
export function readKnownIssues(dir) {
	return readJson(join(dir, 'known-issues.json'));
}

const PREAMBLE = 'A second agent re-read this report with the repository but without driving the app. Advisory only: no finding was removed. A title, feature, cause, observed or test list it corrected replaces the explorer\'s, and a corrected cause or observed is marked on its finding.';

/** The finding fields a verifier reply can rewrite. */
const CORRECTABLE = ['title', 'feature', 'cause', 'observed', 'tests'];

/**
 * report.json with the verifier's verdicts on its findings, and its notes as
 * `verification`, which the page shows collapsed. `reply` is
 * parseVerifyReply's. A failed pass shows `text` open, because "these
 * findings are unreviewed" is not a detail to hide behind a click, and
 * changes no finding.
 */
export function applyVerification(json, reply, { failed = false, text = '', gaps = [], mainBuild = null, repoRoot = '', baseSha = '', headSha = '' } = {}) {
	if (failed) {
		// Nothing was checked, so no finding is grouped by its replay; each says why.
		const originReason = Object.fromEntries((json.findings ?? []).map(f => [f.n, { reason: 'not verified', detail: '' }]));
		return { ...json, verification: { failed, text, ...(Object.keys(originReason).length ? { originReason } : {}) } };
	}
	const findings = (json.findings ?? []).map(f => {
		const v = reply.findings.get(f.n);
		if (!v) {
			return f;
		}
		// A field the verifier rewrote replaces the explorer's, which is kept
		// under `explorer` so the page can say what changed.
		const corrections = Object.fromEntries(CORRECTABLE.filter(key => v[key] && canonical(v[key]) !== canonical(f[key])).map(key => [key, v[key]]));
		const corrected = Object.keys(corrections);
		return {
			...f,
			verified: v.verified,
			...(v.known.length ? { known: v.known } : {}),
			...(v.intended.length ? { intended: v.intended } : {}),
			...corrections,
			...(corrected.length ? { corrected, explorer: Object.fromEntries(corrected.map(key => [key, f[key] ?? null])) } : {}),
		};
	});
	// Each confirmed finding's Origin from its replay on main, or why it has none.
	const origin = {};
	const originReason = {};
	for (const f of json.findings ?? []) {
		const v = reply.findings.get(f.n);
		if (v?.verified !== 'confirmed') {
			continue;
		}
		// A record lint rejects (a failing check left out, two kinds of result) cannot be read as counts.
		if (mainBuild && f.main && mainProblems(f.n, f.main, f.steps ?? [], { mainBuild }).length) {
			originReason[f.n] = { reason: 'could not run', detail: 'its replay record is incomplete' };
			continue;
		}
		// The explorer's word that main lacks an ID is checked: the head must have it, and main must not.
		const unconfirmed = mainBuild && f.main?.missing?.length ? unconfirmedMissing(repoRoot, mainBuild.commit, headSha, f.main.missing) : [];
		if (unconfirmed.length) {
			originReason[f.n] = { reason: 'could not run', detail: `what it says main lacks could not be confirmed: ${unconfirmed.join(', ')}` };
			continue;
		}
		const drift = mainBuild ? fixDrift(repoRoot, mainBuild.commit, baseSha, v.fix, headSha) : 'none';
		const o = originFromMain({ main: f.main, reproduced: f.reproduced, drift, hasMainBuild: Boolean(mainBuild) });
		if (o.origin) {
			origin[f.n] = o.origin;
		} else {
			originReason[f.n] = { reason: o.reason, detail: o.detail };
		}
	}
	const unchecked = Object.fromEntries(['log', 'shots', 'setup'].map(kind => [kind, [...new Set(gaps.filter(g => g.kind === kind).map(g => g.n))]]).filter(([, ns]) => ns.length));
	const named = ns => ns.map(n => `Finding ${n}`).join(', ');
	const skipped = [
		unchecked.log ? `the steps of ${named(unchecked.log)} against the action log` : '',
		unchecked.shots ? `the Observed of ${named(unchecked.shots)} against its screenshots` : '',
		unchecked.setup ? `${named(unchecked.setup)} against the run's setup` : '',
	].filter(Boolean).join(', or ');
	const linked = [...reply.linked].map(([issue, severity]) => ({ issue, severity }));
	return {
		...json,
		findings,
		verification: {
			failed,
			// A skipped check is said, so "No process issues" is not read as one that passed.
			// Its own all-clear would contradict what the pipeline found missing.
			text: [PREAMBLE, skipped ? reply.notes.replace(/\n*No process issues\.?\s*$/, '') : reply.notes, skipped ? `_The verifier did not show it checked ${skipped}._` : ''].filter(Boolean).join('\n\n'),
			...(Object.keys(origin).length ? { origin } : {}),
			...(Object.keys(originReason).length ? { originReason } : {}),
			...(linked.length ? { linked } : {}),
			...(skipped ? { unchecked } : {}),
		},
	};
}

/**
 * Whether the files of a finding's fix differ between the main build and the
 * base, so main's behavior there may not be the base's: 'drift' when they do,
 * or when git cannot tell (a commit the checkout does not have); 'unchecked'
 * when there is nothing to compare (no files, or none in either commit);
 * 'none' when they are the same, or main is the base.
 */
export function fixDrift(repoRoot, mainCommit, baseSha, files, headSha = '') {
	if (!repoRoot || !mainCommit || !baseSha) {
		return 'unchecked';
	}
	const git = args => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	const ok = args => {
		try {
			git(args);
			return true;
		} catch {
			return false;
		}
	};
	if (!ok(['cat-file', '-e', `${mainCommit}^{commit}`]) || !ok(['cat-file', '-e', `${baseSha}^{commit}`])) {
		return 'drift';
	}
	if (mainCommit === baseSha) {
		return 'none';
	}
	// A path in neither commit matches nothing, and would pass for "no change",
	// unless the change adds it: new code cannot have changed on main.
	const has = (commit, f) => Boolean(commit) && ok(['cat-file', '-e', `${commit}:${f}`]);
	if (!files?.length || files.some(f => !has(mainCommit, f) && !has(baseSha, f) && !has(headSha, f))) {
		return 'unchecked';
	}
	try {
		return git(['diff', '--name-only', mainCommit, baseSha, '--', ...files]).trim() ? 'drift' : 'none';
	} catch {
		return 'drift';
	}
}

/**
 * The IDs a finding says main lacks that git does not bear out: each must be
 * in the head (else it is not a real ID) and not in main. All of them when
 * the checkout or a commit is not there to ask.
 */
export function unconfirmedMissing(repoRoot, mainCommit, headSha, ids) {
	if (!repoRoot || !mainCommit || !headSha) {
		return [...ids];
	}
	// 0: found; 1: not found; anything else: git could not tell.
	const found = (commit, id) => {
		try {
			execFileSync('git', ['-C', repoRoot, 'grep', '-q', '-F', '-e', id, commit, '--', 'src', 'extensions'], { stdio: 'ignore' });
			return true;
		} catch (err) {
			return err.status === 1 ? false : null;
		}
	};
	return ids.filter(id => !(found(headSha, id) === true && found(mainCommit, id) === false));
}

/** True once report.json carries a verification, so it is never added twice. */
export function isVerified(report) {
	return Boolean(report?.verification);
}

const VERIFIER_PATH = fileURLToPath(new URL('../../verifier.md', import.meta.url));

/** The run's report.json. */
export function reportPath(dir) {
	return join(dir, 'report.json');
}

/** report.json at `path`, parsed. */
export function readReport(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/** Writes report.json to `path`. */
export function writeReport(path, report) {
	writeFileSync(path, `${JSON.stringify(report, null, '\t')}\n`);
}

/** A run directory's report, ledger and known issues, as the verify steps read them. */
function readRun(dir) {
	const ledgerPath = join(dir, 'ledger.md');
	const knownIssues = readKnownIssues(dir);
	const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '';
	const path = reportPath(dir);
	const actionsLog = existsSync(join(dir, 'actions.log')) ? readFileSync(join(dir, 'actions.log'), 'utf8') : '';
	return { path, report: readReport(path), ledger, actionsLog, knownIssues, observed: observedLinked(knownIssues, ledger) };
}

/**
 * Writes <run dir>/change-base.json, and <run dir>/verify-prompt.md and returns
 * its path, or null when there is nothing to verify. Linked issues the run ran
 * into still need a severity. `baseName` is the base branch, for the Origin column.
 */
export function writeVerifyPrompt(dir, { repo, base, head, baseName }) {
	const changed = changeBase(repo, base, head, baseName);
	writeChangeBase(dir, changed);
	const { path, report, observed } = readRun(dir);
	if (!hasFindings(report) && !observed.length) {
		return null;
	}
	const out = join(dir, 'verify-prompt.md');
	writeFileSync(out, buildVerifyPrompt(readFileSync(VERIFIER_PATH, 'utf8'), {
		workDir: dir, repoRoot: repo, baseSha: base, headSha: head, reportFile: path,
		// Set by a local pipeline run, as for the explorer's own check; CI drives its own session.
		session: process.env.PW_SESSION || undefined,
	}));
	return out;
}

/**
 * Adds a verifier reply to the run's report. Returns `{ retry }`, writing
 * nothing, when the reply can be fixed by asking once more: its verdicts keyed
 * to other numbers than the report's, or a check it does not show it made (a
 * finding's steps against the action log, its Observed against its
 * screenshots, which `opened`, the files its session read, shows it opened).
 * `retry` is the message to send. With `final` nothing is asked:
 * wrong numbers mark the findings unreviewed, and a missing check is named in
 * the report. An `error`, or an empty reply or one with no verdicts, says the
 * verification did not complete rather than leaving the findings looking
 * reviewed. Otherwise returns `{ failed, logLines }`.
 */
export function applyVerifyReply(dir, reply, { error = '', final = false, opened = null, repo = '', base = '', head = '' } = {}) {
	const { path, report, ledger, actionsLog, knownIssues } = readRun(dir);
	if (isVerified(report)) {
		return { already: true };
	}
	reply = String(reply ?? '').trim();
	const parsed = parseVerifyReply(reply);
	const findings = hasFindings(report);
	const mismatch = !error && findings && parsed.findings.size ? verdictMismatch(report, parsed) : '';
	if (mismatch && !final) {
		return { retry: `${mismatch} Reply again in full, in the same format.` };
	}
	const failed = Boolean(error || mismatch) || !reply || Boolean(parsed.problem) || (findings && !parsed.findings.size);
	const gaps = failed ? [] : checkGaps(report, parsed, { ledger, actionsLog, opened });
	if (gaps.length && !final) {
		return { retry: checkMessage(gaps) };
	}
	const unreviewed = findings ? 'The findings above are unreviewed.' : 'The known issues above are unrated.';
	const why = error ? `: ${error}` : mismatch ? `: ${mismatch}` : !reply ? '' : parsed.problem ? `: ${parsed.problem}` : ': the reply gave no verdicts';
	const text = `_Verification did not complete${why}. ${unreviewed}_${reply ? `\n\n${reply}` : ''}`;
	const mainBuild = readJson(join(dir, 'main-build.json'));
	writeReport(path, applyVerification(report, parsed, { failed, text, gaps, mainBuild, repoRoot: repo, baseSha: base, headSha: head }));
	return { failed, logLines: verifyLogLines(knownIssues, ledger, failed ? parseVerifyReply('') : parsed) };
}
