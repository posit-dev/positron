/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { licenseMarkerScript } from '../../common/positronAcademicLicenseService.js';

describe('licenseMarkerScript', () => {

	it('emits a script setting the academic global', () => {
		expect(licenseMarkerScript(true)).toBe('<script>globalThis._POSITRON_IS_ACADEMIC = true;</script>');
	});

	it('emits both globals when the session is academic and has a license hash', () => {
		expect(licenseMarkerScript(true, 'a1b2c3d4e5f60718')).toBe(
			`<script>globalThis._POSITRON_IS_ACADEMIC = true; globalThis._POSITRON_LICENSE_HASH = 'a1b2c3d4e5f60718';</script>`
		);
	});

	it('emits the hash alone for a licensed session that is not academic', () => {
		// The shape a future Positron Server Pro would take: a license file to hash, but
		// its own signal saying the Education License Rider does not apply.
		expect(licenseMarkerScript(false, 'a1b2c3d4e5f60718')).toBe(
			`<script>globalThis._POSITRON_LICENSE_HASH = 'a1b2c3d4e5f60718';</script>`
		);
	});

	it('emits nothing when the session is not academic', () => {
		expect(licenseMarkerScript(false)).toBe('');
	});

	// Nothing should be able to reach the inline script through the hash, so anything that
	// is not a plain hex digest of the expected width is refused outright. Asserted with an
	// academic session so the expectation names what survives: dropping the bad hash must
	// not take the academic global (and with it the license banner) down too.
	it.each(['', 'a1b2c3d4e5f6071', 'a1b2c3d4e5f607189', 'A1B2C3D4E5F60718', `x';alert(1);//`])(
		'drops the hash %j and still emits the academic global',
		notAHash => {
			expect(licenseMarkerScript(true, notAHash)).toBe('<script>globalThis._POSITRON_IS_ACADEMIC = true;</script>');
		});
});
