/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { convertClipboardFiles } from '../../common/filePathConverter.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWindows } from '../../../../../base/common/platform.js';

suite('File Path Converter Tests', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// Inputs largely based on real-world examples captured in the debugger on Windows

	test('Convert a single Windows file path', () => {
		const uriListData = 'file:///c%3A/Users/test/file.txt';
		const result = convertClipboardFiles(uriListData);
		assert.deepStrictEqual(result, ['"c:/Users/test/file.txt"']);
	});

	test('Convert multiple Windows file paths', () => {
		const uriListData = 'file:///c%3A/Users/test/file1.txt\r\nfile:///c%3A/Users/test/file2.txt';
		const result = convertClipboardFiles(uriListData);
		assert.deepStrictEqual(result, ['"c:/Users/test/file1.txt"', '"c:/Users/test/file2.txt"']);
	});

	// TODO @jennybc: revisit this test when I can get a real-world example
	// on macOS. You can't actually use `"` in a file path on Windows."
	test('File path with quotes is escaped correctly', () => {
		const uriListData = 'file:///c%3A/Users/test/my%20file.txt';
		const result = convertClipboardFiles(uriListData);
		assert.deepStrictEqual(result, ['"c:/Users/test/my file.txt"']);
	});

	// The isUNC() utility used to detect UNC paths literally only works on
	// Windows.
	(isWindows ? test : test.skip)('UNC path is not converted [can only be tested on Windows]', () => {
		// This tests the real-world scenario where \\localhost\C$\path becomes localhost/C$/path after URI decoding
		const uriListData = 'file://localhost/C$/Users/test/file.txt';
		const result = convertClipboardFiles(uriListData);
		assert.strictEqual(result, null);
	});

	(isWindows ? test : test.skip)('No conversion for mix of regular and UNC paths [can only be tested on Windows]', () => {
		const uriListData = 'file:///c%3A/Users/test/file.txt\r\nfile://localhost/C$/Users/test/file.txt';
		const result = convertClipboardFiles(uriListData);
		assert.strictEqual(result, null);
	});

	test('Returns null for empty input', () => {
		const result = convertClipboardFiles('');
		assert.strictEqual(result, null);
	});
});
