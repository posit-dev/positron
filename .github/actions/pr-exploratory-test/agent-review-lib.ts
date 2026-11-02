/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure helpers for agent-review.ts, which posts the agent-pr-review skill's
// checklist review on an agent PR. Not in versioned-files.txt: no skill bump.

/** Labels the review, so a second reviewer request does not post another. */
export const REVIEW_MARKER = '<!-- agent-pr-review -->';

const CONFIDENCE = ['high', 'medium', 'low'];

function isFinding(f) {
	return !!f && Number.isInteger(f.item) && typeof f.path === 'string' && f.path !== ''
		&& Number.isInteger(f.line) && CONFIDENCE.includes(f.confidence) && typeof f.body === 'string';
}

/**
 * The model's structured output as `{ findings, human_calls }`, or null when it
 * is missing or any field has the wrong type. Null means post nothing.
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
	if (!data.findings.every(isFinding) || !data.human_calls.every(h => typeof h === 'string')) {
		return null;
	}
	return { findings: data.findings, human_calls: data.human_calls };
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
 * The right-side line numbers each file's patch shows (added or context), the
 * only lines GitHub accepts an inline comment on. A file with no patch is absent.
 */
export function commentableLines(files) {
	const map = new Map();
	for (const f of files) {
		if (!f.patch) {
			continue;
		}
		const lines = new Set();
		let line = 0;
		for (const text of f.patch.split('\n')) {
			const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunk) {
				line = Number(hunk[1]);
			} else if (text.startsWith('+') || text.startsWith(' ')) {
				lines.add(line++);
			}
		}
		map.set(f.filename, lines);
	}
	return map;
}

/** Zero-width space after @ so a handle the model wrote pings nobody. */
function defuse(text) {
	return String(text).replace(/@(?=[\w-])/g, '@​');
}

function findingText(f) {
	return `**Q${f.item}** (${f.confidence}): ${defuse(f.body)}`;
}

/**
 * The review to post. Findings on a commentable line go inline; the rest, or
 * all of them with `inline: false`, go in the body as `path:line`.
 */
export function renderReview(output, lines, { inline = true } = {}) {
	const comments = [];
	const rest = [];
	for (const f of output.findings) {
		if (inline && lines.get(f.path)?.has(f.line)) {
			comments.push({ path: f.path, line: f.line, side: 'RIGHT', body: findingText(f) });
		} else {
			rest.push(`- \`${f.path}:${f.line}\` ${findingText(f)}`);
		}
	}
	const parts = [
		REVIEW_MARKER,
		'**Checklist review**',
		'',
		'_From the `agent-pr-review` skill. It reports problems only and never approves. Q numbers refer to the checklist in that skill._',
	];
	if (!output.findings.length && !output.human_calls.length) {
		parts.push('', 'No problems found against the checklist.');
	}
	if (rest.length) {
		parts.push('', comments.length ? 'Findings outside the diff:' : 'Findings:', '', ...rest);
	}
	if (output.human_calls.length) {
		parts.push('', '**Needs a human call**', '', ...output.human_calls.map(h => `- ${defuse(h)}`));
	}
	return { body: parts.join('\n'), comments };
}
