/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { academicMarkerScript } from '../../common/positronAcademicLicenseService.js';

describe('academicMarkerScript', () => {

	it('emits a script setting the academic global', () => {
		expect(academicMarkerScript(true)).toBe('<script>globalThis._POSITRON_IS_ACADEMIC = true;</script>');
	});

	it('emits nothing when the session is not academic', () => {
		expect(academicMarkerScript(false)).toBe('');
	});
});
