/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Decides what happened to each confirmed finding on PRs with an exploratory
// result comment, and prints a table to read by hand. Run locally from a
// checkout with origin fetched; the model check uses your own `claude` login,
// or with --api the Anthropic API and ANTHROPIC_API_KEY (CI). --previous takes
// an earlier --out and keeps its settled rows instead of checking them again;
// --recheck checks them all again anyway, as after a change to the checks.
//   node outcomes.mjs [--pr N] [--since YYYY-MM-DD] [--model opus] [--api] [--previous rows.jsonl] [--recheck] [--out rows.jsonl]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runClaude, WRAP_UP_MINUTES } from '../../../.claude/skills/exploratory-test/renderer/agents/claude-cli.mjs';
import { searchIssues } from '../../../.claude/skills/exploratory-test/renderer/known-issues.mjs';
import { buildCheckPrompt, candidateIssues, capDiff, decideOutcome, diffEvidence, droppedPaths, extractPaths, isCut, fetchReport, guarded, issueOf, markDuplicates, parseCheck, parseResultComment, pickPrCheck, prOwnChanges, prOwnMessages, prPreview, renderTable, resolveTestedSha, savedPrChecks, searchTerms, settledRows } from './outcomes-lib.mjs';

const REPO = 'posit-dev/positron';
const API = 'https://api.github.com';
// A diff past this is cut. Main's diff of a busy file since the merge can run past 30000, and a cut there leaves unclear.
const MAX_DIFF_CHARS = 60000;
// The whole PR's change, less lockfiles.
const WHOLE = ['.', ':(exclude)**/package-lock.json'];
// PRs opened only to try the harness, whose findings no one meant to act on.
const SKIPPED_PRS = new Set([16616]);
const { values: args } = parseArgs({ options: { pr: { type: 'string' }, since: { type: 'string', default: '2026-09-15' }, model: { type: 'string', default: 'opus' }, api: { type: 'boolean', default: false }, previous: { type: 'string' }, recheck: { type: 'boolean', default: false }, out: { type: 'string' } } });
const PREVIOUS = args.previous && !args.recheck ? readFileSync(args.previous, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const SETTLED = settledRows(PREVIOUS);
const SAVED_PR_CHECKS = savedPrChecks(PREVIOUS);
const TOKEN = process.env.GH_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

async function gh(path) {
	let url = `${API}${path}`;
	let all = null;
	while (url) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } });
		if (!res.ok) {
			throw new Error(`GitHub GET ${path} failed: ${res.status}`);
		}
		const data = await res.json();
		if (!Array.isArray(data)) {
			return data;
		}
		all = [...(all ?? []), ...data];
		url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
	}
	return all;
}

const git = (...a) => execFileSync('git', ['-C', ROOT, '--no-pager', ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// For a cause that names a file without its folder.
const FILES = git('ls-files').split('\n').filter(Boolean);

async function fetchJson(url) {
	const res = await fetch(url);
	return res.ok ? res.json() : null;
}

async function prNumbers() {
	if (args.pr) {
		return [Number(args.pr)];
	}
	const q = encodeURIComponent(`repo:${REPO} is:pr "View report" "Exploratory testing" in:comments created:>=${args.since}`);
	return (await gh(`/search/issues?q=${q}&per_page=100`)).items.map(i => i.number).filter(n => !SKIPPED_PRS.has(n));
}

let anthropic = null;

/** The model's reply to `prompt`: through the API with --api, else `claude -p`. Either is stopped after WRAP_UP_MINUTES, which leaves no reply. */
async function ask(prompt) {
	if (args.api) {
		const { default: Anthropic } = await import('@anthropic-ai/sdk');
		anthropic ??= new Anthropic({ timeout: WRAP_UP_MINUTES * 60000 });
		const response = await anthropic.messages.create({ model: args.model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
		return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
	}
	// A zero limit with no tools: nothing to warn, so it is stopped once the wrap-up minutes pass.
	return (await runClaude({ prompt, model: args.model, tools: [], cwd: ROOT, timeLimitMinutes: 0, feed: () => { } })).text;
}

async function check(finding, evidence, source) {
	try {
		return { ...parseCheck(await ask(buildCheckPrompt({ finding, ...evidence }))), source, ...(isCut(evidence) ? { cut: true } : {}) };
	} catch (err) {
		return { answer: 'unclear', reason: `model failed: ${String(err).slice(0, 200)}`, source };
	}
}

/** The diff of `paths` between two commits, uncut, or '' when they did not change. */
function pathDiff(from, to, paths) {
	return git('diff', '--no-color', `${from}..${to}`, '--', ...paths);
}

/** The PR's own changes to `paths`: one range, or commit by commit to leave out main merged into the branch. */
function ownDiff(own, paths) {
	if (own.range) {
		const [from, to] = own.range;
		const commits = git('log', '--format=%h', `${from}..${to}`, '--', ...paths).split('\n').filter(Boolean);
		return { diff: pathDiff(from, to, paths), commits };
	}
	const parts = own.shas.map(sha => ({ sha, diff: git('show', '--no-color', '--format=', sha, '--', ...paths) })).filter(p => p.diff);
	return { diff: parts.map(p => p.diff).join('\n'), commits: parts.map(p => p.sha.slice(0, 10)) };
}

/** A force-pushed PR: its own change as tested against its own change as merged, each measured from its base on main. */
async function rebasedCheck(finding, paths, pr, prCommits, testedSha) {
	let named = null;
	try {
		git('fetch', '-q', 'origin', testedSha, pr.head.sha, pr.base.sha);
		const messages = prCommits.map(c => `${c.sha.slice(0, 10)} ${(c.commit?.message ?? '').trim()}`).join('\n\n');
		const own = (sha, p, max) => capDiff(git('diff', '--no-color', `${git('merge-base', sha, pr.base.sha).trim()}..${sha}`, '--', ...p), max);
		const versions = (p, max) => ({ before: own(testedSha, p, max), text: own(pr.head.sha, p, max) });
		if (paths.length) {
			const v = versions(paths, MAX_DIFF_CHARS / 2);
			named = v.before !== v.text ? await check(finding, { kind: 'diff', messages, ...v }, 'pr (rebased)') : null;
			if (named?.answer === 'yes') {
				return named;
			}
		}
		const v = versions(WHOLE, MAX_DIFF_CHARS / 2);
		return pickPrCheck(named, v.before !== v.text ? await check(finding, { kind: 'diff', messages, whole: true, ...v }, 'pr (rebased, whole)') : null);
	} catch (err) {
		return named ?? { answer: 'unclear', reason: `tested commit is not among the PR's commits and could not be compared: ${String(err).slice(0, 200)}`, source: 'pr' };
	}
}

/** Whether the PR fixed the finding: its own changes to the finding's files, then, unless that said yes, its whole change. */
async function prCheck(finding, paths, pr, prCommits, testedSha) {
	const own = prOwnChanges(prCommits, testedSha);
	if (!own) {
		return rebasedCheck(finding, paths, pr, prCommits, testedSha);
	}
	const messages = prOwnMessages(prCommits, testedSha);
	let named = null;
	try {
		const { diff, commits } = paths.length ? ownDiff(own, paths) : { diff: '' };
		named = diff ? await check(finding, { ...diffEvidence(diff, paths, MAX_DIFF_CHARS), messages }, `pr ${commits.join(',')}`) : null;
		if (named?.answer === 'yes') {
			return named;
		}
		const whole = ownDiff(own, WHOLE);
		return pickPrCheck(named, whole.diff ? await check(finding, { kind: 'diff', text: capDiff(whole.diff, MAX_DIFF_CHARS), messages, whole: true }, `pr (whole) ${whole.commits.join(',')}`) : null);
	} catch (err) {
		return named ?? { answer: 'unclear', reason: `pr diff failed: ${String(err).slice(0, 200)}`, source: 'pr' };
	}
}

/** The files the tested commit's own change touched, from where it left main; none when that can't be read. */
function testedFiles(testedSha, pr) {
	try {
		git('fetch', '-q', 'origin', testedSha, pr.base.sha);
		const base = git('merge-base', testedSha, pr.base.sha).trim();
		return git('diff', '--name-only', `${base}..${testedSha}`).split('\n').filter(Boolean);
	} catch (err) {
		console.error(`[outcomes] #${pr.number} tested change ${testedSha.slice(0, 10)} not read, so a dropped change is not detected: ${err}`);
		return [];
	}
}

async function laterChecks(finding, paths, pr, postedAt, timeline) {
	const main = paths.length && (pr.merged_at || pr.closed_at) ? await guarded('main diff', async () => {
		// A closed PR never reached main, so look from where main stood when it closed.
		const base = pr.merged_at ? pr.merge_commit_sha : git('rev-list', '-1', '--first-parent', `--before=${pr.closed_at}`, 'origin/main').trim();
		const diff = base ? pathDiff(base, 'origin/main', paths) : '';
		if (!diff) {
			return [];
		}
		const commits = git('log', '--format=%h', `${base}..origin/main`, '--', ...paths).split('\n').filter(Boolean);
		return [await check(finding, diffEvidence(diff, paths, MAX_DIFF_CHARS), `main ${commits.join(',')}`)];
	}) : [];
	const issues = await guarded('issue search', async () => {
		const terms = searchTerms(finding.title);
		const found = terms ? await searchIssues(terms, REPO) : [];
		const checks = [];
		for (const issue of candidateIssues({ found, timeline, postedAt, repo: REPO })) {
			const c = await check(finding, { kind: 'issue', text: `#${issue.number}: ${issue.title}\n\n${String(issue.body ?? '').slice(0, 4000)}` }, `issue #${issue.number}`);
			checks.push({ ...c, issue: { ...issueOf(issue), mentionsPr: issue.mentionsPr } });
		}
		return checks;
	});
	return [...main, ...issues];
}

/** The issues the run matched as not planned that still are, read now: one reopened since is no longer won't fix. */
async function notPlanned(numbers) {
	const issues = [];
	for (const n of numbers) {
		const issue = await gh(`/repos/${REPO}/issues/${n}`).catch(err => {
			console.error(`[outcomes] issue #${n} not read, so not counted as won't fix: ${err}`);
			return null;
		});
		if (issue?.state === 'closed' && issue.state_reason === 'not_planned') {
			issues.push(issueOf(issue));
		}
	}
	return issues;
}

async function prRows(number) {
	const pr = await gh(`/repos/${REPO}/pulls/${number}`);
	const prState = pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
	const preview = prPreview(pr);
	git('fetch', '-q', 'origin', `refs/pull/${number}/head`, 'main');
	const prCommits = await gh(`/repos/${REPO}/pulls/${number}/commits?per_page=100`);
	const comments = (await gh(`/repos/${REPO}/issues/${number}/comments?per_page=100`)).filter(c => c.user?.login === 'github-actions[bot]');
	// A failed timeline leaves the title search, rather than skipping the PR.
	const timeline = prState === 'open' ? [] : await gh(`/repos/${REPO}/issues/${number}/timeline?per_page=100`).catch(err => {
		console.error(`[outcomes] #${number} timeline failed, issues that mention the PR not checked: ${err}`);
		return [];
	});
	// For a change dropped before the merge.
	const mergedFiles = prState === 'merged' ? (await gh(`/repos/${REPO}/pulls/${number}/files?per_page=100`)).map(f => f.filename) : [];
	const rows = [];
	for (const comment of comments) {
		const parsed = parseResultComment(comment.body);
		if (!parsed) {
			continue;
		}
		const report = await fetchReport(parsed.reportBase);
		if (!report) {
			console.error(`[outcomes] #${number} run ${parsed.run}: no report, skipped`);
			continue;
		}
		const stats = await fetchJson(`${parsed.reportBase}/stats.json`);
		const tested = await resolveTestedSha({ headSha: report.header?.headSha, shortSha: parsed.shortSha, lookup: async s => (await gh(`/repos/${REPO}/commits/${s}`)).sha });
		const related = new Set(report.verification?.related ?? []);
		for (const finding of (report.findings ?? []).filter(f => f.verified === 'confirmed')) {
			// A fix in a PR that later closed never shipped, so it's decided again.
			const kept = SETTLED.get(`${parsed.run}#${finding.n}`);
			if (kept && !(prState === 'closed' && kept.outcome === 'fixed-in-pr')) {
				rows.push({ ...kept, prPreview: preview });
				console.error(`[outcomes] #${number} ${parsed.run}#${finding.n}: ${kept.outcome} (kept from --previous)`);
				continue;
			}
			const paths = extractPaths(finding, FILES);
			// Only the PR's own answer is reused; the checks for a later fix on main or an issue run every time.
			const saved = prState === 'merged' ? SAVED_PR_CHECKS.get(`${parsed.run}#${finding.n}`) : undefined;
			const inPr = saved ?? (tested.sha && prState !== 'open' ? await prCheck(finding, paths, pr, prCommits, tested.sha) : null);
			const later = prState === 'open' ? [] : await laterChecks(finding, paths, pr, comment.created_at, timeline);
			const dropped = prState === 'merged' && tested.sha ? droppedPaths({ paths, tested: testedFiles(tested.sha, pr), merged: mergedFiles }) : [];
			const intended = await notPlanned(finding.intended ?? []);
			// A closed PR didn't ship whatever was tested, so it needs no tested commit.
			const decided = tested.sha || prState === 'closed'
				? decideOutcome({ prState, hasPaths: paths.length > 0, prCheck: inPr, laterChecks: later, dropped, intended })
				: { outcome: 'pending', decidedBy: 'sha', evidence: tested.reason };
			rows.push({
				pr: number, run: parsed.run, trigger: parsed.trigger, postedAt: comment.created_at, testedSha: tested.sha, reportUrl: `${parsed.reportBase}/index.html`,
				skillVersion: stats?.version ?? null, model: stats?.model ?? null,
				finding: finding.n, title: finding.title, severity: finding.severity, feature: finding.feature, verified: finding.verified,
				related: report.fromPage ? null : related.has(finding.n), paths, ...decided, prCheck: prState === 'merged' ? inPr : null, decidedAt: new Date().toISOString().slice(0, 10), prPreview: preview,
			});
			console.error(`[outcomes] #${number} ${parsed.run}#${finding.n}: ${decided.outcome}${saved ? ' (PR check kept from --previous)' : ''}`);
		}
	}
	return rows;
}

const rows = [];
for (const number of await prNumbers()) {
	try {
		rows.push(...await prRows(number));
	} catch (err) {
		console.error(`[outcomes] #${number} failed, skipped: ${err}`);
	}
}
const marked = markDuplicates(rows);
if (args.out) {
	writeFileSync(args.out, marked.map(r => JSON.stringify(r)).join('\n') + '\n');
}
console.log(renderTable(marked));
