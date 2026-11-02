/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameRepoHead, parseReviewOutput, renderReview, REVIEW_MARKER, reviewSkipReason } from './agent-review-lib.ts';

const finding = (over = {}) => ({ title: 'Same bug in a sibling path', path: 'src/dir/a.ts', line: 11, confidence: 'high', body: 'Misses empty input.', ...over });
const decision = (over = {}) => ({ title: 'Nulls in the unique count', body: 'Polars counts null, pandas does not.', ...over });
const openPr = (over = {}) => ({ state: 'open', draft: false, requested_reviewers: [{ login: 'r' }], requested_teams: [], ...over });
const ctx = { repo: 'posit-dev/positron', sha: 'abc123' };

test('parseReviewOutput accepts a valid review and rejects broken ones', () => {
	const valid = { findings: [finding()], human_calls: [decision()] };
	assert.deepEqual(parseReviewOutput(JSON.stringify(valid)), valid);
	assert.deepEqual(parseReviewOutput(valid), valid);
	assert.equal(parseReviewOutput('not json'), null);
	assert.equal(parseReviewOutput('{}'), null);
	assert.equal(parseReviewOutput(''), null);
	assert.equal(parseReviewOutput({ findings: [finding({ line: '12' })], human_calls: [] }), null);
	assert.equal(parseReviewOutput({ findings: [finding({ title: '' })], human_calls: [] }), null);
	assert.equal(parseReviewOutput({ findings: [], human_calls: ['a string'] }), null);
});

test('parseReviewOutput drops low-confidence findings', () => {
	const out = parseReviewOutput({ findings: [finding(), finding({ confidence: 'low' }), finding({ confidence: 'medium' })], human_calls: [] });
	assert.deepEqual(out.findings.map(f => f.confidence), ['high', 'medium']);
	assert.equal(parseReviewOutput({ findings: [finding({ confidence: 'sure' })], human_calls: [] }), null);
});

test('reviewSkipReason skips closed, draft, already reviewed, and ready with no reviewer', () => {
	assert.match(reviewSkipReason({ pr: openPr({ state: 'closed' }), action: 'review_requested', reviews: [] }), /closed/);
	assert.match(reviewSkipReason({ pr: openPr({ draft: true }), action: 'review_requested', reviews: [] }), /draft/);
	assert.match(reviewSkipReason({ pr: openPr(), action: 'review_requested', reviews: [{ id: 9, body: `${REVIEW_MARKER}\nold` }] }), /already reviewed/);
	assert.match(reviewSkipReason({ pr: openPr({ requested_reviewers: [] }), action: 'ready_for_review', reviews: [] }), /no reviewer/);
	assert.equal(reviewSkipReason({ pr: openPr(), action: 'review_requested', reviews: [{ id: 1, body: 'LGTM' }] }), null);
	assert.equal(reviewSkipReason({ pr: openPr({ requested_reviewers: [], requested_teams: [{ slug: 't' }] }), action: 'ready_for_review', reviews: [] }), null);
});

test('isSameRepoHead refuses a fork or a deleted head repo', () => {
	assert.equal(isSameRepoHead({ head: { repo: { full_name: 'posit-dev/positron' } } }, 'posit-dev/positron'), true);
	assert.equal(isSameRepoHead({ head: { repo: { full_name: 'someone/positron' } } }, 'posit-dev/positron'), false);
	assert.equal(isSameRepoHead({ head: { repo: null } }, 'posit-dev/positron'), false);
});

test('renderReview says what it checked when there is nothing to report', () => {
	const body = renderReview({ findings: [], human_calls: [] }, ctx);
	assert.ok(body.startsWith(REVIEW_MARKER));
	assert.match(body, /\*\*Agent review: no problems found\*\*\nChecked the diff for /);
	assert.doesNotMatch(body, /Problems\*\*|Decisions for you/);
	assert.match(body, /<sub>.*<\/sub>\s*$/);
});

test('renderReview leads with counts, then problems, then decisions, then a footer', () => {
	const body = renderReview({ findings: [finding()], human_calls: [decision(), decision({ title: 'Enum columns' })] }, ctx);
	assert.ok(body.startsWith(REVIEW_MARKER));
	assert.match(body, /\*\*Agent review: 1 problem, 2 decisions for you\*\*/);
	assert.match(body, /\*\*Problems\*\*[\s\S]*\*\*Decisions for you\*\*/);
	assert.match(body, /1\. \*\*Same bug in a sibling path\*\* - \[a\.ts:11\]\(https:\/\/github\.com\/posit-dev\/positron\/blob\/abc123\/src\/dir\/a\.ts#L11\) - high confidence/);
	assert.match(body, /1\. \*\*Nulls in the unique count\.\*\* Polars counts null/);
	assert.match(body, /2\. \*\*Enum columns\.\*\*/);
	assert.match(body, /<sub>.*does not approve or block.*<\/sub>\s*$/);
	assert.doesNotMatch(body, /Q\d|reports problems only/);
});

test('renderReview omits an empty section and words the count to match', () => {
	const onlyDecisions = renderReview({ findings: [], human_calls: [decision()] }, ctx);
	assert.match(onlyDecisions, /Agent review: 1 decision for you\*\*/);
	assert.doesNotMatch(onlyDecisions, /Problems/);
	const onlyProblems = renderReview({ findings: [finding(), finding({ line: 40 })], human_calls: [] }, ctx);
	assert.match(onlyProblems, /Agent review: 2 problems\*\*/);
	assert.doesNotMatch(onlyProblems, /Decisions for you/);
});

test('renderReview breaks every @ mention', () => {
	const body = renderReview({ findings: [finding({ title: 'ask @claude', body: 'cc @juliasilge' })], human_calls: [decision({ body: 'ping @someone' })] }, ctx);
	assert.doesNotMatch(body, /@claude|@juliasilge|@someone/);
});
