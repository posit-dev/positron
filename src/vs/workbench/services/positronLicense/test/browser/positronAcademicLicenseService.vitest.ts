/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { POSITRON_LICENSE_HASH_GLOBAL } from '../../../../../platform/positronLicense/common/positronAcademicLicenseService.js';
import { BrowserPositronAcademicLicenseService } from '../../browser/positronAcademicLicenseService.js';

describe('BrowserPositronAcademicLicenseService', () => {
	const globals = globalThis as Record<string, unknown>;

	afterEach(() => {
		delete globals[POSITRON_LICENSE_HASH_GLOBAL];
	});

	it('reports the license hash the server injected', () => {
		globals[POSITRON_LICENSE_HASH_GLOBAL] = 'a1b2c3d4e5f60718';
		expect(new BrowserPositronAcademicLicenseService().licenseHash).toBe('a1b2c3d4e5f60718');
	});

	it('reports no hash when the server injected none', () => {
		expect(new BrowserPositronAcademicLicenseService().licenseHash).toBeUndefined();
	});

	it.each([true, 42, {}, '', 'not-a-hash', 'A1B2C3D4E5F60718', `x';alert(1);//`])(
		'reports no hash when the global holds %j instead of one',
		value => {
			// The global is page-level state, so it can hold anything by the time this runs,
			// and this side is what puts the value on outgoing gallery URLs. Anything that is
			// not a hash we produced must read as "no license hash".
			globals[POSITRON_LICENSE_HASH_GLOBAL] = value;
			expect(new BrowserPositronAcademicLicenseService().licenseHash).toBeUndefined();
		});
});
