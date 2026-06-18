/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseTestsFromFile } from '../testing/parser';
import { ItemType, TestingTools } from '../testing/util-testing';

suite('parseTestsFromFile', () => {
	test('normalizes CRLF in a multi-line description to LF', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r-test-parser-'));
		const filePath = path.join(dir, 'test-crlf.R');
		const source = [
			'test_that("first line',
			'second line", {',
			'  expect_true(TRUE)',
			'})',
			'',
		].join('\r\n');
		fs.writeFileSync(filePath, source);

		const controller = vscode.tests.createTestController('test-parser', 'Test Parser');
		const fileItem = controller.createTestItem('test-crlf.R', 'test-crlf.R', vscode.Uri.file(filePath));
		const tools: TestingTools = {
			packageRoot: vscode.Uri.file(dir),
			packageName: 'testpkg',
			controller,
			testItemData: new WeakMap<vscode.TestItem, ItemType>(),
		};

		try {
			await parseTestsFromFile(tools, fileItem);

			const children: vscode.TestItem[] = [];
			fileItem.children.forEach(child => children.push(child));

			assert.deepStrictEqual(
				children.map(child => ({ id: child.id, label: child.label })),
				[{ id: 'test-crlf.R&first line\nsecond line', label: 'first line\nsecond line' }]
			);
		} finally {
			controller.dispose();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
