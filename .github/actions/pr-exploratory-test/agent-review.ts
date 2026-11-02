/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The no-model steps of agent-pr-review.yml:
//   precheck  skips closed, draft and already-reviewed PRs
//   post      renders the model's JSON and posts one COMMENT review
// DRY_RUN=true reviews a PR precheck would skip, and writes the review to the
// step summary instead of posting it.

import { appendFileSync } from 'node:fs';
import { commentableLines, parseReviewOutput, renderReview, reviewSkipReason } from './agent-review-lib.ts';

const API = 'https://api.github.com';
const REPO = mustEnv('GITHUB_REPOSITORY');
const PR_NUMBER = mustEnv('PR_NUMBER');
const DRY_RUN = process.env.DRY_RUN === 'true';

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
	console.log(`[agent-review] ${text.trim().replace(/\n/g, ' ')}`);
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, text);
	}
}

function summary(text) {
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
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

async function precheck() {
	const token = mustEnv('GH_TOKEN');
	const [pr, reviews] = await Promise.all([
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}`),
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}/reviews`),
	]);
	const skip = reviewSkipReason({ pr, action: process.env.EVENT_ACTION || '', reviews });
	summary(`**#${PR_NUMBER}** precheck: ${skip ? `skip (${skip})` : 'pass'}${skip && DRY_RUN ? ', reviewing anyway (dry run)' : ''}`);
	output({ proceed: !skip || DRY_RUN });
}

async function postReview(token, review) {
	return fetch(`${API}/repos/${REPO}/pulls/${PR_NUMBER}/reviews`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
		body: JSON.stringify(review),
	});
}

async function post() {
	const token = mustEnv('GH_TOKEN');
	const parsed = parseReviewOutput(process.env.REVIEW_JSON ?? '');
	if (!parsed) {
		summary(`**#${PR_NUMBER}** no valid review output, posting nothing.\n\n\`\`\`\n${String(process.env.REVIEW_JSON ?? '').slice(0, 4000)}\n\`\`\``);
		throw new Error('review output is missing or malformed');
	}
	const [pr, files] = await Promise.all([
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}`),
		ghGet(token, `/repos/${REPO}/pulls/${PR_NUMBER}/files`),
	]);
	const lines = commentableLines(files);
	const review = renderReview(parsed, lines);
	if (DRY_RUN) {
		summary(`**#${PR_NUMBER}** dry run, not posted. ${review.comments.length} inline:\n\n${review.body}\n`);
		for (const c of review.comments) {
			summary(`- \`${c.path}:${c.line}\` ${c.body}`);
		}
		return;
	}
	const base = { commit_id: pr.head.sha, event: 'COMMENT' };
	let res = await postReview(token, { ...base, body: review.body, comments: review.comments });
	// A line GitHub will not anchor to rejects the whole review; retry body-only.
	if (res.status === 422 && review.comments.length) {
		console.log(`[agent-review] inline post rejected, retrying in the body: ${await res.text()}`);
		res = await postReview(token, { ...base, body: renderReview(parsed, lines, { inline: false }).body });
	}
	if (!res.ok) {
		throw new Error(`POST review failed: ${res.status} ${await res.text()}`);
	}
	const { html_url: url } = await res.json();
	summary(`**#${PR_NUMBER}** posted ${url}`);
	console.log(`[agent-review] posted ${url}`);
}

const steps = { precheck, post };
const step = steps[process.argv[2]];
if (!step) {
	console.error(`Usage: node agent-review.ts <${Object.keys(steps).join('|')}>`);
	process.exit(1);
}
step().catch(err => {
	console.error(`[agent-review] ${process.argv[2]} failed: ${err}`);
	summary(`**#${PR_NUMBER}** ${process.argv[2]} failed: ${String(err).slice(0, 300)}`);
	if (process.argv[2] === 'precheck') {
		output({ proceed: false });
	}
	process.exitCode = 1;
});
