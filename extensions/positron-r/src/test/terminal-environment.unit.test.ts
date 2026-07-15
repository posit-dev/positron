/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { RMetadataExtra } from '../r-installation';
import { getRTerminalEnvironmentMutations, TerminalEnvironmentMutation } from '../terminal-environment';

/**
 * Build an RMetadataExtra with sensible defaults for the paths under test.
 */
function makeMetadataExtra(overrides: Partial<RMetadataExtra> = {}): RMetadataExtra {
	return {
		homepath: '/opt/R/4.4.0/lib/R',
		binpath: '/opt/R/4.4.0/bin/R',
		scriptpath: '/opt/R/4.4.0/bin/Rscript',
		current: false,
		default: false,
		reasonDiscovered: null,
		...overrides,
	};
}

/**
 * Find the mutation for a given variable, or undefined if none exists.
 */
function find(mutations: TerminalEnvironmentMutation[], variable: string): TerminalEnvironmentMutation | undefined {
	return mutations.find(m => m.variable === variable);
}

suite('getRTerminalEnvironmentMutations', () => {

	test('prepends the R binary directory to PATH (posix separator)', () => {
		const mutations = getRTerminalEnvironmentMutations(makeMetadataExtra(), 'darwin');
		const path = find(mutations, 'PATH');

		assert.ok(path, 'expected a PATH mutation');
		assert.strictEqual(path!.action, 'prepend');
		assert.strictEqual(path!.value, '/opt/R/4.4.0/bin:');
	});

	test('prepends the R binary directory to PATH (windows separator)', () => {
		const mutations = getRTerminalEnvironmentMutations(
			makeMetadataExtra({ binpath: 'C:/R/R-4.4.0/bin/x64/R.exe' }),
			'win32'
		);
		const path = find(mutations, 'PATH');

		assert.ok(path, 'expected a PATH mutation');
		assert.strictEqual(path!.action, 'prepend');
		assert.strictEqual(path!.value, 'C:/R/R-4.4.0/bin/x64;');
	});

	test('replaces R_HOME with the home path', () => {
		const mutations = getRTerminalEnvironmentMutations(makeMetadataExtra(), 'darwin');
		const rHome = find(mutations, 'R_HOME');

		assert.ok(rHome, 'expected an R_HOME mutation');
		assert.strictEqual(rHome!.action, 'replace');
		assert.strictEqual(rHome!.value, '/opt/R/4.4.0/lib/R');
	});

	test('sets QUARTO_R to the directory containing Rscript, not Rscript itself', () => {
		const mutations = getRTerminalEnvironmentMutations(makeMetadataExtra(), 'darwin');
		const quartoR = find(mutations, 'QUARTO_R');

		assert.ok(quartoR, 'expected a QUARTO_R mutation');
		assert.strictEqual(quartoR!.action, 'replace');
		assert.strictEqual(quartoR!.value, '/opt/R/4.4.0/bin');
	});

	test('does not set library-path variables on macOS', () => {
		const mutations = getRTerminalEnvironmentMutations(makeMetadataExtra(), 'darwin');

		assert.strictEqual(find(mutations, 'DYLD_LIBRARY_PATH'), undefined);
		assert.strictEqual(find(mutations, 'LD_LIBRARY_PATH'), undefined);
	});

	test('does not set library-path variables on Linux', () => {
		const mutations = getRTerminalEnvironmentMutations(makeMetadataExtra(), 'linux');

		assert.strictEqual(find(mutations, 'LD_LIBRARY_PATH'), undefined);
		assert.strictEqual(find(mutations, 'DYLD_LIBRARY_PATH'), undefined);
	});

	test('omits PATH when there is no binary path', () => {
		const mutations = getRTerminalEnvironmentMutations(
			makeMetadataExtra({ binpath: '' }),
			'darwin'
		);

		assert.strictEqual(find(mutations, 'PATH'), undefined);
		// The other variables are still contributed.
		assert.ok(find(mutations, 'R_HOME'));
		assert.ok(find(mutations, 'QUARTO_R'));
	});

	test('omits QUARTO_R when there is no script path', () => {
		const mutations = getRTerminalEnvironmentMutations(
			makeMetadataExtra({ scriptpath: '' }),
			'darwin'
		);

		assert.strictEqual(find(mutations, 'QUARTO_R'), undefined);
		assert.ok(find(mutations, 'PATH'));
		assert.ok(find(mutations, 'R_HOME'));
	});

	test('contributes only the expected variables', () => {
		const mutations = getRTerminalEnvironmentMutations(makeMetadataExtra(), 'darwin');
		const variables = mutations.map(m => m.variable).sort();

		assert.deepStrictEqual(variables, ['PATH', 'QUARTO_R', 'R_HOME']);
	});
});
