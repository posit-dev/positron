/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronAcademicLicenseService } from '../../../../platform/positronLicense/common/positronAcademicLicenseService.js';

/**
 * The implementation of `IPositronAcademicLicenseService` for the Electron desktop app.
 * Desktop installs never go through a license check (see `hasWebUi` in
 * `remoteExtensionHostAgentServer.ts`), so this is always false.
 */
export class ElectronPositronAcademicLicenseService implements IPositronAcademicLicenseService {
	declare readonly _serviceBrand: undefined;
	readonly isAcademic = false;
}

registerSingleton(IPositronAcademicLicenseService, ElectronPositronAcademicLicenseService, InstantiationType.Delayed);
