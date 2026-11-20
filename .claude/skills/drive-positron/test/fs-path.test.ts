/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// dp-lib.ts's fsPath: the window's URI paths (the folder, the user settings
// file) as paths settings.sh can write to, on each platform.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fsPath } from '../scripts/dp-lib.ts';

test('on Windows a URI path drops the slash before its drive letter', () => {
	assert.deepEqual([
		fsPath('/c:/Users/me/ws11063', 'win32'),
		fsPath('/C:/Users/JONVAN~1/AppData/Local/Temp/run/user-data/User/settings.json', 'win32'),
		fsPath('/c:/Users/me/a b/#x%20y', 'win32'),
	], [
		'c:\\Users\\me\\ws11063',
		'C:\\Users\\JONVAN~1\\AppData\\Local\\Temp\\run\\user-data\\User\\settings.json',
		'c:\\Users\\me\\a b\\#x%20y',
	]);
});

test('on Windows a path that already has its drive letter is kept', () => {
	assert.deepEqual([fsPath('C:/Users/me/ws', 'win32'), fsPath('C:\\Users\\me\\ws', 'win32')], ['C:\\Users\\me\\ws', 'C:\\Users\\me\\ws']);
});

test('on macOS and Linux the path is returned as it is', () => {
	for (const platform of ['darwin', 'linux'] as const) {
		assert.deepEqual([fsPath('/Users/me/ws', platform), fsPath('/tmp/a b/c:/d', platform)], ['/Users/me/ws', '/tmp/a b/c:/d']);
	}
});
