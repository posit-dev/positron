/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAcademic } from '../../../../base/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronAcademicLicenseService } from '../../../../platform/positronLicense/common/positronAcademicLicenseService.js';

/**
 * The implementation of `IPositronAcademicLicenseService` for the browser. Reads the
 * `_POSITRON_IS_ACADEMIC` global that `webClientServer.ts` injects into the served HTML,
 * which mirrors the server's own license validation; see `platform.ts`'s `isAcademic`.
 */
export class BrowserPositronAcademicLicenseService implements IPositronAcademicLicenseService {
	declare readonly _serviceBrand: undefined;
	readonly isAcademic = isAcademic;
}

registerSingleton(IPositronAcademicLicenseService, BrowserPositronAcademicLicenseService, InstantiationType.Delayed);
