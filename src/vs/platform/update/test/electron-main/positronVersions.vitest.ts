/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { IUpdate } from '../../common/update.js';
import * as positronVersion from '../../common/positronVersion.js';

describe('Positron Version', function () {
	ensureNoLeakedDisposables();

	it('UpdateService - compare update with build number to version without build number', () => {
		const update: IUpdate = { version: '2024.11.0-111' };
		expect(positronVersion.hasUpdate(update, '2024.11.0')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.09.0')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.12.0')).toBe(false);

		const updateNoBuild: IUpdate = { version: '2024.11.0' };
		expect(positronVersion.hasUpdate(updateNoBuild, '2024.11.0-111')).toBe(false);
		expect(positronVersion.hasUpdate(updateNoBuild, '2024.09.0-111')).toBe(true);
		expect(positronVersion.hasUpdate(updateNoBuild, '2024.12.0-111')).toBe(false);
	});

	it('UpdateService - compare year version', () => {
		const update: IUpdate = { version: '2024.12.0-111' };
		expect(positronVersion.hasUpdate(update, '2024.12.0-111')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2023.12.0-111')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2025.12.0-111')).toBe(false);
	});

	it('UpdateService - compare month version', () => {
		const update: IUpdate = { version: '2024.05.0-111' };
		expect(positronVersion.hasUpdate(update, '2024.05.0-111')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.02.0-111')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.12.0-111')).toBe(false);
	});

	it('UpdateService - compare patch version', () => {
		const update: IUpdate = { version: '2024.11.10-18' };
		expect(positronVersion.hasUpdate(update, '2024.11.10-18')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.11.0-18')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.11.12-18')).toBe(false);
	});

	it('UpdateService - compare build number', () => {
		const update: IUpdate = { version: '2024.11.1-18' };
		expect(positronVersion.hasUpdate(update, '2024.11.1-18')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.11.1-10')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.11.1-20')).toBe(false);
	});

});
