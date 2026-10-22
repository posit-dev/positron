/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDatabaseFile, IDatabaseFileSignature, IDatabasePathEnvironment, resolveDatabasePath } from './databasePath';

/**
 * Builds an environment with the given path rules and workspace folders, in which only the given
 * paths exist.
 */
function environment(pathLib: path.PlatformPath, workspaceFolderPaths: string[], existingPaths: string[] = []): IDatabasePathEnvironment {
	return {
		pathLib,
		homedir: pathLib === path.win32 ? 'C:\\Users\\me' : '/home/me',
		workspaceFolderPaths,
		exists: filePath => existingPaths.includes(filePath),
	};
}

describe('resolveDatabasePath', () => {
	describe('on macOS and Linux', () => {
		it.each([
			['normalizes an absolute path', '/data/../data/./db.sqlite', [], '/data/db.sqlite'],
			['resolves a relative path against the first workspace folder', 'data/db.sqlite', ['/ws1', '/ws2'], '/ws1/data/db.sqlite'],
			['resolves a relative path with parent segments', '../shared/db.sqlite', ['/projects/ws'], '/projects/shared/db.sqlite'],
			['keeps an absolute path when a folder is open', '/data/db.sqlite', ['/ws'], '/data/db.sqlite'],
			['expands a leading ~/ to the home folder', '~/data/db.sqlite', ['/ws'], '/home/me/data/db.sqlite'],
			['leaves a relative path relative when no folder is open', 'data/db.sqlite', [], 'data/db.sqlite'],
			['trims whitespace', '  /data/db.sqlite\t', [], '/data/db.sqlite'],
			['strips matching single quotes', '\'/my data/db.sqlite\'', [], '/my data/db.sqlite'],
			['strips matching double quotes', '"/my data/db.sqlite"', [], '/my data/db.sqlite'],
			['keeps unmatched quotes', '"/data/db.sqlite\'', ['/ws'], '/ws/"/data/db.sqlite\''],
			['leaves a blank path empty rather than resolving it to the folder', '   ', ['/ws'], ''],
			['leaves a pair of empty quotes empty', '""', ['/ws'], ''],
		])('%s', (_name, filePath, folders, expected) => {
			expect(resolveDatabasePath(filePath, environment(path.posix, folders))).toBe(expected);
		});

		it('prefers the workspace folder in which the file exists', () => {
			const env = environment(path.posix, ['/ws1', '/ws2'], ['/ws2/data/db.sqlite']);
			expect(resolveDatabasePath('data/db.sqlite', env)).toBe('/ws2/data/db.sqlite');
		});
	});

	describe('on Windows', () => {
		it.each([
			['converts forward slashes', 'C:/data/db.sqlite', [], 'C:\\data\\db.sqlite'],
			['resolves a relative path against the workspace folder', 'data\\db.sqlite', ['C:\\ws'], 'C:\\ws\\data\\db.sqlite'],
			['gives a drive-less path the workspace folder\'s drive', '\\data\\db.sqlite', ['D:\\ws'], 'D:\\data\\db.sqlite'],
			['keeps a path on another drive', 'E:\\data\\db.sqlite', ['D:\\ws'], 'E:\\data\\db.sqlite'],
			['keeps a UNC path', '\\\\server\\share\\db.sqlite', ['C:\\ws'], '\\\\server\\share\\db.sqlite'],
			['strips the quotes "Copy as path" adds', '"C:\\My Data\\db.sqlite"', [], 'C:\\My Data\\db.sqlite'],
			['does not expand ~\\', '~\\db.sqlite', ['C:\\ws'], 'C:\\ws\\~\\db.sqlite'],
			['does not expand ~/', '~/db.sqlite', ['C:\\ws'], 'C:\\ws\\~\\db.sqlite'],
			['leaves a relative path relative when no folder is open', 'data\\db.sqlite', [], 'data\\db.sqlite'],
			['leaves a drive-relative path unresolved', 'C:data\\db.sqlite', ['D:\\ws'], 'C:data\\db.sqlite'],
			['leaves a bare drive unresolved', 'C:', ['D:\\ws'], 'C:'],
		])('%s', (_name, filePath, folders, expected) => {
			expect(resolveDatabasePath(filePath, environment(path.win32, folders))).toBe(expected);
		});
	});
});

describe('checkDatabaseFile', () => {
	// A signature at the start of the header (like SQLite's) and one at an offset (like DuckDB's).
	const atStart: IDatabaseFileSignature = { magic: Buffer.from('MAGIC'), offset: 0, allowEmpty: true };
	const atOffset: IDatabaseFileSignature = { magic: Buffer.from('DUCK'), offset: 8, allowEmpty: false };

	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-database-path-test-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Writes a file in the temp folder and returns its path.
	function writeFile(name: string, contents: string | Buffer): string {
		const filePath = path.join(tmpDir, name);
		fs.writeFileSync(filePath, contents);
		return filePath;
	}

	it('accepts a file whose header starts with the signature', async () => {
		expect(await checkDatabaseFile(writeFile('db', 'MAGIC and the rest'), atStart)).toBe('valid');
	});

	it('accepts a file whose header carries the signature at its offset', async () => {
		const header = Buffer.concat([Buffer.alloc(8, 0xff), Buffer.from('DUCK'), Buffer.alloc(100)]);
		expect(await checkDatabaseFile(writeFile('db', header), atOffset)).toBe('valid');
	});

	it('rejects a file with a different header', async () => {
		expect(await checkDatabaseFile(writeFile('db', 'NOT A DATABASE'), atStart)).toBe('wrongKind');
	});

	it('rejects a file too short to hold the signature', async () => {
		expect(await checkDatabaseFile(writeFile('db', 'MAG'), atStart)).toBe('wrongKind');
	});

	it('accepts an empty file only when the signature allows it', async () => {
		const filePath = writeFile('db', '');
		expect([await checkDatabaseFile(filePath, atStart), await checkDatabaseFile(filePath, atOffset)]).toEqual(['valid', 'wrongKind']);
	});

	it('reports a path that does not exist as missing', async () => {
		expect(await checkDatabaseFile(path.join(tmpDir, 'nope.db'), atStart)).toBe('missing');
	});

	it('reports a path through a file as missing', async () => {
		const filePath = writeFile('db', 'MAGIC');
		expect(await checkDatabaseFile(path.join(filePath, 'child.db'), atStart)).toBe('missing');
	});

	it('reports a folder as not a file', async () => {
		expect(await checkDatabaseFile(tmpDir, atStart)).toBe('notFile');
	});

	// A file that exists but can't be read -- on Windows, one another process has open -- isn't
	// shown to be the wrong kind, so it is accepted. chmod can't make a file unreadable on Windows,
	// or to root.
	it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('accepts a file that exists but cannot be read', async () => {
		const filePath = writeFile('db', 'NOT A DATABASE');
		fs.chmodSync(filePath, 0o000);
		expect(await checkDatabaseFile(filePath, atStart)).toBe('valid');
	});
});
