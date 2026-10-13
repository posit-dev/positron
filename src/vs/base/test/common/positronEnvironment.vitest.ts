/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { formatDeprecatedEnvWarning, getDeprecatedEnvFallbacks, getPositronEnv } from '../../common/positronEnvironment.js';

describe('getPositronEnv', () => {
	test('prefers POSITRON_* over VSCODE_* when both are set', () => {
		const env = { POSITRON_EXTENSIONS: '/positron', VSCODE_EXTENSIONS: '/vscode' };

		expect(getPositronEnv(env, 'EXTENSIONS')).toBe('/positron');
	});

	test('falls back to VSCODE_* when POSITRON_* is unset', () => {
		const env = { VSCODE_PORTABLE: '/vscode' };

		expect(getPositronEnv(env, 'PORTABLE')).toBe('/vscode');
	});

	test('treats an empty POSITRON_* as unset', () => {
		const env = { POSITRON_APPDATA: '', VSCODE_APPDATA: '/vscode' };

		expect(getPositronEnv(env, 'APPDATA')).toBe('/vscode');
	});

	test('returns undefined when neither is set, or both are empty', () => {
		expect(getPositronEnv({}, 'EXTENSIONS')).toBeUndefined();
		expect(getPositronEnv({ POSITRON_EXTENSIONS: '', VSCODE_EXTENSIONS: '' }, 'EXTENSIONS')).toBeUndefined();
	});
});

describe('getDeprecatedEnvFallbacks', () => {
	test('reports each VSCODE_* name whose POSITRON_* counterpart is unset', () => {
		const env = {
			VSCODE_EXTENSIONS: '/vscode-ext',
			VSCODE_PORTABLE: '/vscode-portable',
			POSITRON_PORTABLE: '/positron-portable',
			VSCODE_APPDATA: '/vscode-appdata',
			POSITRON_APPDATA: '',
		};

		expect(getDeprecatedEnvFallbacks(env)).toEqual(['VSCODE_EXTENSIONS', 'VSCODE_APPDATA']);
	});

	test('reports nothing when no VSCODE_* variable is set', () => {
		expect(getDeprecatedEnvFallbacks({ POSITRON_EXTENSIONS: '/positron', VSCODE_EXTENSIONS: '' })).toEqual([]);
	});
});

describe('formatDeprecatedEnvWarning', () => {
	test('names the deprecated variable, its replacement, and the removal release', () => {
		expect(formatDeprecatedEnvWarning('VSCODE_EXTENSIONS')).toBe(
			'VSCODE_EXTENSIONS is deprecated and will be ignored starting in Positron 2027.01; set POSITRON_EXTENSIONS instead.'
		);
	});
});
