/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import { applyInterpreterDefinition, findInterpreterDefinition, InterpreterDefinition } from '../interpreterDefinition';
import { JupyterKernelSpec } from '../positron-supervisor';

suite('applyInterpreterDefinition', () => {
	const kernel: JupyterKernelSpec = {
		argv: ['ark'],
		display_name: 'R 4.4.3',
		language: 'R',
		env: { RUST_LOG: 'warn', R_LIBS_SITE: '/default' },
		kernel_protocol_version: '5.5',
	};
	const definition: InterpreterDefinition = {
		language: 'r',
		path: '/opt/R/4.4.3/bin/R',
		label: 'XX',
		env: { R_LIBS_SITE: '/xx' },
		startupScript: '/shared/xx setup.sh',
	};

	test('merges env over the kernel env and adds the startup script', () => {
		assert.deepStrictEqual(applyInterpreterDefinition(kernel, definition, 'linux'), {
			...kernel,
			env: { RUST_LOG: 'warn', R_LIBS_SITE: '/xx' },
			startup_command: `. '/shared/xx setup.sh'`,
		});
	});

	test('runs the startup script after an existing startup command', () => {
		const result = applyInterpreterDefinition({ ...kernel, startup_command: 'module load R/4.4.3' }, definition, 'linux');
		assert.strictEqual(result.startup_command, `module load R/4.4.3 && . '/shared/xx setup.sh'`);
	});

	test('expands a leading ~ and quotes shell-special characters in the script path', () => {
		const commands = ['~/setup.sh', `/it's $HOME.sh`].map(startupScript =>
			applyInterpreterDefinition(kernel, { ...definition, startupScript }, 'linux').startup_command);
		assert.deepStrictEqual(commands, [`. '${os.homedir()}/setup.sh'`, `. '/it'\\''s $HOME.sh'`]);
	});

	test('skips the startup script on Windows but still applies env', () => {
		const result = applyInterpreterDefinition(kernel, definition, 'win32');
		assert.deepStrictEqual([result.startup_command, result.env], [undefined, { RUST_LOG: 'warn', R_LIBS_SITE: '/xx' }]);
	});
});

suite('findInterpreterDefinition', () => {
	const definition: InterpreterDefinition = { language: 'r', path: '/opt/R/4.4.3/bin/R', label: 'XX' };

	test('finds the entry by language and label, ignoring malformed setting values', () => {
		assert.deepStrictEqual([
			findInterpreterDefinition([
				null,
				'r',
				{ ...definition, language: 'python' },
				{ ...definition, env: ['R_LIBS_SITE=/bad'] },
				{ ...definition, startupScript: 42 },
				definition,
			], 'r', 'XX'),
			findInterpreterDefinition(definition, 'r', 'XX'),
			findInterpreterDefinition(undefined, 'r', 'XX'),
		], [definition, undefined, undefined]);
	});
});
