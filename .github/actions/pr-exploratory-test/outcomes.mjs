/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Decides what happened to each confirmed finding on PRs with an exploratory
// result comment, and prints a table to read by hand. Run locally from a
// checkout with origin fetched; the model check uses your own `claude` login.
//   node outcomes.mjs [--pr N] [--since YYYY-MM-DD] [--out rows.jsonl]

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runClaude } from '../../../.claude/skills/exploratory-test/renderer/agents/claude-cli.mjs';
import { searchIssues } from '../../../.claude/skills/exploratory-test/renderer/known-issues.mjs';
import { buildCheckPrompt, decideOutcome, extractPaths, guarded, markDuplicates, parseCheck, parsePageFindings, parseResultComment, prOwnCommits, renderTable, resolveTestedSha, searchTerms } from './outcomes-lib.mjs';

const REPO = 'posit-dev/positron';
const API = 'https://api.github.com';
// A diff past this is cut; the model sees enough to judge and the call stays cheap.
const MAX_DIFF_CHARS = 20000;
const { values: args } = parseArgs({ options: { pr: { type: 'string' }, since: { type: 'string', default: '2026-09-15' }, out: { type: 'string' } } });
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

async function fetchJson(url) {
	const res = await fetch(url);
	return res.ok ? res.json() : null;
}

/** The run's report.json; runs before 2026-10-13 published only the page, so read the findings from it. */
async function fetchReport(base) {
	const report = await fetchJson(`${base}/report.json`);
	if (report) {
		return report;
	}
	const res = await fetch(`${base}/index.html`);
	return res.ok ? { findings: parsePageFindings(await res.text()), fromPage: true } : null;
}

async function prNumbers() {
	if (args.pr) {
		return [Number(args.pr)];
	}
	const q = encodeURIComponent(`repo:${REPO} is:pr "View report" "Exploratory testing" in:comments created:>=${args.since}`);
	return (await gh(`/search/issues?q=${q}&per_page=100`)).items.map(i => i.number);
}

async function check(finding, kind, text, source) {
	try {
		const { text: reply } = await runClaude({ prompt: buildCheckPrompt({ finding, kind, text }), model: 'haiku', tools: [], cwd: ROOT, feed: () => { } });
		return { ...parseCheck(reply), source };
	} catch (err) {
		return { answer: 'unclear', reason: `model failed: ${String(err).slice(0, 200)}`, source };
	}
}

/** The diff of `paths` between two commits, or '' when they did not change. */
function pathDiff(from, to, paths) {
	return git('diff', '--no-color', `${from}..${to}`, '--', ...paths).slice(0, MAX_DIFF_CHARS);
}

/** The PR's own changes to `paths` in `shas`, leaving out main merged into the branch. */
function ownDiff(shas, paths) {
	const parts = shas.map(sha => ({ sha, diff: git('show', '--no-color', '--format=', sha, '--', ...paths) })).filter(p => p.diff);
	return { diff: parts.map(p => p.diff).join('\n').slice(0, MAX_DIFF_CHARS), commits: parts.map(p => p.sha.slice(0, 10)) };
}

async function laterChecks(finding, paths, pr, postedAt) {
	const main = paths.length && pr.merged_at ? await guarded('main diff', async () => {
		const diff = pathDiff(pr.merge_commit_sha, 'origin/main', paths);
		if (!diff) {
			return [];
		}
		const commits = git('log', '--format=%h', `${pr.merge_commit_sha}..origin/main`, '--', ...paths).split('\n').filter(Boolean);
		return [await check(finding, 'diff', diff, `main ${commits.join(',')}`)];
	}) : [];
	const issues = await guarded('issue search', async () => {
		const terms = searchTerms(finding.title);
		const found = terms ? (await searchIssues(terms, REPO)).filter(i => !i.pull_request && i.created_at > postedAt) : [];
		const checks = [];
		for (const issue of found) {
			checks.push(await check(finding, 'issue', `#${issue.number}: ${issue.title}\n\n${String(issue.body ?? '').slice(0, 4000)}`, `issue #${issue.number}`));
		}
		return checks;
	});
	return [...main, ...issues];
}

async function prRows(number) {
	const pr = await gh(`/repos/${REPO}/pulls/${number}`);
	const prState = pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
	git('fetch', '-q', 'origin', `refs/pull/${number}/head`, 'main');
	const prCommits = await gh(`/repos/${REPO}/pulls/${number}/commits?per_page=100`);
	const comments = (await gh(`/repos/${REPO}/issues/${number}/comments?per_page=100`)).filter(c => c.user?.login === 'github-actions[bot]');
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
			const paths = extractPaths(finding);
			let prCheck = null;
			if (tested.sha && paths.length && prState !== 'open') {
				const own = prOwnCommits(prCommits, tested.sha);
				let diff = '';
				let commits = [];
				try {
					({ diff, commits } = own ? ownDiff(own, paths) : { diff: '', commits: [] });
				} catch (err) {
					prCheck = { answer: 'unclear', reason: `pr diff failed: ${String(err).slice(0, 200)}`, source: 'pr' };
				}
				if (!own) {
					prCheck = { answer: 'unclear', reason: 'tested commit is not among the PR\'s commits (force-pushed?)', source: 'pr' };
				} else if (diff) {
					prCheck = await check(finding, 'diff', diff, `pr ${commits.join(',')}`);
				}
			}
			const later = prState === 'open' ? [] : await laterChecks(finding, paths, pr, comment.created_at);
			const decided = tested.sha
				? decideOutcome({ prState, mergedAt: pr.merged_at, now: new Date(), hasPaths: paths.length > 0, prCheck, laterChecks: later })
				: { outcome: 'pending', decidedBy: 'sha', evidence: tested.reason };
			rows.push({
				pr: number, run: parsed.run, testedSha: tested.sha, reportUrl: `${parsed.reportBase}/index.html`,
				skillVersion: stats?.version ?? null, model: stats?.model ?? null,
				finding: finding.n, title: finding.title, severity: finding.severity, feature: finding.feature, verified: finding.verified,
				related: report.fromPage ? null : related.has(finding.n), paths, ...decided, decidedAt: new Date().toISOString().slice(0, 10),
			});
			console.error(`[outcomes] #${number} ${parsed.run}#${finding.n}: ${decided.outcome}`);
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
