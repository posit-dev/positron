/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkPathLengths, measurePathLengths } from '../positron-check-path-lengths.ts';
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
