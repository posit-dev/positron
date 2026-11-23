/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with: node --test .github/scripts/close-done-issues.test.mts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardPage, openInDone, type BoardItem } from './close-done-issues.mts';

const item = (status: string | null, number: number, state: string, repo = 'posit-dev/positron'): BoardItem => ({
	fieldValueByName: status === null ? null : { name: status },
	content: { number, state, repository: { nameWithOwner: repo } },
});

test('picks only open issues in this repo that are Done', () => {
	const items: BoardItem[] = [
		item('Done', 1, 'OPEN'),
		item('Done', 2, 'CLOSED'),
		item('PR Ready', 3, 'OPEN'),
		item(null, 4, 'OPEN'),
		item('Done', 5, 'OPEN', 'posit-dev/assistant'),
		// A draft item or a PR: the Issue fragment leaves content empty.
		{ fieldValueByName: { name: 'Done' }, content: {} },
		{ fieldValueByName: { name: 'Done' }, content: null },
	];
	assert.deepEqual(openInDone(items, 'posit-dev/positron'), [1]);
});

test('an unreadable item is a warning, not a failure', () => {
	const warnings: string[] = [];
	const page = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ fieldValueByName: { name: 'Done' }, content: null }] };
	const res = {
		data: { organization: { projectV2: { items: page } } },
		errors: [{ message: 'Resource not accessible by integration' }],
	};
	assert.deepEqual({ page: boardPage(res, w => warnings.push(w)), warnings }, {
		page,
		warnings: ['graphql (partial): Resource not accessible by integration'],
	});
});

test('a response without the board fails', () => {
	assert.throws(() => boardPage({ data: { organization: { projectV2: null } }, errors: [{ message: 'no access' }] }), /graphql: no access/);
	assert.throws(() => boardPage({ errors: [{ message: 'bad query' }] }), /graphql: bad query/);
});
