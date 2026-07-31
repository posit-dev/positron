/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildCommandLine } from '../utils';

suite('buildCommandLine', () => {
	test('bash escaping', () => {
		assert.strictEqual(
			buildCommandLine('bash', 'python', ['app.py']),
			'python app.py');
		assert.strictEqual(
			buildCommandLine('bash', 'python', ['-m', 'shiny', 'run', '--flag=true']),
			'python -m shiny run --flag=true');
		// Spaces and special characters are backslash-escaped.
		assert.strictEqual(
			buildCommandLine('bash', '/path with spaces/python', ['my app.py']),
			'/path\\ with\\ spaces/python my\\ app.py');
		assert.strictEqual(
			buildCommandLine('bash', 'echo', ['{$} (']),
			'echo \\{\\$\\}\\ \\(');
		// Empty argument becomes "".
		assert.strictEqual(
			buildCommandLine('bash', 'cmd', ['']),
			'cmd ""');
	});

	test('cmd.exe escaping', () => {
		assert.strictEqual(
			buildCommandLine('cmd.exe', 'python', ['app.py']),
			'python app.py');
		// Paths with spaces are wrapped in double quotes.
		assert.strictEqual(
			buildCommandLine('cmd.exe', 'C:\\Program Files\\Python\\python.exe', ['my app.py']),
			'"C:\\Program Files\\Python\\python.exe" "my app.py"');
		assert.strictEqual(
			buildCommandLine('cmd.exe', 'cmd', ['^!< ']),
			'cmd "^^^!^< "');
		assert.strictEqual(
			buildCommandLine('cmd.exe', 'cmd', ['"A>0"']),
			'cmd """A^>0"""');
		assert.strictEqual(
			buildCommandLine('cmd.exe', 'cmd', ['']),
			'cmd ""');
	});

	test('powershell escaping', () => {
		// The quoted executable is invoked with the call operator `&`.
		assert.strictEqual(
			buildCommandLine('powershell', 'python', ['app.py']),
			`& 'python' 'app.py'`);
		assert.strictEqual(
			buildCommandLine('pwsh', 'python', ['-m', 'shiny', 'run']),
			`& 'python' '-m' 'shiny' 'run'`);
		assert.strictEqual(
			buildCommandLine('powershell', 'C:\\path with spaces\\python.exe', ['my app.py']),
			`& 'C:\\path with spaces\\python.exe' 'my app.py'`);
		// Single quotes are doubled.
		assert.strictEqual(
			buildCommandLine('powershell', 'echo', [`it's`]),
			`& 'echo' 'it''s'`);
		// A trailing backslash is escaped so it doesn't escape the closing quote.
		assert.strictEqual(
			buildCommandLine('powershell', 'cmd', ['dir\\']),
			`& 'cmd' 'dir\\\\'`);
	});

	test('command with no args', () => {
		assert.strictEqual(buildCommandLine('bash', 'python'), 'python');
		assert.strictEqual(buildCommandLine('cmd.exe', 'python'), 'python');
		assert.strictEqual(buildCommandLine('powershell', 'python'), `& 'python'`);
	});

	test('unknown shell falls back to platform default', () => {
		const result = buildCommandLine(undefined, 'python', ['my app.py']);
		const expected = process.platform === 'win32'
			? '"python" "my app.py"' // cmd.exe quoting
			: 'python my\\ app.py'; // bash quoting
		assert.strictEqual(result, expected);
	});
});
