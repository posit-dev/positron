/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// dp-lib.ts's fsPath, shownPath and samePath: the window's URIs (the folder,
// the user settings file) as paths settings.sh and window.sh can use, on each
// platform.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fsPath, samePath, shownPath } from '../scripts/dp-lib.ts';

const file = (path: string, authority = '') => ({ scheme: 'file', authority, path });

test('fsPath on Windows: no slash before the drive, lower-case drive, backslashes, UNC kept', () => {
	assert.deepEqual([
		fsPath(file('/c:/Users/me/ws11063'), 'win32'),
		fsPath(file('/C:/Users/JONVAN~1/AppData/Local/Temp/run/user-data/User/settings.json'), 'win32'),
		fsPath(file('/c:/Users/me/a b/#x%20y'), 'win32'),
		fsPath(file('/team/ws', 'fileserver'), 'win32'),
	], [
		'c:\\Users\\me\\ws11063',
		'c:\\Users\\JONVAN~1\\AppData\\Local\\Temp\\run\\user-data\\User\\settings.json',
		'c:\\Users\\me\\a b\\#x%20y',
		'\\\\fileserver\\team\\ws',
	]);
});

test('fsPath on macOS and Linux: the path as it is, UNC kept', () => {
	for (const platform of ['darwin', 'linux'] as const) {
		assert.deepEqual([fsPath(file('/Users/me/ws'), platform), fsPath(file('/tmp/a b/c:/d'), platform), fsPath(file('/team/ws', 'fileserver'), platform)], ['/Users/me/ws', '/tmp/a b/c:/d', '//fileserver/team/ws']);
	}
});

test('fsPath is null for a URI not on this machine, and shownPath names it', () => {
	const remote = { scheme: 'vscode-remote', authority: 'wsl+Ubuntu', path: '/home/me/ws' };
	assert.deepEqual(
		[fsPath(remote, 'win32'), fsPath({ scheme: 'vscode-userdata', path: '/c:/x' }, 'win32'), fsPath(null), shownPath(remote, 'win32'), shownPath(file('/c:/ws'), 'win32'), shownPath(undefined)],
		[null, null, null, 'vscode-remote://wsl+Ubuntu/home/me/ws', 'c:\\ws', null]);
});

test('samePath ignores case and slash direction on Windows only', () => {
	assert.deepEqual(
		[samePath('c:\\Users\\me\\ws', 'C:/Users/me/ws', 'win32'), samePath('c:\\ws\\a', 'c:\\ws\\b', 'win32'), samePath('/Users/me/WS', '/Users/me/ws', 'darwin'), samePath('/tmp/ws', '/tmp/ws', 'linux')],
		[true, false, false, true]);
});
