/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type IFileCountBudgets, checkPackagedTree } from '../positron-check-path-lengths.ts';
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

	// Generous enough that the file counts never fail the path-length tests.
	const budgets: IFileCountBudgets = { total: 100, default: 100, byExtension: new Map() };
	const extensionsDir = 'resources/app/extensions';

	let appRoot: string;

	before(() => {
		appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-path-lengths-'));
	});

	after(() => {
		fs.rmSync(appRoot, { recursive: true, force: true });
	});

	test('measures paths relative to the install directory, using Windows separators', () => {
		const expected = writeFileAtDepth(appRoot, MAX_RELATIVE_PATH_LENGTH);
		const result = checkPackagedTree(appRoot, extensionsDir, { pathLengths: true, budgets }).pathLengths!;

		assert.deepStrictEqual(
			{ fileCount: result.fileCount, length: result.longest.length, longest: result.longest, offenders: result.offenders },
			{ fileCount: 1, length: MAX_RELATIVE_PATH_LENGTH, longest: expected, offenders: [] });
	});

	test('a path exactly at the budget passes, one character more fails', () => {
		// From the previous test, the tree already holds a file at exactly the
		// budget. This test therefore checks the limit from both sides.
		const tooLong = writeFileAtDepth(appRoot, MAX_RELATIVE_PATH_LENGTH + 1);

		assert.throws(
			() => checkPackagedTree(appRoot, extensionsDir, { pathLengths: true, budgets }),
			{ message: `1 shipped path(s) are longer than the Windows MAX_PATH budget, the longest is ${tooLong}` });
	});

	test('skips the path lengths when asked to', () => {
		// The tree still holds the offender from the previous test.
		assert.strictEqual(checkPackagedTree(appRoot, extensionsDir, { pathLengths: false, budgets }).pathLengths, undefined);
	});

	test('reports a missing tree rather than passing vacuously', () => {
		assert.throws(
			() => checkPackagedTree(path.join(appRoot, 'does-not-exist'), extensionsDir, { pathLengths: true, budgets }),
			/does not exist/);
	});

	test('reports a path failure and a file-count failure together', () => {
		const tight: IFileCountBudgets = { total: 1, default: 100, byExtension: new Map() };

		assert.throws(
			() => checkPackagedTree(appRoot, extensionsDir, { pathLengths: true, budgets: tight }),
			/longer than the Windows MAX_PATH budget.*; 1 file count\(s\) in the packaged tree are over budget: extensions\/ \(2 of 1\)$/);
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

	/** Checks only the file counts, as the server build does. */
	function countFiles(root: string, extensionsDir: string, countBudgets = budgets) {
		return checkPackagedTree(root, extensionsDir, { pathLengths: false, budgets: countBudgets }).fileCounts;
	}

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
		assert.deepStrictEqual(countFiles(appRoot, 'Resources/app/extensions'), {
			shipped: { name: '', files: 17, bytes: 35 },
			extensions: { name: 'extensions/', files: 15, bytes: 33, budget: 20 },
			unbudgeted: { name: 'unbudgeted', files: 0, bytes: 0 },
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
		assert.strictEqual(countFiles(appRoot, 'Resources\\app\\extensions').extensions.files, 15);
	});

	test('an extension over its own budget, over the default budget, or a total over budget fails', () => {
		const tight: IFileCountBudgets = { total: 14, default: 2, byExtension: new Map([['big', 10]]) };

		assert.throws(
			() => countFiles(appRoot, 'Resources/app/extensions', tight),
			{ message: '3 file count(s) in the packaged tree are over budget: extensions/ (15 of 14), big (11 of 10), small (3 of 2)' });
	});

	test('leaves gzip copies and source maps out of the budgets, but counts a .gz file that has no original', () => {
		const gzipRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-file-counts-gzip-'));
		try {
			const dir = path.join(gzipRoot, 'extensions', 'ext');
			writeFiles(gzipRoot, 'extensions/ext', 2, 10);
			fs.writeFileSync(path.join(dir, 'f0.js.gz'), 'x'.repeat(4));
			fs.writeFileSync(path.join(dir, 'data.gz'), 'x'.repeat(3));
			fs.writeFileSync(path.join(dir, 'f0.js.map'), 'x'.repeat(5));
			fs.writeFileSync(path.join(dir, 'f1.css.map'), 'x'.repeat(6));

			const result = countFiles(gzipRoot, 'extensions');

			assert.deepStrictEqual(
				{ shipped: result.shipped, extensions: result.extensions.files, ext: result.byExtension[0].files, unbudgeted: result.unbudgeted },
				{ shipped: { name: '', files: 6, bytes: 38 }, extensions: 3, ext: 3, unbudgeted: { name: 'unbudgeted', files: 3, bytes: 15 } });
		} finally {
			fs.rmSync(gzipRoot, { recursive: true, force: true });
		}
	});

	test('reports a wrong extensions directory rather than passing vacuously', () => {
		assert.throws(
			() => countFiles(appRoot, 'resources/app/extensions'),
			/resources\/app\/extensions holds no files/);
	});
});
