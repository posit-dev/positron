/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findInterpreterDefinition, getTerminalMutation, InterpreterDefinition, resolveDefinitionEnv } from '../interpreterDefinition';

suite('resolveDefinitionEnv', () => {
	const definition: InterpreterDefinition = {
		language: 'r',
		path: '/opt/R/4.4.3/bin/R',
		label: 'XX',
		env: { R_LIBS_SITE: '/xx' },
	};
	// Start from the real environment, since the OS may add variables to new
	// processes that are missing (e.g. __CF_USER_TEXT_ENCODING on macOS).
	const baseEnv: Record<string, string> = { R_LIBS_SITE: '/default' };
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			baseEnv[name] = value;
		}
	}
	baseEnv.PATH = '/usr/bin:/bin';
	let dir: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interpreter-definition-'));
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function writeScript(name: string, contents: string): string {
		const scriptPath = path.join(dir, name);
		fs.writeFileSync(scriptPath, contents);
		return scriptPath;
	}

	test('returns the definition env when there is no startup script', async () => {
		assert.deepStrictEqual(await resolveDefinitionEnv(definition, baseEnv, process.platform), { R_LIBS_SITE: '/xx' });
	});

	test('adds the variables the startup script sets or changes', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		// The script sees the definition env, and its output does not leak into the capture.
		const startupScript = writeScript(`it's setup.sh`, [
			'echo loading modules',
			'export LIB_PATH="$R_LIBS_SITE/lib"',
			'export PATH="/opt/tools/bin:$PATH"',
			'UNEXPORTED=1',
		].join('\n'));
		assert.deepStrictEqual(await resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, process.platform), {
			R_LIBS_SITE: '/xx',
			LIB_PATH: '/xx/lib',
			PATH: '/opt/tools/bin:/usr/bin:/bin',
		});
	});

	test('rejects when the startup script fails', async function () {
		if (process.platform === 'win32') {
			this.skip();
		}
		const startupScript = writeScript('fail.sh', 'return 3');
		await assert.rejects(resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, process.platform));
	});

	test('skips the startup script on Windows but still applies env', async () => {
		const startupScript = writeScript('setup.sh', 'export FOO=bar');
		assert.deepStrictEqual(await resolveDefinitionEnv({ ...definition, startupScript }, baseEnv, 'win32'), { R_LIBS_SITE: '/xx' });
	});
});

suite('getTerminalMutation', () => {
	test('prepends or appends only the added part, and replaces otherwise', () => {
		assert.deepStrictEqual([
			getTerminalMutation('/opt/tools/bin:/usr/bin', '/usr/bin'),
			getTerminalMutation('/usr/bin:/opt/tools/bin', '/usr/bin'),
			getTerminalMutation('/xx', '/default'),
			getTerminalMutation('/xx', undefined),
			getTerminalMutation('/usr/bin', '/usr/bin'),
		], [
			{ type: 'prepend', value: '/opt/tools/bin:' },
			{ type: 'append', value: ':/opt/tools/bin' },
			{ type: 'replace', value: '/xx' },
			{ type: 'replace', value: '/xx' },
			{ type: 'replace', value: '/usr/bin' },
		]);
	});
});

suite('findInterpreterDefinition', () => {
	const definition: InterpreterDefinition = { language: 'r', path: '/opt/R/4.4.3/bin/R', label: 'XX' };

	test('finds the entry by language, label, and path, ignoring malformed setting values', () => {
		assert.deepStrictEqual([
			findInterpreterDefinition([
				null,
				'r',
				{ ...definition, language: 'python' },
				{ ...definition, path: '/opt/R/4.4.4/bin/R' },
				{ ...definition, env: ['R_LIBS_SITE=/bad'] },
				{ ...definition, startupScript: 42 },
				definition,
			], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition([{ ...definition, path: '/opt/R/4.4.4/bin/R' }], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition(definition, 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition(undefined, 'r', 'XX', '/opt/R/4.4.3/bin/R'),
		], [definition, undefined, undefined, undefined]);
	});

	test('does not match a retargeted definition with the same label', () => {
		assert.deepStrictEqual([
			findInterpreterDefinition([{ ...definition, path: '/opt/R/4.4.4/bin/R' }], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
			findInterpreterDefinition([{ ...definition, path: '/opt/R/4.4.3/bin/R' }], 'r', 'XX', '/opt/R/4.4.3/bin/R'),
		], [undefined, definition]);
	});
});
