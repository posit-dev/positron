/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronAcademicLicenseService, isLicenseHash, POSITRON_IS_ACADEMIC_GLOBAL, POSITRON_LICENSE_HASH_GLOBAL } from '../../../../platform/positronLicense/common/positronAcademicLicenseService.js';

/**
 * Reads the injected license hash, ignoring a global that does not hold one. This side does
 * the checking that matters: the value read here is what ends up on outgoing P3M gallery
 * URLs, so it is validated rather than trusted because the server validated it on the way in.
 */
function licenseHashFromGlobal(): string | undefined {
	const value = (globalThis as Record<string, unknown>)[POSITRON_LICENSE_HASH_GLOBAL];
	return isLicenseHash(value) ? value : undefined;
}

/**
 * The implementation of `IPositronAcademicLicenseService` for the browser. Reads the globals
 * that `webClientServer.ts` injects into the served HTML from the server's own license
 * validation. The injected script runs before any module loads, so the globals are already
 * set (or absent, meaning not academic and no license file) by construction time.
 */
export class BrowserPositronAcademicLicenseService implements IPositronAcademicLicenseService {
	declare readonly _serviceBrand: undefined;
	readonly isAcademic = (globalThis as Record<string, unknown>)[POSITRON_IS_ACADEMIC_GLOBAL] === true;
	readonly licenseHash = licenseHashFromGlobal();
}

registerSingleton(IPositronAcademicLicenseService, BrowserPositronAcademicLicenseService, InstantiationType.Delayed);
