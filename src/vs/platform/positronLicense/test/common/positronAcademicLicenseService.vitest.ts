/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { academicMarkerScript } from '../../common/positronAcademicLicenseService.js';

describe('academicMarkerScript', () => {

	// The global name asserted here is written out literally on purpose: it is the contract
	// between the script this function emits and the `isAcademic` read in
	// `base/common/platform.ts`. Layering forbids sharing a constant across the two, so if
	// either side is renamed this assertion is what catches the drift -- without it, the
	// banner would silently never appear for any academic deployment.
	it('emits a script setting the global that platform.ts reads', () => {
		expect(academicMarkerScript(true)).toBe('<script>globalThis._POSITRON_IS_ACADEMIC = true;</script>');
	});

	it('emits nothing when the session is not academic', () => {
		expect(academicMarkerScript(false)).toBe('');
	});
});
