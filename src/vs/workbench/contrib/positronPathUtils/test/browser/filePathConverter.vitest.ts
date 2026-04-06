/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { formatPathForCode, convertClipboardFiles } from '../../common/filePathConverter.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';

describe('File Path Converter Tests', () => {

	describe('formatPathForCode', () => {

		it('Basic quoting of a simple path', () => {
			const result = formatPathForCode('c:/Users/test/file.txt');
			expect(result).toBe('"c:/Users/test/file.txt"');
		});

		it('Backslashes are normalized to forward slashes', () => {
			const result = formatPathForCode('c:\\Users\\test\\file.txt');
			expect(result).toBe('"c:/Users/test/file.txt"');
		});

		it('File path with quotes is escaped correctly', () => {
			// Double quotes are allowed in filenames on macOS/Linux (but not Windows)
			const result = formatPathForCode('/Users/test/test"file.txt');
			expect(result).toBe('"/Users/test/test\\"file.txt"');
		});

		it('Workspace-relative path when file is inside workspace', () => {
			const result = formatPathForCode('c:/Users/test/project/src/components/file.txt', [
				{ uri: URI.file('c:/Users/test/project') }
			]);
			expect(result).toBe('"src/components/file.txt"');
		});

		it('Absolute path when file is outside workspace', () => {
			const result = formatPathForCode('c:/Users/test/other-project/file.txt', [
				{ uri: URI.file('c:/Users/test/project') }
			]);
			expect(result).toBe('"c:/Users/test/other-project/file.txt"');
		});

		it('Home-relative path when file is in home directory but outside workspace', () => {
			const result = formatPathForCode('c:/Users/test/Documents/file.txt', [
				{ uri: URI.file('c:/Users/test/project') },
				{ uri: URI.file('c:/Users/test'), prefix: '~/' }
			]);
			expect(result).toBe('"~/Documents/file.txt"');
		});

		it('Workspace-relative takes priority over home-relative', () => {
			const result = formatPathForCode('c:/Users/test/project/src/file.txt', [
				{ uri: URI.file('c:/Users/test/project') },
				{ uri: URI.file('c:/Users/test'), prefix: '~/' }
			]);
			expect(result).toBe('"src/file.txt"');
		});

		it('POSIX paths: workspace-relative', () => {
			const result = formatPathForCode('/home/user/project/src/file.txt', [
				{ uri: URI.file('/home/user/project') }
			]);
			expect(result).toBe('"src/file.txt"');
		});

		it('POSIX paths: home-relative', () => {
			const result = formatPathForCode('/home/user/Documents/file.txt', [
				{ uri: URI.file('/home/user/project') },
				{ uri: URI.file('/home/user'), prefix: '~/' }
			]);
			expect(result).toBe('"~/Documents/file.txt"');
		});

	});

	describe('convertClipboardFiles', () => {

		it('Returns null for empty input', () => {
			const result = convertClipboardFiles('');
			expect(result).toBe(null);
		});

		// The isUNC() utility used to detect UNC paths literally only works on
		// Windows.
		(isWindows ? it : it.skip)('UNC path is not converted [can only be tested on Windows]', () => {
			// This tests the real-world scenario where \\localhost\C$\path becomes localhost/C$/path after URI decoding
			const uriListData = 'file://localhost/C$/Users/test/file.txt';
			const result = convertClipboardFiles(uriListData);
			expect(result).toBe(null);
		});

		(isWindows ? it : it.skip)('No conversion for mix of regular and UNC paths [can only be tested on Windows]', () => {
			const uriListData = 'file:///c%3A/Users/test/file.txt\r\nfile://localhost/C$/Users/test/file.txt';
			const result = convertClipboardFiles(uriListData);
			expect(result).toBe(null);
		});

		it('Convert multiple Windows file paths', () => {
			const uriListData = 'file:///c%3A/Users/test/file1.txt\r\nfile:///c%3A/Users/test/file2.txt';
			const result = convertClipboardFiles(uriListData);
			expect(result).toEqual(['"c:/Users/test/file1.txt"', '"c:/Users/test/file2.txt"']);
		});

		it('Multiple files with mixed relative paths', () => {
			const uriListData = 'file:///c%3A/Users/test/project/src/file1.txt\r\nfile:///c%3A/Users/test/other/file2.txt';
			const result = convertClipboardFiles(uriListData, [
				{ uri: URI.file('c:/Users/test/project') },
				{ uri: URI.file('c:/Users/test'), prefix: '~/' }
			]);
			expect(result).toEqual([
				'"src/file1.txt"',  // workspace-relative
				'"~/other/file2.txt"'  // home-relative
			]);
		});
	});
});
