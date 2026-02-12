/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { formatPathForCode, convertClipboardFiles } from '../../common/filePathConverter.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';

suite('File Path Converter Tests', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('formatPathForCode', () => {

		test('Basic quoting of a simple path', () => {
			const result = formatPathForCode('c:/Users/test/file.txt');
			assert.strictEqual(result, '"c:/Users/test/file.txt"');
		});

		test('Backslashes are normalized to forward slashes', () => {
			const result = formatPathForCode('c:\\Users\\test\\file.txt');
			assert.strictEqual(result, '"c:/Users/test/file.txt"');
		});

		test('File path with quotes is escaped correctly', () => {
			// Double quotes are allowed in filenames on macOS/Linux (but not Windows)
			const result = formatPathForCode('/Users/test/test"file.txt');
			assert.strictEqual(result, '"/Users/test/test\\"file.txt"');
		});

		test('Workspace-relative path when file is inside workspace', () => {
			const result = formatPathForCode('c:/Users/test/project/src/components/file.txt', [
				{ uri: URI.file('c:/Users/test/project') }
			]);
			assert.strictEqual(result, '"src/components/file.txt"');
		});

		test('Absolute path when file is outside workspace', () => {
			const result = formatPathForCode('c:/Users/test/other-project/file.txt', [
				{ uri: URI.file('c:/Users/test/project') }
			]);
			assert.strictEqual(result, '"c:/Users/test/other-project/file.txt"');
		});

		test('Home-relative path when file is in home directory but outside workspace', () => {
			const result = formatPathForCode('c:/Users/test/Documents/file.txt', [
				{ uri: URI.file('c:/Users/test/project') },
				{ uri: URI.file('c:/Users/test'), prefix: '~/' }
			]);
			assert.strictEqual(result, '"~/Documents/file.txt"');
		});

		test('Workspace-relative takes priority over home-relative', () => {
			const result = formatPathForCode('c:/Users/test/project/src/file.txt', [
				{ uri: URI.file('c:/Users/test/project') },
				{ uri: URI.file('c:/Users/test'), prefix: '~/' }
			]);
			assert.strictEqual(result, '"src/file.txt"');
		});

		test('POSIX paths: workspace-relative', () => {
			const result = formatPathForCode('/home/user/project/src/file.txt', [
				{ uri: URI.file('/home/user/project') }
			]);
			assert.strictEqual(result, '"src/file.txt"');
		});

		test('POSIX paths: home-relative', () => {
			const result = formatPathForCode('/home/user/Documents/file.txt', [
				{ uri: URI.file('/home/user/project') },
				{ uri: URI.file('/home/user'), prefix: '~/' }
			]);
			assert.strictEqual(result, '"~/Documents/file.txt"');
		});

	});

	suite('convertClipboardFiles', () => {

		test('Returns null for empty input', () => {
			const result = convertClipboardFiles('');
			assert.strictEqual(result, null);
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

		test('Convert multiple Windows file paths', () => {
			const uriListData = 'file:///c%3A/Users/test/file1.txt\r\nfile:///c%3A/Users/test/file2.txt';
			const result = convertClipboardFiles(uriListData);
			assert.deepStrictEqual(result, ['"c:/Users/test/file1.txt"', '"c:/Users/test/file2.txt"']);
		});

		test('Multiple files with mixed relative paths', () => {
			const uriListData = 'file:///c%3A/Users/test/project/src/file1.txt\r\nfile:///c%3A/Users/test/other/file2.txt';
			const result = convertClipboardFiles(uriListData, [
				{ uri: URI.file('c:/Users/test/project') },
				{ uri: URI.file('c:/Users/test'), prefix: '~/' }
			]);
			assert.deepStrictEqual(result, [
				'"src/file1.txt"',  // workspace-relative
				'"~/other/file2.txt"'  // home-relative
			]);
		});
	});
});
