/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type IFileCountBudgets, checkFileCounts, checkPathLengths, measureFileCounts, measurePathLengths } from '../positron-check-path-lengths.ts';
import { MAX_RELATIVE_PATH_LENGTH } from '../positron-path-budget.ts';

/**
 * Makes a fixture of a packaged tree. The deepest file is `length` characters
 * from the root. The shape matches a real offender: a chain of node_modules
 * directories with a file at the end.
 */
function writeFileAtDepth(root: string, length: number): string {
	const segments: string[] = ['resources', 'app', 'extensions', 'ext', 'node_modules'];

	// Add directories of a fixed width. Then set the length of the file name, so
	// that the total is exactly `length`.
	while (segments.join('/').length + '/dir0000'.length + '/f.js'.length < length) {
		segments.push(`dir${String(segments.length).padStart(4, '0')}`);
	}

	const dir = segments.join('/');
	const fileName = 'f'.repeat(length - dir.length - 1);
	fs.mkdirSync(path.join(root, dir), { recursive: true });
	fs.writeFileSync(path.join(root, dir, fileName), '');

	return `${dir.split('/').join('\\')}\\${fileName}`;
}

suite('positron-check-path-lengths', () => {

	let appRoot: string;

	before(() => {
		appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-path-lengths-'));
	});

	after(() => {
		fs.rmSync(appRoot, { recursive: true, force: true });
	});

	test('measures paths relative to the install directory, using Windows separators', () => {
		const expected = writeFileAtDepth(appRoot, MAX_RELATIVE_PATH_LENGTH);
		const result = measurePathLengths(appRoot);

		assert.deepStrictEqual(
			{ fileCount: result.fileCount, length: result.longest.length, longest: result.longest, offenders: result.offenders },
			{ fileCount: 1, length: MAX_RELATIVE_PATH_LENGTH, longest: expected, offenders: [] });
	});

	test('a path exactly at the budget passes, one character more fails', () => {
		// From the previous test, the tree already holds a file at exactly the
		// budget. This test therefore checks the limit from both sides.
		assert.doesNotThrow(() => checkPathLengths(appRoot));

		const tooLong = writeFileAtDepth(appRoot, MAX_RELATIVE_PATH_LENGTH + 1);

		assert.deepStrictEqual(measurePathLengths(appRoot).offenders, [tooLong]);
		assert.throws(() => checkPathLengths(appRoot), /longer than the Windows MAX_PATH budget/);
	});

	test('reports a missing tree rather than passing vacuously', () => {
		assert.throws(
			() => checkPathLengths(path.join(appRoot, 'does-not-exist')),
			/does not exist/);
	});
});

/** Writes `count` files of `bytes` bytes each under `dir`, relative to `root`. */
function writeFiles(root: string, dir: string, count: number, bytes = 1): void {
	fs.mkdirSync(path.join(root, dir), { recursive: true });
	for (let i = 0; i < count; i++) {
		fs.writeFileSync(path.join(root, dir, `f${i}.js`), 'x'.repeat(bytes));
	}
}

suite('positron-check-path-lengths file counts', () => {

	const budgets: IFileCountBudgets = {
		total: 20,
		default: 3,
		byExtension: new Map([['big', 12]])
	};

	let appRoot: string;

	before(() => {
		// A macOS-shaped tree: `extensions/` sits below `Resources/app`, next to
		// files that are not part of it.
		appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-file-counts-'));
		writeFiles(appRoot, 'MacOS', 2);
		writeFiles(appRoot, 'Resources/app/extensions/big/dist', 2, 10);
		writeFiles(appRoot, 'Resources/app/extensions/big/node_modules/plain', 3);
		writeFiles(appRoot, 'Resources/app/extensions/big/node_modules/plain/node_modules/nested', 2);
		writeFiles(appRoot, 'Resources/app/extensions/big/node_modules/@scope/pkg/lib', 4);
		writeFiles(appRoot, 'Resources/app/extensions/small', 3);
		writeFiles(appRoot, 'Resources/app/extensions/node_modules/shared', 1);
	});

	after(() => {
		fs.rmSync(appRoot, { recursive: true, force: true });
	});

	test('counts each extension and its top-level packages, nested dependencies included', () => {
		const result = measureFileCounts(appRoot, 'Resources/app/extensions', budgets);

		assert.deepStrictEqual(result, {
			shipped: { name: '', files: 17, bytes: 35 },
			extensions: { name: 'extensions/', files: 15, bytes: 33, budget: 20, packages: [] },
			byExtension: [
				{
					name: 'big', files: 11, bytes: 29, budget: 12, packages: [
						{ name: 'plain', files: 5, bytes: 5 },
						{ name: '@scope/pkg', files: 4, bytes: 4 },
					]
				},
				{ name: 'small', files: 3, bytes: 3, budget: 3, packages: [] },
				{ name: 'node_modules', files: 1, bytes: 1, budget: 3, packages: [{ name: 'shared', files: 1, bytes: 1 }] },
			],
			offenders: []
		});
	});

	test('accepts the extensions directory with Windows separators', () => {
		assert.deepStrictEqual(
			measureFileCounts(appRoot, 'Resources\\app\\extensions', budgets).extensions.files,
			15);
	});

	test('an extension over its own budget, over the default budget, or a total over budget fails', () => {
		assert.doesNotThrow(() => checkFileCounts(appRoot, 'Resources/app/extensions', budgets));

		const tight: IFileCountBudgets = { total: 14, default: 2, byExtension: new Map([['big', 10]]) };
		const offenders = measureFileCounts(appRoot, 'Resources/app/extensions', tight).offenders
			.map(({ name, files, budget }) => ({ name, files, budget }));

		assert.deepStrictEqual(offenders, [
			{ name: 'extensions/', files: 15, budget: 14 },
			{ name: 'big', files: 11, budget: 10 },
			{ name: 'small', files: 3, budget: 2 },
		]);
		assert.throws(() => checkFileCounts(appRoot, 'Resources/app/extensions', tight), /3 file count\(s\) .* over budget/);
	});

	test('reports a wrong extensions directory rather than passing vacuously', () => {
		assert.throws(
			() => checkFileCounts(appRoot, 'resources/app/extensions', budgets),
			/resources\/app\/extensions holds no files/);
	});
});
