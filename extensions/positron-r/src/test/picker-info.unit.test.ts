/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import { createRPickerInfo, RRuntimeSource } from '../provider';
import { RInstallation, RVersionsMetadata } from '../r-installation';

function fakeInstallation(overrides: Partial<RInstallation>): RInstallation {
	return { version: '4.4.1', arch: 'arm64', current: false, ...overrides } as RInstallation;
}

suite('picker info', () => {
	test('current R sorts before other Rs', () => {
		const current = createRPickerInfo(fakeInstallation({ current: true }), RRuntimeSource.system, false);
		const other = createRPickerInfo(fakeInstallation({ current: false }), RRuntimeSource.system, false);
		assert.deepStrictEqual(
			[current.group, current.groupOrder, current.rowOrder, other.rowOrder],
			['R', 0, 0, 1]
		);
	});

	test('conda R describes its environment', () => {
		const info = createRPickerInfo(
			fakeInstallation({ packagerMetadata: { environmentPath: '/envs/myenv' } }),
			RRuntimeSource.conda,
			false
		);
		assert.deepStrictEqual([info.label, info.description], ['R 4.4.1', 'Conda: myenv']);
	});

	test('homebrew R with arch joins them with a middle dot', () => {
		const info = createRPickerInfo(fakeInstallation({}), RRuntimeSource.homebrew, true);
		assert.strictEqual(info.description, 'Homebrew \u00B7 arm64');
	});

	test('plain R has no description unless arch is shown', () => {
		const plain = createRPickerInfo(fakeInstallation({}), RRuntimeSource.system, false);
		const withArch = createRPickerInfo(fakeInstallation({}), RRuntimeSource.system, true);
		assert.deepStrictEqual([plain.description, withArch.description], [undefined, 'arm64']);
	});

	test('r-versions label becomes the row label', () => {
		const packagerMetadata: RVersionsMetadata = { type: 'rversions', label: 'Team R' };
		const info = createRPickerInfo(fakeInstallation({ packagerMetadata }), RRuntimeSource.system, false);
		assert.strictEqual(info.label, 'Team R');
	});
});
