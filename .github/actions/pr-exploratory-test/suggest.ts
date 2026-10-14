/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Suggests `/explore` once on a PR that looks worth it. One step per job in
// test-exploratory-suggest.yml, so each runs with only the access it needs:
//   precheck  free checks, and the author's team membership (org App token)
//   judge     one model call with no tools; fails closed, i.e. silent
//   post      re-checks the thread and posts the suggestion, or for an author
//             on the auto-run list (#16610), starts test-exploratory.yml
//             instead. That run posts to the PR only if its gate passes it.
// DRY_RUN=true runs every step's logic but posts nothing, and judges a PR the
// precheck would skip, so verdicts can be read on any PR.

import { appendFileSync } from 'node:fs';
import { postOrEditComment } from './comment.mjs';
import { autoRunName, buildSuggestPrompt, findPriorUse, isAutoRunAuthor, parseVerdict, renderSuggestComment, skipReason } from './suggest-lib.ts';

const API = 'https://api.github.com';
const REPO = mustEnv('GITHUB_REPOSITORY');
const PR_NUMBER = mustEnv('PR_NUMBER');
const DRY_RUN = process.env.DRY_RUN === 'true';
const RUN_WORKFLOW = 'test-exploratory.yml';
// The cheapest tier that makes the call well; SUGGEST_MODEL overrides it to compare.
const MODEL = process.env.SUGGEST_MODEL || 'claude-sonnet-5-5';

function mustEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return v;
}

function output(values) {
	const text = Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\s+/g, ' ')}\n`).join('');
	console.log(`[suggest] ${text.trim().replace(/\n/g, ' ')}`);
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, text);
	}
}

function summary(line) {
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
	}
}

/** GET a REST path, following Link rel="next" when the result is a list. */
async function ghGet(token, path) {
	let url = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
	let all = null;
	while (url) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
		if (!res.ok) {
			throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
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

/** The auto-run already started for this PR, declined or not, or null. */
async function findAutoRun(token, pr) {
	const created = encodeURIComponent(`>=${pr.created_at}`);
	// The runs list is an object, so ghGet doesn't follow its pages.
	for (let page = 1; ; page++) {
		const { workflow_runs: runs } = await ghGet(token, `/repos/${REPO}/actions/workflows/${RUN_WORKFLOW}/runs?event=workflow_dispatch&created=${created}&page=${page}`);
		const match = runs.find(r => r.display_title === autoRunName(pr.number));
		if (match || runs.length < 100) {
			return match ?? null;
		}
	}
}

/** Active member only: a pending invite, a 404 or any error is not. */
async function isMember(orgToken, login) {
	const res = await fetch(`${API}/orgs/posit-dev/teams/positron-dev/memberships/${encodeURIComponent(login)}`, {
		headers: { Authorization: `Bearer ${orgToken}`, Accept: 'application/vnd.github+json' },
	});
	return res.ok && (await res.json()).state === 'active';
}

async function precheck() {
	const token = mustEnv('GH_TOKEN');
	const pr = await ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}`);
	const [files, comments, authorIsMember] = await Promise.all([
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}/files`),
		ghGet(token, `/repos/${REPO}/issues/${PR_NUMBER}/comments`),
		isMember(mustEnv('ORG_TOKEN'), pr.user.login),
	]);
	const auto = isAutoRunAuthor(pr.user?.login, process.env.AUTO_RUN_AUTHORS);
	let skip = skipReason({ pr, repo: REPO, action: process.env.EVENT_ACTION || '', authorIsMember, files, comments });
	if (!skip && auto) {
		const prior = await findAutoRun(token, pr);
		skip = prior ? `auto-run already started (${prior.html_url})` : null;
	}
	summary(`**#${PR_NUMBER}** precheck: ${skip ? `skip (${skip})` : 'pass'}${auto ? ' (author is on the auto-run list)' : ''}`);
	output({ proceed: !skip || DRY_RUN, reason: skip || '', auto });
}

async function judge() {
	const token = mustEnv('GH_TOKEN');
	mustEnv('ANTHROPIC_API_KEY');
	const [pr, files] = await Promise.all([
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}`),
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}/files`),
	]);
	const { default: Anthropic } = await import('@anthropic-ai/sdk');
	const response = await new Anthropic().messages.create({
		model: MODEL,
		max_tokens: 4000,
		// Haiku 4.5 rejects effort; the rest think a little at low.
		...(MODEL.startsWith('claude-haiku') ? {} : { output_config: { effort: 'low' } }),
		messages: [{ role: 'user', content: buildSuggestPrompt({ title: pr.title, body: pr.body, files }) }],
	});
	const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
	const u = response.usage;
	console.log(`[suggest] ${response.model} stop=${response.stop_reason} in=${u.input_tokens} out=${u.output_tokens}: ${text}`);
	// A refusal, a cut-off or an unparseable line all mean silence.
	const verdict = response.stop_reason === 'end_turn' ? parseVerdict(text) : null;
	const suggest = verdict?.suggest === true;
	summary(`**#${PR_NUMBER}** ${pr.title}: ${verdict ? (suggest ? 'SUGGEST' : 'no') : 'no verdict'} - ${verdict?.reason || text.slice(0, 200)} _(${response.model}, ${u.input_tokens} in / ${u.output_tokens} out)_`);
	if (suggest) {
		summary(`\n${renderSuggestComment(verdict.reason)}`);
	}
	output({ suggest, reason: verdict?.reason ?? '' });
}

async function post() {
	const token = mustEnv('GH_TOKEN');
	// Someone may have run /explore while the model was deciding.
	const prior = findPriorUse(await ghGet(token, `/repos/${REPO}/issues/${PR_NUMBER}/comments`));
	if (prior) {
		console.log(`[suggest] not posting: exploratory testing already ${prior.kind} (comment ${prior.id})`);
		return;
	}
	// Anything wrong on the auto-run path falls back to the tip, so the PR still hears.
	if (process.env.AUTO_RUN === 'true') {
		try {
			await startAutoRun(token);
			return;
		} catch (err) {
			console.log(`[suggest] auto-run failed, posting the tip instead: ${err}`);
		}
	}
	const { id } = await postOrEditComment({ fetchImpl: fetch, token, repo: REPO, prNumber: PR_NUMBER, body: renderSuggestComment(mustEnv('REASON')) });
	console.log(`[suggest] posted comment ${id}`);
}

/**
 * Dispatches the run as if `/explore` had been commented, with no comment.
 * GITHUB_TOKEN can do this: a dispatch is the one event its own actions start.
 */
async function startAutoRun(token) {
	const pr = await ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}`);
	const res = await fetch(`${API}/repos/${REPO}/actions/workflows/${RUN_WORKFLOW}/dispatches`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
		body: JSON.stringify({ ref: mustEnv('DISPATCH_REF'), inputs: { ref: pr.head.ref, base: pr.base.ref, auto_run_pr: String(pr.number) } }),
	});
	if (!res.ok) {
		throw new Error(`dispatch failed: ${res.status} ${await res.text()}`);
	}
	console.log(`[suggest] started ${autoRunName(pr.number)} on ${pr.head.ref} (${RUN_WORKFLOW}@${process.env.DISPATCH_REF})`);
}

const steps = { precheck, judge, post };
const step = steps[process.argv[2]];
if (!step) {
	console.error(`Usage: node suggest.ts <${Object.keys(steps).join('|')}>`);
	process.exit(1);
}
step().catch(err => {
	// Fails closed: an error anywhere means no suggestion, never a wrong one.
	console.error(`[suggest] ${process.argv[2]} failed, staying silent: ${err}`);
	summary(`**#${PR_NUMBER}** ${process.argv[2]} failed: ${String(err).slice(0, 300)}`);
	if (process.argv[2] !== 'post') {
		output(process.argv[2] === 'precheck' ? { proceed: false, reason: 'precheck failed' } : { suggest: false, reason: '' });
	}
});
