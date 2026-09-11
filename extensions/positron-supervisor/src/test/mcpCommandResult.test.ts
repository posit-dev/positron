/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { budgetCommandResult, COMMAND_RESULT_BUDGET_BYTES } from '../mcpCommandResult';

/** A package-like record, roughly the size a real one serializes to. */
function fakePackage(index: number) {
	return {
		name: `package-${index}`,
		version: '1.2.3',
		library: '/Users/someone/Library/R/arm64/4.3/library',
		description: 'A package that exists only to take up space in a test fixture.',
	};
}

/** The serialized size of a value, in bytes. */
function sizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

suite('budgetCommandResult', () => {
	test('returns a result that already fits unchanged', () => {
		const result = { packages: [fakePackage(1), fakePackage(2)] };
		assert.strictEqual(budgetCommandResult(result), result);
	});

	test('sheds elements from the longest array field and says so', () => {
		const packages = Array.from({ length: 2000 }, (_, i) => fakePackage(i));
		const budgeted = budgetCommandResult({ library: '/lib', packages }) as {
			library: string;
			packages: unknown[];
			truncated: { field: string; returned: number; total: number };
		};

		assert.deepStrictEqual(
			{
				library: budgeted.library,
				fits: sizeOf(budgeted) <= COMMAND_RESULT_BUDGET_BYTES,
				keptSome: budgeted.packages.length > 0,
				keptFewer: budgeted.packages.length < packages.length,
				lengthsAgree: budgeted.packages.length === budgeted.truncated.returned,
				truncatedField: budgeted.truncated.field,
				truncatedTotal: budgeted.truncated.total,
			},
			{
				library: '/lib',
				fits: true,
				keptSome: true,
				keptFewer: true,
				lengthsAgree: true,
				truncatedField: 'packages',
				truncatedTotal: 2000,
			});
	});

	test('wraps a bare array so the truncation marker has somewhere to live', () => {
		const items = Array.from({ length: 2000 }, (_, i) => fakePackage(i));
		const budgeted = budgetCommandResult(items) as {
			items: unknown[];
			truncated: { field: string; returned: number; total: number };
		};

		assert.deepStrictEqual(
			{
				fits: sizeOf(budgeted) <= COMMAND_RESULT_BUDGET_BYTES,
				lengthsAgree: budgeted.items.length === budgeted.truncated.returned,
				keptSome: budgeted.items.length > 0,
				truncated: { field: budgeted.truncated.field, total: budgeted.truncated.total },
			},
			{
				fits: true,
				lengthsAgree: true,
				keptSome: true,
				truncated: { field: 'items', total: 2000 },
			});
	});

	test('explains itself when there is nothing structural to shed', () => {
		const budgeted = budgetCommandResult('x'.repeat(COMMAND_RESULT_BUDGET_BYTES + 1)) as {
			truncated: { field: string; returned: number };
			message: string;
		};

		assert.deepStrictEqual(
			{
				truncated: budgeted.truncated,
				mentionsLimit: budgeted.message.includes(`${COMMAND_RESULT_BUDGET_BYTES}`),
			},
			{
				truncated: { field: 'result', returned: 0, total: 1 },
				mentionsLimit: true,
			});
	});
});
