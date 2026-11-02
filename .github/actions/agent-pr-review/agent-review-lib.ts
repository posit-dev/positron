/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for agent-review.ts, which posts the agent-pr-review skill's
// checklist review on an agent PR.

/** Labels the review, so a second reviewer request does not post another. */
export const REVIEW_MARKER = '<!-- agent-pr-review -->';

// Low-confidence findings are dropped: a review people learn to skim is worse than none.
const POSTED_CONFIDENCE = ['high', 'medium'];

const nonEmpty = v => typeof v === 'string' && v.trim() !== '';

function isFinding(f) {
	return !!f && nonEmpty(f.title) && nonEmpty(f.path) && Number.isInteger(f.line)
		&& [...POSTED_CONFIDENCE, 'low'].includes(f.confidence) && typeof f.body === 'string';
}

function isDecision(h) {
	return !!h && nonEmpty(h.title) && typeof h.body === 'string';
}

/**
 * The model's structured output as `{ findings, human_calls }` without its
 * low-confidence findings, or null when any field has the wrong type.
 */
export function parseReviewOutput(input) {
	let data = input;
	if (typeof input === 'string') {
		try {
			data = JSON.parse(input);
		} catch {
			return null;
		}
	}
	if (!data || !Array.isArray(data.findings) || !Array.isArray(data.human_calls)) {
		return null;
	}
	if (!data.findings.every(isFinding) || !data.human_calls.every(isDecision)) {
		return null;
	}
	return { findings: data.findings.filter(f => POSTED_CONFIDENCE.includes(f.confidence)), human_calls: data.human_calls };
}

/**
 * Whether the PR's head lives in this repo. A fork's head would run its own
 * setup scripts in a job with secrets, so it is refused even on a dispatch.
 */
export function isSameRepoHead(pr, repo) {
	return pr.head?.repo?.full_name === repo;
}

/**
 * Why this PR gets no review, or null. `pr` is the REST pulls object, `action`
 * the pull_request event's action (empty on a dispatch), `reviews` its reviews.
 */
export function reviewSkipReason({ pr, action, reviews }) {
	if (pr.state !== 'open') {
		return `PR is ${pr.merged_at ? 'merged' : pr.state}`;
	}
	if (pr.draft) {
		return 'PR is a draft; ready_for_review brings it back';
	}
	if (action === 'ready_for_review' && !pr.requested_reviewers?.length && !pr.requested_teams?.length) {
		return 'ready for review with no reviewer requested';
	}
	const prior = reviews.find(r => String(r?.body ?? '').includes(REVIEW_MARKER));
	if (prior) {
		return `already reviewed (review ${prior.id})`;
	}
	return null;
}

/**
 * The full SHA of the PR commit that `sha` (7 to 40 hex characters) names, or
 * null. Only the PR's own commits can be reviewed in place of its head.
 */
export function findPrCommit(commits, sha) {
	if (!/^[0-9a-f]{7,40}$/.test(sha)) {
		return null;
	}
	return commits.find(c => c.sha.startsWith(sha))?.sha ?? null;
}

/** Zero-width space after @ so a handle the model wrote pings nobody. */
function defuse(text) {
	return String(text).replace(/@(?=[\w-])/g, '@\u200b');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The review body. Each finding links to its line in the reviewed commit `sha`.
 */
export function renderReview(output, { repo, sha }) {
	const { findings, human_calls: decisions } = output;
	const footer = ['', '<sub>Automated checklist review of the diff. It does not approve or block.</sub>'];
	if (!findings.length && !decisions.length) {
		return [
			REVIEW_MARKER,
			'**Agent review: no problems found**',
			'Checked the diff for missed cases and sibling code paths, tests that pass without the fix, duplicated logic, stale state, cost, and platform assumptions.',
			...footer,
		].join('\n');
	}
	const counts = [findings.length ? plural(findings.length, 'problem') : '', decisions.length ? `${plural(decisions.length, 'decision')} for you` : ''];
	const parts = [REVIEW_MARKER, `**Agent review: ${counts.filter(Boolean).join(', ')}**`];
	if (findings.length) {
		parts.push('', '**Problems**', '');
		findings.forEach((f, i) => {
			const where = `[${f.path.split('/').pop()}:${f.line}](https://github.com/${repo}/blob/${sha}/${f.path}#L${f.line})`;
			parts.push(`${i + 1}. **${defuse(f.title)}** - ${where} - ${f.confidence} confidence`, `   ${defuse(f.body)}`);
		});
	}
	if (decisions.length) {
		parts.push('', '**Decisions for you**', '');
		decisions.forEach((h, i) => parts.push(`${i + 1}. **${defuse(h.title).replace(/[.?!]$/, '')}.** ${defuse(h.body)}`));
	}
	return [...parts, ...footer].join('\n');
}
