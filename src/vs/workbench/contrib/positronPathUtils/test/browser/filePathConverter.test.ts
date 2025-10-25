/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { convertClipboardFiles } from '../../common/filePathConverter.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';

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

	test('File path with quotes is escaped correctly', () => {
		// Double quotes are allowed in filenames on macOS/Linux (but not Windows)
		// Example URI captured from real macOS file copy: test"file.txt
		const uriListData = 'file:///Users/test/test%22file.txt';
		const result = convertClipboardFiles(uriListData);
		assert.deepStrictEqual(result, ['"/Users/test/test\\"file.txt"']);
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

	test('Absolute path when preferRelative is false', () => {
		const uriListData = 'file:///c%3A/Users/test/project/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: false,
			baseUri: URI.file('c:/Users/test/project')
		});
		assert.deepStrictEqual(result, ['"c:/Users/test/project/file.txt"']);
	});

	test('Workspace-relative path when file is inside workspace', () => {
		const uriListData = 'file:///c%3A/Users/test/project/src/components/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project')
		});
		assert.deepStrictEqual(result, ['"src/components/file.txt"']);
	});

	test('Absolute path when file is outside workspace', () => {
		const uriListData = 'file:///c%3A/Users/test/other-project/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project')
		});
		assert.deepStrictEqual(result, ['"c:/Users/test/other-project/file.txt"']);
	});

	test('Home-relative path when file is in home directory but outside workspace', () => {
		const uriListData = 'file:///c%3A/Users/test/Documents/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project'),
			homeUri: URI.file('c:/Users/test')
		});
		assert.deepStrictEqual(result, ['"~/Documents/file.txt"']);
	});

	test('Workspace-relative takes priority over home-relative', () => {
		const uriListData = 'file:///c%3A/Users/test/project/src/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project'),
			homeUri: URI.file('c:/Users/test')
		});
		// Should use workspace-relative, not ~/project/src/file.txt
		assert.deepStrictEqual(result, ['"src/file.txt"']);
	});

	test('Multiple files with mixed relative paths', () => {
		const uriListData = 'file:///c%3A/Users/test/project/src/file1.txt\r\nfile:///c%3A/Users/test/other/file2.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project'),
			homeUri: URI.file('c:/Users/test')
		});
		assert.deepStrictEqual(result, [
			'"src/file1.txt"',  // workspace-relative
			'"~/other/file2.txt"'  // home-relative
		]);
	});

	test('Absolute path when file is outside both workspace and home', () => {
		const uriListData = 'file:///d%3A/external/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project'),
			homeUri: URI.file('c:/Users/test')
		});
		assert.deepStrictEqual(result, ['"d:/external/file.txt"']);
	});

	test('Home-relative when only homeUri is provided', () => {
		const uriListData = 'file:///c%3A/Users/test/Documents/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			homeUri: URI.file('c:/Users/test')
		});
		assert.deepStrictEqual(result, ['"~/Documents/file.txt"']);
	});

	test('Absolute path when preferRelative is true but no baseUri or homeUri', () => {
		const uriListData = 'file:///c%3A/Users/test/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true
		});
		assert.deepStrictEqual(result, ['"c:/Users/test/file.txt"']);
	});

	test('POSIX paths: workspace-relative', () => {
		const uriListData = 'file:///home/user/project/src/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('/home/user/project')
		});
		assert.deepStrictEqual(result, ['"src/file.txt"']);
	});

	test('POSIX paths: home-relative', () => {
		const uriListData = 'file:///home/user/Documents/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('/home/user/project'),
			homeUri: URI.file('/home/user')
		});
		assert.deepStrictEqual(result, ['"~/Documents/file.txt"']);
	});

	test('Relative path with spaces preserved', () => {
		const uriListData = 'file:///c%3A/Users/test/project/My%20Documents/file.txt';
		const result = convertClipboardFiles(uriListData, {
			preferRelative: true,
			baseUri: URI.file('c:/Users/test/project')
		});
		assert.deepStrictEqual(result, ['"My Documents/file.txt"']);
	});
});
