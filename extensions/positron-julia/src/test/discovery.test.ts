/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as semver from 'semver';
import {
	JuliaInstallation,
	ReasonDiscovered,
	MIN_JULIA_VERSION,
	isValidJuliaInstallation
} from '../julia-installation';

suite('Julia Installation', () => {

	suite('isValidJuliaInstallation', () => {

		test('accepts Julia 1.10.0', () => {
			const installation: JuliaInstallation = {
				binpath: '/usr/bin/julia',
				homepath: '/usr/lib/julia',
				version: '1.10.0',
				semVersion: semver.parse('1.10.0')!,
				arch: 'x86_64',
				reasonDiscovered: ReasonDiscovered.PATH,
				current: true,
			};
			assert.strictEqual(isValidJuliaInstallation(installation), true);
		});

		test('accepts Julia 1.9.0 (minimum version)', () => {
			const installation: JuliaInstallation = {
				binpath: '/usr/bin/julia',
				homepath: '/usr/lib/julia',
				version: '1.9.0',
				semVersion: semver.parse('1.9.0')!,
				arch: 'x86_64',
				reasonDiscovered: ReasonDiscovered.PATH,
				current: true,
			};
			assert.strictEqual(isValidJuliaInstallation(installation), true);
		});

		test('rejects Julia 1.8.5 (below minimum)', () => {
			const installation: JuliaInstallation = {
				binpath: '/usr/bin/julia',
				homepath: '/usr/lib/julia',
				version: '1.8.5',
				semVersion: semver.parse('1.8.5')!,
				arch: 'x86_64',
				reasonDiscovered: ReasonDiscovered.PATH,
				current: false,
			};
			assert.strictEqual(isValidJuliaInstallation(installation), false);
		});

		test('rejects Julia 1.6.7', () => {
			const installation: JuliaInstallation = {
				binpath: '/usr/bin/julia',
				homepath: '/usr/lib/julia',
				version: '1.6.7',
				semVersion: semver.parse('1.6.7')!,
				arch: 'x86_64',
				reasonDiscovered: ReasonDiscovered.JULIAUP,
				current: false,
			};
			assert.strictEqual(isValidJuliaInstallation(installation), false);
		});

		test('accepts Julia 1.11.0', () => {
			const installation: JuliaInstallation = {
				binpath: '/usr/bin/julia',
				homepath: '/usr/lib/julia',
				version: '1.11.0',
				semVersion: semver.parse('1.11.0')!,
				arch: 'aarch64',
				reasonDiscovered: ReasonDiscovered.STANDARD,
				current: true,
			};
			assert.strictEqual(isValidJuliaInstallation(installation), true);
		});
	});

	suite('MIN_JULIA_VERSION', () => {
		test('is set to 1.9.0', () => {
			assert.strictEqual(MIN_JULIA_VERSION, '1.9.0');
		});
	});

	suite('ReasonDiscovered', () => {
		test('has all expected values', () => {
			assert.strictEqual(ReasonDiscovered.PATH, 'PATH');
			assert.strictEqual(ReasonDiscovered.JULIAUP, 'juliaup');
			assert.strictEqual(ReasonDiscovered.STANDARD, 'standard');
			assert.strictEqual(ReasonDiscovered.USER_SETTING, 'user-setting');
		});
	});
});
