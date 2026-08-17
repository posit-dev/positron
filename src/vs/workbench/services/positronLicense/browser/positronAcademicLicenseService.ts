/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronAcademicLicenseService, POSITRON_IS_ACADEMIC_GLOBAL } from '../../../../platform/positronLicense/common/positronAcademicLicenseService.js';

/**
 * The implementation of `IPositronAcademicLicenseService` for the browser. Reads the global
 * that `webClientServer.ts` injects into the served HTML when the server's own license
 * validation found the session academic. The injected script runs before any module loads,
 * so the global is already set (or absent, meaning not academic) by construction time.
 */
export class BrowserPositronAcademicLicenseService implements IPositronAcademicLicenseService {
	declare readonly _serviceBrand: undefined;
	readonly isAcademic = (globalThis as Record<string, unknown>)[POSITRON_IS_ACADEMIC_GLOBAL] === true;
}

registerSingleton(IPositronAcademicLicenseService, BrowserPositronAcademicLicenseService, InstantiationType.Delayed);
