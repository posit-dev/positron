/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentableLines, parseReviewOutput, renderReview, REVIEW_MARKER, reviewSkipReason } from './agent-review-lib.ts';

const finding = (over = {}) => ({ item: 1, path: 'src/a.ts', line: 11, confidence: 'high', body: 'Misses empty input.', ...over });
const openPr = (over = {}) => ({ state: 'open', draft: false, requested_reviewers: [{ login: 'r' }], requested_teams: [], ...over });

test('parseReviewOutput accepts a valid review and rejects broken ones', () => {
	const valid = { findings: [finding()], human_calls: ['Pick a null rule.'] };
	assert.deepEqual(parseReviewOutput(JSON.stringify(valid)), valid);
	assert.deepEqual(parseReviewOutput(valid), valid);
	assert.equal(parseReviewOutput('not json'), null);
	assert.equal(parseReviewOutput('{}'), null);
	assert.equal(parseReviewOutput(''), null);
	assert.equal(parseReviewOutput(JSON.stringify({ findings: [finding({ line: '12' })], human_calls: [] })), null);
	assert.equal(parseReviewOutput(JSON.stringify({ findings: [finding({ confidence: 'sure' })], human_calls: [] })), null);
	assert.equal(parseReviewOutput(JSON.stringify({ findings: [], human_calls: [3] })), null);
});

test('reviewSkipReason skips closed, draft, already reviewed, and ready with no reviewer', () => {
	assert.match(reviewSkipReason({ pr: openPr({ state: 'closed' }), action: 'review_requested', reviews: [] }), /closed/);
	assert.match(reviewSkipReason({ pr: openPr({ draft: true }), action: 'review_requested', reviews: [] }), /draft/);
	assert.match(reviewSkipReason({ pr: openPr(), action: 'review_requested', reviews: [{ id: 9, body: `${REVIEW_MARKER}\nold` }] }), /already reviewed/);
	assert.match(reviewSkipReason({ pr: openPr({ requested_reviewers: [] }), action: 'ready_for_review', reviews: [] }), /no reviewer/);
	assert.equal(reviewSkipReason({ pr: openPr(), action: 'review_requested', reviews: [{ id: 1, body: 'LGTM' }] }), null);
	assert.equal(reviewSkipReason({ pr: openPr({ requested_reviewers: [], requested_teams: [{ slug: 't' }] }), action: 'ready_for_review', reviews: [] }), null);
});

test('commentableLines reads added and context lines from a patch', () => {
	const lines = commentableLines([
		{ filename: 'src/a.ts', patch: '@@ -10,3 +10,4 @@\n a\n-b\n+c\n+d\n e' },
		{ filename: 'img.png' },
	]);
	assert.deepEqual([...lines.get('src/a.ts')].sort((x, y) => x - y), [10, 11, 12, 13]);
	assert.equal(lines.has('img.png'), false);
});

test('commentableLines handles several hunks', () => {
	const lines = commentableLines([{ filename: 'f', patch: '@@ -1,2 +1,2 @@\n-x\n+y\n z\n@@ -40 +40,2 @@ fn()\n+q\n r' }]);
	assert.deepEqual([...lines.get('f')].sort((x, y) => x - y), [1, 2, 40, 41]);
});

test('renderReview puts in-diff findings inline and the rest in the body', () => {
	const lines = new Map([['src/a.ts', new Set([10, 11])]]);
	const { body, comments } = renderReview({ findings: [finding(), finding({ line: 99, body: 'Sibling path too.' })], human_calls: [] }, lines);
	assert.equal(comments.length, 1);
	assert.deepEqual({ ...comments[0], body: undefined }, { path: 'src/a.ts', line: 11, side: 'RIGHT', body: undefined });
	assert.match(comments[0].body, /Misses empty input/);
	assert.match(body, /src\/a\.ts:99/);
	assert.match(body, /Sibling path too/);
	assert.doesNotMatch(body, /Misses empty input/);
});

test('renderReview starts with the marker and lists human calls', () => {
	const { body } = renderReview({ findings: [], human_calls: ['Count nulls as unique?', 'Keep old label?'] }, new Map());
	assert.ok(body.startsWith(REVIEW_MARKER));
	assert.match(body, /Needs a human call[\s\S]*Count nulls as unique\?[\s\S]*Keep old label\?/);
});

test('renderReview says so when there are no findings', () => {
	const { body, comments } = renderReview({ findings: [], human_calls: [] }, new Map());
	assert.ok(body.startsWith(REVIEW_MARKER));
	assert.match(body, /No problems found against the checklist\./);
	assert.equal(comments.length, 0);
});

test('renderReview breaks every @ mention', () => {
	const lines = new Map([['src/a.ts', new Set([11])]]);
	const out = renderReview({ findings: [finding({ body: 'ask @claude to fix' }), finding({ line: 5, body: 'cc @juliasilge' })], human_calls: ['ping @someone'] }, lines);
	const all = out.body + out.comments.map(c => c.body).join('');
	assert.doesNotMatch(all, /@claude|@juliasilge|@someone/);
});

test('renderReview with everything in the body has no comments', () => {
	const lines = new Map([['src/a.ts', new Set([11])]]);
	const { body, comments } = renderReview({ findings: [finding()], human_calls: [] }, lines, { inline: false });
	assert.equal(comments.length, 0);
	assert.match(body, /src\/a\.ts:11[\s\S]*Misses empty input/);
});
